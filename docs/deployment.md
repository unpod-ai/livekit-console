# Deploying to a VM

`deploy.sh` builds the console as a Docker image on a VM over SSH and runs it. Every host-specific value comes from
`.env.deploy`, so nothing is hard-coded.

```bash
cp .env.deploy.example .env.deploy   # DEPLOY_HOST, DEPLOY_DIR, CONSOLE_PORT, LIVEKIT_CONFIG, CONSOLE_HOST, ALLOWED_IPS, ...
cp .env.example .env                 # the console's own settings
./deploy.sh --sync-env               # first deploy: sync code and .env, build, run
./deploy.sh                          # later deploys (keeps the VM's .env)
```

| Command | What it does |
|---|---|
| `./deploy.sh` | Sync the code, rebuild the image, replace the container |
| `./deploy.sh --sync-env` | The same, and copy the local `.env` to the VM |
| `./deploy.sh webhook` | Add the webhook block to LiveKit's config and restart LiveKit (refuses while rooms are active) |
| `./deploy.sh https` | Publish the console through nginx + Let's Encrypt, limited to `ALLOWED_IPS` |

## How it runs
- The container uses host networking and binds `127.0.0.1:<CONSOLE_PORT>`, so a host-networked LiveKit can reach
  `/webhook` and the console can reach LiveKit and agent workers on the same machine.
- History lives in the `livekit-console-data` Docker volume.
- Reach it through an SSH tunnel (`ssh -L 8090:127.0.0.1:8090 <host>`) or the HTTPS step below.

## HTTPS and access control
`./deploy.sh https` adds a separate nginx site for `CONSOLE_HOST`, gets a certificate, allows only the IPs in
`ALLOWED_IPS` (plus loopback and the VM's private addresses), and rate-limits the login endpoint. If nginx rejects the
config, the new files are removed and nothing is reloaded. Your other nginx sites are not touched.

## Agent workers on the same VM
If a worker runs in a container, publish its status port on loopback (for example `127.0.0.1:18081:8081`) and set
`AGENT_WORKER_URLS=http://127.0.0.1:18081` in `.env.deploy`.

## Back up the database

The `livekit-console-data` volume contains accounts, session/event history, worker samples and repository traffic.
Back up the VM's `.env` and deployment configuration separately in secure storage: the bootstrap admin and LiveKit
credentials are not stored in the database. Archives contain password hashes and private call data; keep them out of
Git, restrict access, and encrypt copies kept off the VM.

Run the following block in Bash on the Docker host. It briefly stops **only the console**, copies the whole volume
(including any SQLite WAL and SHM files), and restarts it even if the copy fails. Schedule this during a quiet period:
webhooks cannot be accepted while the console is stopped. Other processes must not write to this volume during the copy.

```bash
set -euo pipefail
umask 077
backup_dir="$PWD/console-backups"
mkdir -p "$backup_dir"
chmod 700 "$backup_dir"
archive="$backup_dir/console-data-$(date -u +%Y%m%dT%H%M%SZ).tar.gz"

docker stop livekit-console
trap 'docker start livekit-console >/dev/null' EXIT
docker run --rm --volumes-from livekit-console:ro --entrypoint tar \
  livekit-console:latest -czf - -C /data . > "$archive"
gzip -t "$archive"
docker start livekit-console
trap - EXIT
printf 'Backup saved: %s\n' "$archive"
```

Never copy only `console.db` while the application is running: recent committed data may still be in `console.db-wal`.
For a backup without downtime, use the [SQLite Online Backup API](https://www.sqlite.org/backup.html) through an
SQLite-aware tool instead of a filesystem copy. The container commands above follow Docker's
[volume backup approach](https://docs.docker.com/engine/storage/volumes/#back-up-restore-or-migrate-data-volumes).

## Check a backup before restoring

Extract a trusted archive into a **new** disposable volume. Replace the archive path below with your saved file.
The check opens the database read-only and prints counts, without exposing account names or call contents.

```bash
archive=/absolute/path/to/console-data-YYYYMMDDTHHMMSSZ.tar.gz
check_volume="console-restore-check-$(date -u +%Y%m%dT%H%M%SZ)"
gzip -t "$archive"
docker volume create "$check_volume"
docker run --rm -i -v "$check_volume:/data" --entrypoint tar \
  livekit-console:latest -xzf - -C /data < "$archive"
docker run --rm -v "$check_volume:/data" --entrypoint node livekit-console:latest -e '
  const { DatabaseSync } = require("node:sqlite");
  const db = new DatabaseSync("/data/console.db", { readOnly: true });
  const result = db.prepare("PRAGMA integrity_check").get().integrity_check;
  if (result !== "ok") throw new Error(result);
  for (const table of ["users", "sessions", "participants", "events", "egress", "agent_worker_samples", "repo_traffic"])
    console.log(table, db.prepare("SELECT COUNT(*) AS n FROM " + table).get().n);
  db.close();
'
docker volume rm "$check_volume"
```

Compare the counts with the records expected at backup time. An empty `users` table is valid if only the bootstrap
admin from `.env` has been used. Do not restore an archive that fails integrity checks or is missing expected data.

## Restore the checked archive

Use the same console image/version that created the archive, and take a fresh backup of the current volume first.
Replace `livekit-console:latest` with your saved image ID/tag when restoring an archive from an earlier version.
Stop the console before replacing files. The block below moves the current database **and its WAL/SHM files** into
a rollback directory inside the volume before extracting the checked archive. It keeps the original volume name,
so later `deploy.sh` runs continue to use the restored database.

```bash
set -euo pipefail
archive=/absolute/path/to/console-data-YYYYMMDDTHHMMSSZ.tar.gz
gzip -t "$archive"
docker stop livekit-console
docker run --rm -i --volumes-from livekit-console --entrypoint sh livekit-console:latest -c '
  set -eu
  rollback="/data/before-restore-$(date -u +%Y%m%dT%H%M%SZ)"
  mkdir -m 700 "$rollback"
  for file in console.db console.db-wal console.db-shm; do
    if [ -e "/data/$file" ]; then mv "/data/$file" "$rollback/"; fi
  done
  tar -xzf - -C /data
' < "$archive"
docker start livekit-console
console_port=8090 # replace with your configured CONSOLE_PORT
curl --fail "http://127.0.0.1:$console_port/healthz"
```

If extraction fails, leave the console stopped and restore the saved database/WAL/SHM set together before restarting.
Tar preserves the original file ownership and permissions; if you run the console as a different UID, grant that UID
access to the restored files. Keep backup directories private and archives at mode `600`.

After startup, sign in with an existing database-managed account (if you had one), confirm its role in Settings → Team
members, and open a historical session, its participants and recording links. Confirm worker/repository history is
present too. The `.env` bootstrap admin alone does not prove database-managed accounts were restored. Recording files
live in your storage service and need their own backup; this volume stores their metadata and locations.
