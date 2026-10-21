# Projects and access

The console gateway serves one login and project selector. Each configured project runs in a separate backend
process with its own SQLite database, LiveKit credentials, worker endpoints, telemetry token and recording storage
configuration. This isolates application state; it is not an operating-system sandbox for mutually untrusted code.

## Existing deployments

The existing environment and database become project `default`. The gateway creates a sibling `control.db` for
accounts, memberships and audit records, copying existing users/IDs once. Existing viewers retain read access to
default; existing global admins retain their previous content access and may administer all configured projects.
The original project data remains in place. Keep both databases in backups. Existing cookies remain valid when
SESSION_SECRET and the migrated account remain unchanged.

Legacy `/api/*`, `/webhook` and `/api/telemetry/*` continue to address default. The selected project never changes
those ingestion destinations. Explicit project resources use `/p/<id>/api/*`; webhook/telemetry sources for another
project must use `/p/<id>/webhook` and `/p/<id>/api/telemetry/*` with that project's signing key or upload token.

## Configure additional projects

Set `CONSOLE_PROJECTS_FILE=/config/projects.json` and mount a private operator directory read-only at `/config`.
For deploy.sh, set PROJECT_CONFIG_DIR to that directory's absolute VM path in the ignored `.env.deploy`; the script
adds the mount. The operator files must stay outside the source deployment directory, which deploy.sh replaces.
Do not commit these files or put credentials in browser environment variables.

```json
{"projects":[{"id":"default","name":"Current project"},{"id":"staging","name":"Staging","envFile":"staging.env"}]}
```

The additional env file explicitly defines at least:

```dotenv
LIVEKIT_URL=wss://staging.example.com
LIVEKIT_API_KEY=replace-with-staging-key
LIVEKIT_API_SECRET=replace-with-staging-secret
DB_PATH=/data/staging.db
AGENT_WORKER_URLS=http://127.0.0.1:18082
AGENT_TELEMETRY_TOKEN=replace-with-a-separate-random-token-at-least-32-characters
```

IDs must start with a lowercase letter and contain up to 48 lowercase letters, digits or hyphens. Default must be
present and uses the existing process environment, not a replacement env file. Additional databases must have unique
absolute paths, separate from the control database. Up to 20 projects are supported. Backend ports start at the
console port plus one, or CONSOLE_BACKEND_PORT_BASE, and bind only to loopback. Failed projects stay unavailable;
requests never fall through to another project's backend. Project credentials, config file paths and private keys
are not returned by the project list API.

Additional projects do not inherit default-project LiveKit, AWS, telemetry, worker or GitHub credentials. Recording
access requires explicit project AWS keys (RECORDING_AWS_ACCESS_KEY_ID/RECORDING_AWS_SECRET_ACCESS_KEY, or the usual
AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY) or deliberate RECORDING_ALLOW_DEFAULT_CREDENTIALS=true opt-in to the SDK's
credential provider chain. Leave that opt-in unset to prevent implicit use of shared profiles or instance credentials.

## Membership and content grants

Global administrators manage project membership in Settings. New local viewers have no project access until a
membership is granted. A membership has an admin/viewer role and independent transcript, recording and log grants.
A project admin may manage that project's resources and Operations, but not global accounts or other memberships.
Project admin alone grants no sensitive content access.

Reports, model usage and agent analytics require transcripts. Structured logs require logs. Mixed live telemetry
and combined exports require both transcripts and logs. Playback requires recordings. Equivalent grants apply to
Operations content exports. Viewers with content grants can read authorized content but cannot mutate LiveKit
resources, generate room tokens or administer project policy. Diagnostics remain project-admin only.

Access is reloaded for every forwarded request. Revocation blocks subsequent requests, including new media ranges;
it cannot recall bytes already received or cancel a stream already authorized. The browser uses explicit scoped
media URLs and a document navigation on project switch to stop pending requests and discard previous page/query
state. Shared UI links keep the project query parameter.

Local accounts remain the supported login mechanism. No organization identity provider has been required, so the
roadmap's conditional SSO/OIDC integration remains deferred; it is not represented as an implemented feature.
