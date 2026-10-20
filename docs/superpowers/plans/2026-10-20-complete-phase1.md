# Complete Phase 1 Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement and verify each task without pausing between tasks.

**Goal:** Complete the Phase 1 collection, session investigation and acceptance requirements in the Cloud parity checklist.

**Architecture:** Extend service-token ingestion with immutable live event batches and job collection metadata. Reuse
SQLite retention and administrator permissions; attach native SDK events and an OpenTelemetry exporter before session
start. Render live turns, spans and correlated logs alongside final reports, and export every retained category.

**Tech Stack:** Existing Node/Express/SQLite/React stack; Python Agents 1.5.8 and its installed OpenTelemetry SDK;
Node SDK integration example with explicit supported-version tests. No Cloud observability dependency.

**Spec:** `docs/cloud-parity-checklist.md`, Phase 1.

## Global constraints

- Preserve version-1/version-2 report retry digests and existing administrative features.
- All content reads/exports are administrator-only. Service credentials authorize ingestion only.
- Redact content before storage and on reads; keep identifiers opaque and document privacy limits.
- Keep first-receipt expiry and immutable tombstones across retries, duplicates and late events.
- Never infer missing timings or count live usage snapshots again in final-report usage totals.
- No intermediate version bump, tag or release. Defer the final day/night theme step.
- Do not publish operational datasets, production identifiers, credentials or transcript content.

## Review focus

- An end marker arriving before its events must remain incomplete until the promised events arrive.
- A crashed worker or full/offline uploader queue must leave a visible incomplete state, not a complete session.
- Realtime models may have no STT/TTS stages; those values must remain unavailable.
- Privacy changes must cover existing report/log content and downloads without breaking retry identity.
- Large exports and stale/expired data must not bypass retention, pagination or access rules.

## Task 1: Privacy policy

Files: `server/src/telemetry-privacy.ts`, config, report/log ingest/read paths and regression tests.
- [x] Add standard/off/strict policies and bounded literal redaction terms; test emails, phones, credentials and strict content removal.
- [x] Apply before storage/on reads and scrub retained legacy content; preserve the original normalized digest for retry compatibility.
- [x] Verify reports, logs and exports obey the same policy and expiry rules.

## Task 2: Versioned live events, spans and collection state

Files: `server/src/live-telemetry.ts`, `server/src/db.ts`, telemetry routes, HTTP tests.
- [x] Add `/api/telemetry/events` with room/job metadata and bounded immutable records for messages/tools/handoffs/errors/states/metrics/usage/spans/logs/control.
- [x] Validate identifiers, times, numeric metrics and SDK metadata; discard arbitrary attributes/prompts/tool arguments/results.
- [x] Persist atomic batch/record deduplication, terminal expected counts and dropped counts. Honor late events without reopening terminal jobs.
- [x] Add admin-only paginated collection reads, exact turn/trace filters, lifecycle/coverage states and combined JSON export.
- [x] Test malformed/oversized input, retries/conflicts, out-of-order completion, missing reports, dropped data, stalled jobs, expiry and every role/category.

## Task 3: Native SDK integrations

Files: Python live collector/exporter, existing report helper, Node example and tests.
- [x] Subscribe before session start to native conversation/tool/handoff/state/error/metric events and route OTel spans through a bounded exporter.
- [x] Keep bounded queues and stable IDs/bodies, record dropped events, flush before a terminal marker and isolate failures from job cleanup.
- [x] Correlate available participant/worker/job/turn/trace IDs; declare SDK/mode/capabilities explicitly.
- [x] Provide Python and Node setup/examples and executable adapter tests. Report unsupported/missing categories explicitly.

## Task 4: Agent Insights experience

Files: live telemetry/timeline UI, Agent Insights, log filters and browser checks.
- [x] Show collection status, live transcript/tool/error/handoff events, interruption markers and measured response/stage timing.
- [x] Render real spans as a selectable timeline and correlate selected turn/trace with event/log filters.
- [x] Provide a combined retained-data export, source/availability labels and explicit pipeline/realtime differences.
- [x] Verify loading/empty/disabled/incomplete/expired states, XSS, URL filters, export, viewer denial and mobile layout.

## Task 5: Deploy and verify acceptance

- [x] Review/run full regression suites and production builds, merge through protected PR and deploy console/proxy before worker changes.
- [x] Attach the integration to actual worker session construction and activate while idle, preserving rollback artifacts privately.
- [x] Exercise a real native SDK/RTC session on the self-hosted server; verify transcript, traces, logs, usage, tools, interruption/error/incomplete states and exports.
- [x] Retain operational evidence privately; distinguish deterministic test providers from provider-call evidence. Update checklist only with verified outcomes.
- [x] Leave any external acceptance dependency explicit; publish no release.
