# Project administration and operations

Implement the approved Phase 5 roadmap in the existing console. The existing deployment becomes project `default`
without moving its SQLite file, changing credentials, renaming workers or rewriting history. No tags, releases,
version bumps or day/night theme work. OIDC is conditional in the roadmap and is deferred until an organization
requires an identity provider; local accounts remain supported.

## Project boundary (implementation choice)

Keep singleton SDK/config/SQLite modules inside isolated project backend child processes. A parent HTTP gateway
owns the existing login/user directory, project memberships, content capabilities and administrative audit store.
It starts one loopback-only backend per configured project; child processes use distinct databases and LiveKit,
telemetry, recording and worker configuration. This is a security/data boundary, not a deployment orchestrator.
Do not replace all module singletons with request-global mutable state.

`CONSOLE_PROJECTS_FILE` optionally names a trusted operator JSON file `{projects:[{id,name,envFile?}]}`. Always
include `default`; its current process environment and DB_PATH remain the source. Additional projects require a
separate env file explicitly defining LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET and a unique absolute DB_PATH.
Do not inherit default-project cloud, telemetry, worker, GitHub or AWS credentials into additional projects.
IDs use `[a-z][a-z0-9-]{0,47}`; reject duplicate IDs, database paths, invalid files and conflicting child ports.
Only allowlisted shared runtime/bootstrap values cross into additional project environments. Project config files
are server-only and never returned in APIs. Backend port base is configurable, binds 127.0.0.1 and is not published.

Gateway requests use explicit `/p/:projectId/api/...` paths. Project selection is never inferred from a mutable
cookie for media. Legacy `/api/...`, `/webhook` and `/api/telemetry/...` map only to `default` for compatibility.
Scoped ingestion uses `/p/:projectId/webhook` and `/p/:projectId/api/telemetry/...`; each child validates its own
webhook signatures and telemetry token. Forward raw request streams and Range/conditional responses; preserve
webhook bytes and streaming/backpressure. Never forward client-supplied identity/forwarded headers as authority.
Authenticated proxy requests carry a short-lived signed gateway assertion including audience/project, actor,
project role and content grants. Children accept that assertion only with a private gateway secret and their
matching project ID; do not accept default-project cookies as child authorization when gateway mode is enabled.
Backend failures return a bounded, sanitized error; a failed child must never route requests to another project.
Supervisor handles shutdown/restart with bounded retry/backoff and exposes actual child readiness.

## Access and UI

Existing global administrators retain access to all configured projects. Migrate existing viewers into default
project membership only. Global administrators manage memberships with project role admin/viewer and explicit
boolean grants for transcripts, recordings and logs. Project admins can manage project operations, not the global
user directory or other project memberships. All requests reload current access; deletion/revocation takes effect
without waiting for token expiry. Unknown/forbidden projects return 403/404 without credentials or other data.
Viewer mutations remain denied, including LiveKit Twirp writes and token creation. List-only Twirp calls remain
readable. Content grants authorize sensitive reads independently of project mutation role; retain existing admin
checks elsewhere. Diagnostics remain project-admin only. Authentication, memberships and permission edits are global
control APIs; scoped me reports effective project role/capabilities plus global-admin status.

Add a project selector in AppShell. Switching projects clears/remounts query state and page-local state; pending
responses and reused room IDs cannot bleed into another project's view. Share project selection in a URL query
parameter so copied UI links identify the project; retain selection on normal navigation and reload. Native media,
exports and downloads must use explicit scoped resource URLs. Single-project isolated test harnesses can retain
legacy default paths. Show friendly project/backend/access errors without redirect loops.

## Project operations

Add an Operations page (project-admin only) with these existing-stack capabilities:
- Durable sanitized audit entries for successful/failed administrative mutations, permission/identity changes,
  destructive actions and content export/deletion. Record actor, project, action, resource route, response status,
  time and request ID; never record passwords, keys, tokens, request bodies, transcript text or sensitive query strings.
- Explicit per-category policies for reports, live events/spans, structured logs, diagnostic content, history,
  worker rollups, repository traffic and audit retention. Existing defaults preserve current behavior; shortening a
  content policy applies to retained content as well as new ingestion, never restores tombstones. Redaction mode/
  terms reuse current privacy code. Recording policy controls access, never deletes S3 objects. Provide bounded
  admin metadata/content export and confirmed category deletion, with precise category/row coverage and an audited
  result. Do not delete users, memberships or credentials through a data-category delete.
