# Disposable host-helper acceptance

Run from a checkout on a Docker VM with Python 3.10+ and permission to use Docker:

```sh
python3 scripts/fixtures/deployment-helper/acceptance.py --base-image python:3.11-slim
```

This builds a stdlib-only HTTP worker. It makes no LiveKit, model-provider, SIP,
carrier, or production-worker calls. It creates a random fixture owner, helper
port, two loopback health ports, private config, token, versioned secrets and state
under `/tmp/phase6-host-helper-*`. Review its private `evidence.json` and
`helper.log` there. The controller retains images and evidence for review.
Container cleanup selects only its random owner label, sends SIGTERM if needed,
and removes only stopped containers. Running containers are retained on timeout.
No `docker stop`, forced removal, SIGKILL or production restart is used.

Checks include real Docker image building, server authentication, read-only write
denial, immutable image selection, bare-secret log redaction, duplicate requests,
active-job timeout with both containers retained, helper restart with interrupted
state, explicit reconcile, rollback to a different image with the exact prior secret revision, matching
agent name rejection, trusted build and drain. The restart test terminates only its temporary helper during an actual in-flight
reconcile, then verifies unknown/reconcile-required state after restart. It never
edits saved operation state. Unit tests independently cover other interruption
and failure paths.

The worker serves `/` and `/worker` on container port 8081. `/worker` reports
`agent_name`, fixture version, SIGTERM count and drain state. `POST /busy?seconds=2`
simulates a timed active job which SIGTERM must allow to finish. Acceptance uses
`POST /busy?hold=1` to hold the job until `POST /release`, so Docker startup
latency cannot consume the job before the drain-timeout assertion. Cleanup
releases its held fixture job before requesting graceful exit. `FIXTURE_PORT` is for
local subprocess tests only; Docker uses 8081. No SDK registration is claimed.

# Operator integration

Install without enabling or starting the service:

```sh
sudo env \
  DEPLOYMENT_CONFIG="$HOME/.config/livekit-console/deployments/config.json" \
  DEPLOYMENT_STATE_DIR="$HOME/.config/livekit-console/deployments/state" \
  DEPLOYMENT_PORT=8095 \
  sh scripts/install-deployment-helper.sh
```

The installer writes a stable helper copy at
`/usr/local/lib/livekit-deployment-helper/deployment-helper.py`, mode-600
`/etc/livekit-deployment-helper/service.env`, and
`/etc/systemd/system/livekit-deployment-helper.service`. `INSTALL_ROOT=/tmp/...`
previews installation without systemctl. Runtime requires Docker host privileges;
the installed unit uses root. The operator reviews private config before explicit
service activation. Re-run installation to update the installed code copy.

Config is mode-600 JSON outside the source tree and all trusted build contexts:

```json
{"token":"REPLACE_WITH_AT_LEAST_32_RANDOM_CHARACTERS","targets":[{"id":"example-worker","name":"Example worker","agentName":"configured-agent","container":"agent-worker-1","managed":false,"actionsEnabled":false,"environment":"production","host":"worker-host","region":"","allowedImages":[]}]}
```

Observed targets need no secret file. Their revision is unknown (`null`); secret
key metadata comes only from a configured file, never Docker Env. Docker sensitive
environment values are used privately for log redaction. All writes require both
`managed:true` and `actionsEnabled:true`. Managed adoption is explicit: do not
reconcile the same managed target through compose afterwards.

Managed target fields follow the Phase 6 plan: `allowedImages` (reference strings,
or objects with `reference`), `network`, `command` and `entrypoint` arrays, exactly
two `ports`, `containerPort`, `secretsFile` (plain KEY=value, mode 600),
`allowedSecretKeys`, and optional
`build:{context,dockerfile,imageTagPrefix,timeout}`. No request supplies these.
`build.timeout` defaults to 600 seconds. Health defaults to 60 seconds (cap 300),
drain to 300 seconds (cap 3600), and polling to 1 second. Configure `drainTimeout`
to match the worker SDK's job grace period, for example 1800 seconds for an agent
using that grace period. Timeout reports incomplete drain and retains both
records; it never forces worker termination. Reconcile resumes observation of the
same candidate, and does not create another candidate or repeat SIGTERM.

HTTP under `/targets` uses the single server bearer token. Reads
return safe inventory plus operations; logs return `{lines,truncated}`; secret
GET/PUT returns `{revision,keys,allowedKeys}`. Action POST returns the operation
itself with HTTP 202. Error bodies are `{error:string}`. Helper-generated times
are epoch milliseconds. Native Docker `createdAt` is its original ISO timestamp.
`allowedImages:[{reference,imageId}]` is always present; an uninspectable image ID
is null and cannot deploy. Submit its immutable `imageId`, never its reference.
Operations are `queued|running|succeeded|failed|timed_out|unknown`; interrupted or
uncertain work has `error:"reconcile_required"`. A build interrupted before a
recoverable rollout snapshot requires operator investigation; commands are never
blindly replayed. The latest 20 completed operations, 32 steps per operation,
20 successful build references per target and bounded sanitized logs are retained.
Unresolved operations and secret revisions needed for rollback remain private;
back up private state/revisions separately from the console. Idempotency is
preserved for retained operations. Read-only inventory health never claims
LiveKit registration.
