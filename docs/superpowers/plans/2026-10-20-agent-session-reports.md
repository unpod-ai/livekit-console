# Agent Session Reports Implementation Plan

**Goal:** Accept opt-in post-session agent reports and show protected session transcripts and reported timings.

**Architecture:** Keep the existing Express/SQLite and React/Vite stack. Add a service-token upload route and an
admin-only read route. Store an allowlisted projection of Python Agents session reports, keyed by room SID and
job ID, independently of webhook arrival. Default to collection disabled and 30-day content retention.

**Spec:** Phase 1 of [the Cloud parity checklist](../../cloud-parity-checklist.md). This first slice covers final
session reports only; live events, OTLP traces/logs, redaction rules and aggregate model-usage charts remain open.

## Tasks

- [x] Add HTTP regression tests for authentication, validation, retries/conflicts, late webhook correlation and expiry.
- [x] Add a report table and version-1 normalizer that excludes raw options, system/developer prompts, media,
      tool arguments/results and arbitrary SDK event payloads. Store only user/assistant text, tool/handoff metadata
      and allowlisted numeric message timings. Automatic transcript PII redaction is not part of this slice.
- [x] Accept bounded JSON reports with a dedicated bearer token. Reject conflicting reports for a room/job pair;
      exact normalized retries succeed without extending retention or restoring expired content.
- [x] Add admin-only report reads, expired/disabled/empty states and normalized JSON export. Expired content must
      never be returned, even before periodic cleanup. Reports must not fabricate room/participant history.
- [x] Replace the Agent Insights placeholder with a protected report/transcript view using existing UI components.
- [x] Document the request schema, privacy/retention behavior, Python upload integration and unsupported features.
- [x] Run the targeted tests, production build, browser smoke checks and code review; update checklist precisely.

## Verification result

Eight isolated HTTP tests and four Python helper transport tests pass. The production build passes. Browser checks
cover disabled/empty/received/expired states, reported timings including zero, escaped transcript text, JSON export,
viewer restrictions and horizontal overflow at 375px. The Python helper was checked for stable retries, auth-error
handling, serialization errors and redirect refusal. Review addressed malformed item types and cache control.
No real worker telemetry collection or production deployment was enabled by this slice.

## Acceptance

An authenticated agent can submit a supported final report, retry it safely, and see it on the matching session
after webhooks arrive. Browser login cookies do not authorize uploads. Viewers and anonymous clients cannot read
conversation content. No SDK credentials, tool payloads or prompts are persisted as part of the report. Expired
content stays inaccessible. Tests use isolated databases and synthetic conversations; the live worker is unchanged.
