# Phase 2 recordings and interactive analytics

> Execute task-by-task with the executing-plans workflow. The approved Cloud-parity checklist defines scope.

**Goal:** Investigate measured agent performance and replay authorized recordings against the same session timeline.

**Architecture:** Administrator-only S3 streaming resolves stored egress IDs through a trusted configured bucket/endpoint,
not arbitrary request/history URLs. Native media controls and bounded client-side waveform decoding share URL timestamp
selection with transcript/spans/logs. Analytics projects measurement fields from retained reports/live records and exposes
exact contributing samples, using one explicit range/filter definition for charts, comparison and drilldowns.

**Tech stack:** Existing Express/SQLite/React/Vite; AWS S3 SDK for authenticated ranged object access; Web Audio/SVG.
**Spec:** `docs/cloud-parity-checklist.md`, Phase 2.

## Constraints and review focus

- Keep the UI VPN-restricted, credentials server-only and content administrator-only. No releases/tags/version bump.
- Reject arbitrary URLs, unconfigured buckets, traversal, unsafe byte ranges and unsupported media manifests.
- Distinguish storage missing/expired/unconfigured errors. Never infer an unknown recording start timestamp.
- Waveforms must derive from decoded audio; bound decode bytes/duration and show unavailable for unsupported sources.
- Count each canonical SDK message measurement once across live updates and final reports; never sum cumulative snapshots.
- Show unavailable stages and coverage gaps, nearest-rank percentiles, source/time definitions and exact contributors.
- Preserve ranges, selected agents/metric/bucket/sample and media timestamp in URLs. Scope all comparisons identically.

## Task 1: Authorized recordings

Files: `server/src/recordings.ts`, `server/src/config.ts`, server routing/dependencies, `server/tests/recordings.test.ts`.
- [x] Test resolver rejection, trusted storage mapping, missing/expired sources, anonymous/viewer denial and valid/invalid/suffix ranges.
- [x] Implement session recording inventory and bounded authenticated S3 HEAD/GET streaming with cancellation and no-store headers.
- [x] Configure existing POC storage credentials privately; preserve source metadata and file-start timestamps without exposing secrets.

## Task 2: Playback and synchronized investigation

Files: `web/src/components/SessionRecordings.tsx`, waveform utilities, AgentInsights/LiveInsights/log/egress links.
- [x] Add source selection, native audio/video seeking and loading/unavailable/missing/expired states.
- [x] Decode bounded actual audio into a seekable SVG waveform; cancel work on source switch/unmount.
- [x] Map measured absolute timestamps to file offsets; selected transcript/spans/logs share context and URL state.
- [x] Verify private playback, byte seeking, source switches, invalid offsets, no false alignment and narrow layout in a browser.

## Task 3: Measurement analytics

Files: `server/src/turn-analytics.ts`, `server/src/performance.ts`, telemetry mounting, analytics unit/HTTP tests.
- [x] Test native measurement deduplication, expiry, zero/missing values, nearest-rank percentiles and agent/stage/time isolation.
- [x] Project only required fields from retained reports/events and usage; reject oversized investigations explicitly.
- [x] Return per-agent distributions/buckets, available models, coverage and paginated exact contributing samples.
- [x] Test identical comparison ranges, bucket drilldowns, unsupported filters and administrator-only content access.

## Task 4: Interactive analytics UI

Files: performance chart/page/components, AppShell/App routes and AgentDetail links.
- [x] Add selected-agent comparison, measured metric/stage and range controls, distributions and model breakdowns.
- [x] Click a chart bucket/outlier to see exact contributors; drag a range to filter the whole page.
- [x] Keep range/filter/bucket/drawer URLs shareable and validate empty/error/expired cases without invented zeros.
- [x] Browser-check brush selection, same-filter comparisons, contributor/session links, drawer reload and mobile layout.

## Task 5: Ship and acceptance

- [x] Review code; run complete tests/builds and targeted browser/security checks.
- [x] Merge protected PRs and deploy, taking a consistent pre-deploy DB backup and retaining rollback configuration.
- [x] Verify authorized playback/seek/waveform against retained real egress media without exporting recordings publicly.
- [x] Verify synchronized media against a controlled native RTC session with an actual recording and timestamped telemetry.
- [x] Cross-check chart statistics and contributors against retained data; update checklist only for proven outcomes.
