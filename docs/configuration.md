# Configuration

All settings are environment variables, read from `.env` (see `.env.example`). Variables marked required stop the
server from starting when missing.

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `LIVEKIT_URL` | yes | | LiveKit server URL (`ws://` or `wss://`) |
| `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` | yes | | API key pair used for the admin APIs and to verify webhooks |
| `ADMIN_USER` / `ADMIN_PASSWORD` | yes | | Bootstrap admin; always able to sign in |
| `SESSION_SECRET` | yes | | Signs session cookies |
| `PORT` | | `8080` | HTTP port |
| `HOST` | | | Bind address (the Docker deploy uses `127.0.0.1`) |
| `DB_PATH` | | | SQLite file for history and users (`/data/console.db` in Docker) |
| `SIP_URI` | | | Your SIP URI, shown on the Dispatch rules and SIP trunks pages |
| `AGENT_WORKER_URLS` | | | Comma-separated base URLs of agent workers' status servers |
| `AGENT_WORKER_METADATA` | | `{}` | JSON mapping exact worker URLs to safe configured deployment metadata; see [inventory](agent-inventory.md) |
| `WORKER_ROLLUP_RETENTION_DAYS` | | `365` | Hourly sampled availability/load retention, integer 14–3650 days; inventory survives expiry |
| `AGENT_TELEMETRY_TOKEN` | | disabled | Separate upload-only bearer token (at least 32 characters); enables post-session agent reports |
| `AGENT_TELEMETRY_RETENTION_DAYS` | | `30` | Content retention for newly received reports, integer 1–365 days |
| `LIVEKIT_BROWSER_URL` | | derived from `LIVEKIT_URL` | Public WS(S) signaling endpoint for browser tests/tokens when server APIs use an internal address |
| `DEPLOYMENT_HELPER_URL` / `DEPLOYMENT_HELPER_TOKEN` | | disabled | Restricted Docker helper; [setup and testing](agent-deployments-and-testing.md) |
| `GITHUB_TOKEN` | | | Token with push access to the repo, to record clone/view traffic |
| `GITHUB_REPO` | | `unpod-ai/livekit-console` | Repository whose traffic is recorded |
| `AUDIT_RETENTION_DAYS` | | `365` | Central audit retention, integer 1–3650 days |
| `AGENT_LIVE_RETENTION_DAYS` / `AGENT_LOG_RETENTION_DAYS` | | report retention | Independent live/log content defaults; Operations policy persists subsequent changes |
| `HISTORY_RETENTION_DAYS` / `TRAFFIC_RETENTION_DAYS` | | unlimited | Optional retained history/traffic defaults |
| `RECORDING_ALLOW_DEFAULT_CREDENTIALS` | | `false` | Explicit opt-in to SDK shared/instance credential discovery; otherwise explicit keys are required |

## What is stored
SQLite holds events, sessions, participants, egress records, users, agent worker status samples (kept 14 days) and
durable agent identities, linked names, archived worker inventory, hourly check rollups and repository traffic. LiveKit's API key/secret are never sent to the browser. Egress credentials returned by LiveKit
(S3 keys, session tokens and similar) are redacted by the server before they reach the UI.

When agent report collection is enabled, normalized conversation reports are also stored. These contain sensitive
text and are restricted to administrators; viewer accounts cannot access them. See [agent telemetry](agent-telemetry.md)
for upload setup, excluded fields, retention and redaction limitations.

## Deployment settings
`.env.deploy` (git-ignored; template in `.env.deploy.example`) holds the VM target for `deploy.sh`; see
[deployment.md](deployment.md).

The console connects to one LiveKit server. Team accounts have admin/viewer roles and separate transcript, recording
and log permissions. Existing gateway installations migrate canonical users and audit into the application database
once; see [accounts and migration](accounts-and-migration.md) and [Operations](operations.md).

## Connection diagnostics

`DIAGNOSTICS_ENABLED=true` enables the dedicated service-token upload route; it defaults off.
`DIAGNOSTICS_RETENTION_DAYS` controls measured diagnostic content retention (default 30, range 1–365).
`AGENT_QUALITY_ENABLED=true` enables the native helper on instrumented workers; defaults off.
See [collection, permissions and host installation](connection-diagnostics.md).
