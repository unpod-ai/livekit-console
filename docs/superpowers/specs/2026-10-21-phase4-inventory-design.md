# Persistent agent and worker inventory

Implement Phase 4 of the approved roadmap in the existing React/Express/SQLite stack. Preserve native names and IDs;
console IDs must be labeled separately. Agent identities and aliases persist independently of session activity and
worker sample retention. A name change does not establish identity merely because an endpoint was reused: an
administrator explicitly links a previous name or merges its existing historical identity. Old console IDs resolve
to the canonical identity; source reports and session attributes are never rewritten.

Worker records survive endpoint removal, console restart and raw sample cleanup. Native worker IDs distinguish
instances when reported. Without a native ID, identity is an endpoint/agent observation, not proof of a process
restart. An optional configured instance marker permits deployments to distinguish otherwise anonymous workers.
Persist first/last observation, last healthy, last check, archived/stopped state and safe deployment/version metadata.
Health endpoint availability, valid worker info, native registration/readiness and serving jobs are separate facts;
never infer registration from HTTP 200. Stale observations must not claim a current healthy worker.

Hourly rollups retain counts of successful/failed checks and reported load sums/counts. They describe sampled endpoint
availability, not continuous uptime. Keep raw samples 14 days and make rollup retention configurable; expose rounded
hour boundaries and coverage. Missing load stays unavailable. Migrate existing retained samples exactly once and
backfill agent names from existing participants/reports/live jobs without inventing expired process history.

Agent overview/list/session filters recognize aliases; selected raw-name performance comparisons remain explicitly
named source populations. Usage and session history under a stable agent identity include linked aliases. Worker
inventory stays within an agent detail page, with native/console IDs, lifecycle, metadata and known native-ID job links.
Admin-only identity-linking writes require explicit existing-source identity confirmation and reject collisions/cycles;
viewers retain current read permissions. Keep all operational identifiers/evidence private.

Acceptance: restart/reopen the console with a renamed test agent and changing native worker IDs; old names, instances
and session links remain discoverable. Remove an endpoint and expire raw samples; archived identities and retained
rollups survive. Use isolated tests and a dedicated fake status endpoint for lifecycle changes; do not rename/restart
production agents solely for acceptance. Deploy protected PRs; no tags/releases/version bumps. Theme remains deferred.