- Persist collector last receipt, last source timestamp/ingestion lag, successful sync/check time, failed attempts
  and safe error categories. Disabled collectors remain disabled/unknown, not unhealthy by invention. Include
  backend readiness, configured worker status and last telemetry/webhook ingestion. Reuse current traffic state.
- Durable in-console alert rules/events for stale/down worker endpoints, ingestion failures or stale enabled
  sources, failed calls/egress and measured latency/connection-quality thresholds. Thresholds/enablement are explicit,
  alerts name measured source/window and deduplicate repeated observations. Acknowledge/resolve in console; no Slack,
  email or other external notification delivery in this phase. Missing measurements never become zeros or alerts.
- Storage measurements from SQLite page/file/WAL sizes, per-category row counts, retention windows and recent receipt
  rates. Use observed volume before adding stores/indexes. No external database dependency introduced speculatively.

Operations stores belong to each project's SQLite database except gateway audit/membership control records in the
existing default/control database. Backup instructions must cover the control database, every project database and
operator configuration/secret files separately. Verify consistent SQLite snapshots and restore/integrity of new
stores; never publish operational data or private evidence.

## Acceptance

Use two isolated fake LiveKit servers and distinct SQLite databases, including colliding room/job IDs. Verify project
lists, SDK calls, uploads, reads, recordings/download paths, revocation and denied forged gateway assertions. Exercise
project switching/reload and in-flight responses, project-admin vs global-admin vs content-enabled viewer boundaries.
Verify audit success/failure without secrets, retroactive retention and deletion/export coverage, collector stale/
lag/failure recovery, alert deduplication/acknowledgment, measured storage and backup/restore. Run existing regression
suites/build and desktop/mobile browser checks. Deploy through protected PRs, keep production as default, and verify
live worker/collector/console health plus existing history/recordings. No external calls solely for acceptance.

## Architecture review decisions

The gateway uses a separate control SQLite file (`CONSOLE_CONTROL_DB_PATH`, default sibling `control.db`) to avoid
contending with default-project content maintenance. Existing local users/IDs are copied once from the original
project database; preserve existing login cookies and bootstrap settings. Project backends disable local login/user
routes in child mode. Each child has a distinct random gateway key; assertions pin HS256/audience and expire in 30s.
Membership/content revocation applies to subsequent requests, including subsequent media ranges; it does not recall
bytes already delivered or cancel a currently authorized stream. Child process isolation is application state and
credential configuration isolation, not an OS sandbox against compromised same-UID code.

All existing global admins receive content grants to preserve current access. Project-admin membership alone grants
no sensitive content: grants are explicit. Agent reports/usage/analytics require transcripts; structured log reads
require logs; mixed live telemetry and combined exports require both transcripts and logs; recordings require the
recordings grant. Sensitive content grants authorize reads only, never general mutation/token APIs. Operations
content exports enforce the equivalent category grants even for project admins. Diagnostics remain project-admin.
Remove direct upstream recording-open links and strip upstream recording location URLs from gateway-mode project
JSON responses; all browser playback/downloads use scoped authenticated console resources. This cannot make already
public upstream objects private; bucket ACLs remain the operator's responsibility.

Recording credentials must be explicit project AWS keys or an explicit operator opt-in
`RECORDING_ALLOW_DEFAULT_CREDENTIALS=true`; otherwise fail closed rather than silently discovering shared profiles or
instance credentials. Additional projects never inherit this opt-in. Existing POC uses explicit keys. Proxy before
JSON parsing, strip hop-by-hop/forwarded/identity headers, preserve ingestion authorization, HEAD/Range/status/length,
propagate disconnects and bound connection/header waits (not total playback duration). Existing recording routes do
not implement conditional validators; do not claim them. Never append JSON after forwarding response headers.

Audit lives in the control database and is project-filtered in Operations; `AUDIT_RETENTION_DAYS` is operator/global
configuration (default365). Project administrators cannot erase audit or control identities via category deletion.
Persist a pending audit record before a mutation/content export; fail closed before mutation if that cannot be
written. Finalization failures retain the pending/unknown outcome and must not turn an already committed operation
into an apparent rollback. Never store bodies, secret headers or raw query strings. Use resource route shapes and a
path digest where names may contain personal data. Control and project databases use bounded SQLite busy timeouts.

Independent log retention must cover both dedicated log rows and duplicated log-kind live records. Apply live-job
expiry shortening to future batches of existing jobs. Content deletion retains digests/tombstones; upstream history
metadata may be rediscovered by normal collectors and the UI must say so. Configure private project env/config files
through an optional read-only config-directory mount in deploy.sh; canonicalize database paths and prevent overlap
with the control database. Additional-project failure cannot redirect requests or fail default-project readiness.
