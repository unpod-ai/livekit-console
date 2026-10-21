# Project operations

Project administrators can open Operations for collector health, measured storage, collection policy, in-console
alerts and project audit history. Additional projects use the same controls with their own database and policy.
See [projects and access](project-administration.md) for membership/content grants.

## Policy and local data controls

Policies cover reports, live events/spans, structured logs, diagnostic content, session/event/egress history,
worker check rollups, repository traffic and recording access. Existing history/traffic defaults remain unlimited;
content defaults retain the existing environment settings. Shortening retention applies to existing content as well
as new receipts. Extending a window does not restore expired content. Log policy covers dedicated logs and log-kind
live-record copies. Existing live-job deadlines also bound future batches.

Content redaction reuses standard/strict/off handling and custom terms for reports, live records, logs and diagnostic
free text. Diagnostics always retain at least standard redaction. Operational identities/history are preserved for
component links; deleting a local history category is separate from content redaction.

Exports disclose their category, row/table coverage and limits; metadata is the default. Content exports require
corresponding content grants, are redacted and fail with 413 rather than silently truncate when row/byte budgets are
exceeded. Upstream webhook/egress credential payloads are excluded from metadata exports. Category deletion requires
confirmation of the exact category. Content digests/tombstones remain so known retries cannot restore deleted text.
Local history, traffic or worker check metadata can be collected again from upstream sources; deletion does not stop
collection or erase upstream data. Recording controls disable/expire console access and never delete S3 objects.
Users, memberships, credentials and audit are excluded from project category deletion.

## Health, storage and alerts

Collector status separates configured/disabled/unknown sources, last receipt, last successful check/sync, source
timestamp, measured ingestion lag, rejected/failing attempts and recent receipt rate. Safe error categories contain
no provider response bodies, credentials or transcript text. No receipts means unknown coverage, not invented health.
A quiet webhook source does not prove a failure; stale-source rules must be explicitly configured for expected traffic.

Storage measurements include SQLite pages/free pages, database/WAL bytes, category row counts and configured retention.
These are measured values, not predicted capacity. No additional database or external metrics store is required.

Alert rules are explicit and initially empty. Operators select the source, enabled state, threshold and observation
window. Available rules cover worker endpoint outages, stale sources, ingestion failures, failed calls/egress and
measured latency or connection quality. Missing measurements do not become zero. Repeated observations deduplicate;
operators can acknowledge/resolve events. These are in-console alerts; external email/Slack delivery is not configured.

## Audit

The control database records project-filtered administrative actions and sensitive content access with actor, time,
request ID, route shape/path digest and response status. Request bodies, credentials and query strings are not stored.
A durable pending record is written before starting mutations/content access; if that fails, the operation is denied.
If completion cannot be recorded, the pending result stays unknown rather than implying a committed operation was
rolled back. AUDIT_RETENTION_DAYS controls central audit retention (default 365; range 1–3650). Project admins cannot
erase the central audit trail through data-category deletion.

## Backup and restore

Create consistent SQLite snapshots with VACUUM INTO or the SQLite backup API. Back up the control database and every
project database; copying only console.db misses accounts/memberships/audit after the gateway migration. Capture the
private project-config/env files separately with restricted access. They contain credentials and are not part of JSON
exports or public repository artifacts.

To restore, stop the console gateway and its children, restore the matching control/project snapshots and private
operator configuration, then restart with the same project IDs and correct database paths. Check PRAGMA integrity_check,
accounts/memberships, policies/tombstones, collectors/rules/alerts and representative session/worker/recording links.
Do not publish backups or operational screenshots.

Failure-count alert windows use one-minute counter buckets, including the first partial boundary minute. Worker
outage rules additionally require a recent failed check; threshold counts failed observations, not a proven outage
duration. Failed-call rules count distinct observed call IDs with explicit final failure stages, excluding SIP
401/407 challenges and unknown outcomes. A later recognized successful outcome supersedes a failure for that call.
