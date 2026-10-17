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
