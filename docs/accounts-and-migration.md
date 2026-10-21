# Accounts and single-server migration

Each console manages one LiveKit server, configured through `LIVEKIT_URL`, `LIVEKIT_API_KEY` and
`LIVEKIT_API_SECRET`. There is no project selector, project creation, project membership or separate backend process.
Run separate console instances with separate databases/environments to administer different servers.

Administrators manage resources, accounts and Operations. Viewers cannot modify resources. Each database account also
has independent transcript, recording and log permissions, editable under Settings → Team members. Administrator role
alone does not override explicitly disabled content permissions. The environment bootstrap administrator retains all
permissions. Account changes and removals take effect on subsequent requests; they cannot recall bytes already served.

## Upgrade from the former gateway

Before upgrading, take consistent snapshots of both `console.db` and the old `control.db`, and back up the private
environment. The application now uses only `console.db`. On its first startup, it discovers a sibling `control.db`
and atomically imports canonical users, password hashes, account IDs, account roles, default content permissions and
relevant audit records. `LEGACY_CONTROL_DB_PATH` optionally supplies a different source location for this one-time
migration. A configured missing or invalid source fails startup rather than silently using stale users.

The source is read-only and remains on disk for rollback. Accounts deleted from the canonical control database are
not revived from the older application database. Existing account IDs and sequence high-water marks are preserved,
so deleted IDs are not reused. A former project-level administrator is not promoted to console administrator. Existing
session cookies remain usable when the session secret and migrated account match.

After successful migration, a database marker prevents re-import on later restarts. Session/participant/egress,
worker history, recording metadata, telemetry and Operations data remain in the application database. Old project
configuration and backend port variables are no longer used. Routes use `/api/*`, `/webhook` and `/api/telemetry/*`;
remove old project prefixes from external integrations before upgrading. Scoped project routes are not supported.

Verify database integrity, database-managed login, roles/content permissions, audit rows, history, worker inventory and
private recording playback after the upgrade. Once verified, retain the old source with the pre-upgrade backup rather
than deleting it automatically. For rollback, restore the matched old application/control snapshots and previous
image together. Never restore only one member of an old gateway backup pair.
