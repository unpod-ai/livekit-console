# LiveKit Cloud parity checklist

Baseline: 2026-10-20. Target: a Cloud-like administration and debugging experience for a self-hosted LiveKit stack.

Checked items describe existing implementation, not certification of every production flow. Unchecked items need
implementation or verification. See [coverage and validation](parity-and-validation.md) for current evidence and limits.
Complete the phases in order; telemetry-dependent screens require their collection path first.

## Existing foundation

- [x] Live rooms and participants, room actions, agent dispatch and token generation.
- [x] Signature-verified lifecycle webhooks stored in SQLite.
- [x] Session, participant, call, agent and egress cross-links.
- [x] SIP trunk and dispatch-rule management, with referenced phone numbers.
- [x] Egress/ingress administration and recording location links.
- [x] Worker health, load, active jobs, last check and sampled history.
- [x] Overview/usage charts, time ranges, manual refresh and automatic refresh.
- [x] Local admin/viewer accounts with server-enforced permissions.
- [x] Documented deployment and database backup/restore.

## Baseline live validation

- [x] Verify a real inbound provider call reaches the intended room and agent.
- [x] Verify inbound direction and trunk/rule references against that real call.
- [x] Follow session ↔ call ↔ participant ↔ agent ↔ egress links on the real call.
- [x] Open a private recording with storage authorization and verify anonymous access is denied.
- [x] Verify the ended call/session duration and final egress status after hangup.

Completed checks establish routing, navigation, final lifecycle state, storage access and file validity;
in-console playback remains Phase 2. Operational evidence is retained privately. Deployers can repeat the
[acceptance procedure](validation/inbound-calls.md) on their own environment.

## Phase 1 — Agent telemetry and Agent Insights

Data source: agent SDK session reports, conversation events, metrics and OpenTelemetry. Worker `/worker` health
responses and room lifecycle webhooks do not contain conversation transcripts or pipeline timings.

### Collection and correlation

Final reports and live events use separate authenticated upload routes. The native integrations and investigation
UI are described in [live telemetry](agent-live-telemetry.md), including supported SDK versions and privacy limits.
Isolated tests cover delivery, redaction, state, export and permissions; native RTC acceptance is tracked below.

- [x] Define and validate the version-1 Python post-session report envelope.
- [x] Accept bounded uploads with a dedicated service token and persist reports independently of webhook arrival.
- [x] Make final-report retries idempotent and reject conflicting room/job reports.
- [x] Enforce administrator-only report reads and expiration without restoring content on retry.
- [x] Accept opt-in structured log batches independently of reports, with atomic retry/conflict handling and content retention.
- [x] Provide a Python log uploader and optional fixed job lifecycle events without collecting process-wide logs.

- [x] Define versioned telemetry records and supported Python/Node Agents SDK versions.
- [x] Provide authenticated ingestion separate from browser login sessions.
- [x] Add agent integration examples for session reports, live events, metrics, traces and structured logs.
- [x] Correlate room SID, participant SID, session/job identifiers, agent identity, worker and trace identifiers.
- [x] Handle retries, duplicate records, late/out-of-order events and interrupted uploads.
- [x] Show collection state: disabled, receiving, incomplete, complete or expired.
- [x] Configure collection, access permissions, retention and redaction before storing conversation content.

### Session experience

- [x] Add an Agent Insights view to session details.
- [x] Display final-report user/assistant text, tool/error/handoff markers, interruption flags and reported timings.
- [x] Download the normalized report shown in the console.
- [x] Collect version-2 per-model token/cache/speech/request counters and display them per final report.
- [x] Preserve version-1 retry compatibility and mark missing or unsupported usage explicitly.
- [x] Aggregate retained model usage per agent with time ranges, coverage gaps, model filters and paginated report drilldowns.
- [x] Display timestamped user/agent transcripts, tool calls, handoffs and errors.
- [x] Display a span timeline for turns, STT, LLM, TTS and tools.
- [x] Search/filter session logs and correlate log lines with turns and traces.
- [x] Browse structured logs by job, exact severity and message text; show supplied turn/trace/span IDs and link reports to job logs.
- [x] Show response latency, stage timing, interruptions and model/token/speech usage where reported.
- [x] Distinguish agent join latency from conversational response latency.
- [x] Handle realtime-model and pipeline-model telemetry differences with explicit unavailable states.
- [x] Export a session's available transcript, events, metrics, traces and logs.

Acceptance:

- [x] Run a real native SDK/RTC agent session and correlate its transcript, trace, logs and usage with the session page (deterministic local model).
- [x] Verify tool calls, an interrupted turn, an agent error and incomplete telemetry remain understandable.
- [x] Verify final-report retries do not duplicate conversation reports or extend retention (isolated HTTP tests).
- [x] Verify report text is inaccessible to anonymous users/viewers (HTTP and browser checks).
- [x] Verify duplicates in the live event/log/usage pipelines do not inflate totals.
- [x] Verify all conversation telemetry categories obey their access rules.

## Phase 2 — Recordings and interactive analytics

- [x] Provide authorized access to private storage using short-lived signed URLs or a controlled streaming endpoint.
- [x] Add in-console audio/video playback with seeking and clear loading, missing and expired-file states.
- [x] Add audio waveform and timestamp synchronization with transcripts and selected turns.
- [x] Record which audio source is available; distinguish Egress media from agent-side recordings.
- [x] Add per-agent/server latency percentiles and stage breakdowns based on collected turn metrics.
- [x] Add model usage breakdowns; label optional rate-based costs as estimates rather than provider invoices.
- [x] Show per-agent retained token and speech usage charts with links to contributing reports; exclude expired data.
- [x] Click a chart bucket or outlier to open the matching sessions.
- [x] Drag to select a time window and apply it consistently across the page.
- [x] Compare selected agents with the same range, filters and metric definitions.
- [x] Preserve chart selections, filters and detail drawers in shareable URLs.

Acceptance:

- [x] Selecting a turn seeks to its matching recording timestamp and highlights its trace/log context.
- [x] Chart drilldowns return the sessions that actually contributed to the selected metric.
- [x] Chart values and percentiles agree with the underlying retained telemetry.

## Phase 3 — Connection quality and telephony diagnostics

Data sources: media-server metrics, client/participant statistics, SIP-service telemetry/logs and, where needed,
provider integrations. Aggregate Prometheus metrics alone do not establish per-session or per-track quality.

- [x] Collect server/SIP/egress service health and capacity metrics.
- [x] Collect session/participant/track quality samples with durable identifiers.
- [x] Show bandwidth, packet loss, jitter, RTT, FPS, reconnects and disconnect reasons where measured.
- [x] Add participant and track quality charts alongside session lifecycle events.
- [x] Collect SIP attempts and failures that occur before a participant joins a room.
- [x] Correlate provider call IDs, SIP call IDs, trunks, dispatch rules, rooms and participants.
- [x] Display SIP response codes, failure stages and termination reasons where available.
- [x] Mark inferred call direction separately from confirmed provider/service data.
- [x] Expose relevant service logs for failures without a room or session record.

Acceptance:

- [x] Investigate a degraded connection using measured quality samples from the correct participant/track.
- [x] A failed pre-room SIP attempt appears with its available identifiers and failure reason.
- [x] Successful inbound and outbound calls retain correct component links after completion.

## Phase 4 — Persistent agent and worker inventory

- [x] Introduce stable console identities for agents and worker instances; retain native IDs when reported.
- [x] Keep historical agent names/aliases so renaming does not hide earlier sessions or workers.
- [x] Persist worker IDs when available; clearly distinguish console IDs from LiveKit-native IDs.
- [x] Retain first seen, last seen, last healthy, stopped/dead state and deployment/version metadata.
- [x] Preserve archived inventory independently of the current 14-day worker sample cleanup.
- [x] Separate sampled endpoint availability from job registration/readiness and session-serving status.
- [x] Add long-range uptime/load rollups with configurable retention.
- [x] Link agents, worker instances, jobs, versions and sessions wherever source identifiers exist.

Acceptance:

- [x] Rename an agent, restart its worker and restart the console; older history remains discoverable.
- [x] Removing an endpoint or expiring raw samples does not erase the archived worker inventory.

Verification: isolated worker polling and fresh-process tests cover rename, native-ID changes, explicit alias merges, endpoint removal and raw-sample expiry. Browser acceptance covers archived/current workers, job/session links, independent long-range selection, mobile width and viewer restrictions. Production agent names remain unchanged. Live deployment checks also verified current and archived inventory, retained rollups, historical navigation, anonymous access denial and an integrity-checked backup of the inventory tables.

## Phase 5 — Administration and operations

- [x] Manage one configured LiveKit server per console (multi-project support removed by explicit scope change).
- [x] Add account roles and configurable access to transcripts, recordings and logs.
- [x] Evaluate organizational SSO/OIDC requirements; retain local accounts until an identity provider is required (OIDC integration deferred, not implemented).
- [x] Record administrative changes and destructive actions in an audit history.
- [x] Configure retention, deletion, export and redaction for each collected data category.
- [x] Show collector health, ingestion lag, last successful sync and collection failures.
- [x] Alert on worker outages, ingestion failures, call failures and measured latency/quality thresholds.
- [x] Monitor ingestion/storage growth and select indexes, rollups or external stores based on measured volume.
- [x] Verify backup and restore after adding each new telemetry store.

Verification: the single-server migration preserved canonical accounts, roles and audit, with an atomic one-time
import and verified snapshots. Live checks cover removed project UI/APIs, existing login/content permissions,
retained sessions and archived workers, Operations/audit, authorized private recording Range playback, mobile
containment and anonymous denial. Worker and collector stayed healthy with zero backlog/drops. Conditional OIDC
remains deferred.

## Phase 6 — Deployment management and agent testing

Requires an explicit integration with our deployment infrastructure; Cloud deployment APIs do not manage our
self-hosted worker fleet.

- [x] Display deployed agent image/version, environment, replicas and region/host where available.
- [x] Integrate build/runtime logs and deployment status with Docker/Kubernetes or the chosen orchestrator.
- [x] Manage deployment secrets through the chosen secret store.
- [x] Support rolling deployments, draining and rollback with visible progress/failures.
- [x] Add a browser test session with explicit agent selection and live transcript/telemetry.
- [x] Add repeatable agent scenarios and compare results across versions.

Verification: 132 server tests, 72 Python tests, two browser suites (7 checks each), web/server builds and protected
CI pass. Independent review fixes have regressions for mixed-case content grants and scenario deletion races.
A disposable real-Docker fixture passed 34 checks for build, immutable images, secrets/redaction, graceful drain
with active-job timeout/reconcile, interrupted-state recovery, exact rollback revision and failed-candidate handling;
all four fixture containers were removed after stopping. Live readonly production inventory denies mutations.
Real LiveKit browser acceptance observed the selected dedicated responder, microphone enable/disable, four actual
prompt responses across two same-revision runs, owned-room cleanup and comparisons with unknown version provenance.
No model/speech provider or carrier calls were needed. Post-test snapshots include scenarios/runs/results and pass
integrity checks. The production worker was not restarted for acceptance.

## Final UI step and combined production release

- [x] Add Light, Dark and System appearance buttons in the top header and login.
- [x] Remember explicit choices across navigation/reloads; System follows live OS changes.
- [x] Verify text, charts, tables, forms, dialogs and recordings in both themes on desktop/mobile.
- [x] Finish every phase's acceptance checks before preparing one combined production release.

Verification: local Chrome theme/administration suite9/9 and RTC/deployment suite7/7, zero errors. Tests cover
pre-React appearance resolution, disabled storage, system/manual overrides, cross-tab changes, keyboard control,
measured text/status contrast >=4.5:1 and chart/form boundaries >=3:1 in both palettes. Live acceptance passed
OS-following, persistence and both themes across eleven pages, mobile forms/dialogs and zero page errors.
The combined production release is v0.1.0; no intermediate phase releases were published.

## Scope boundary

Phone number purchasing, telecom billing, managed inference, globally distributed hosting, autoscaling and
Cloud account billing require their own provider/platform integrations. Treat these as separate projects rather
than completed dashboard features.

## Reference behavior

- [LiveKit Agent Insights](https://docs.livekit.io/testing/observability/insights/)
- [Agent SDK data hooks and self-hosted session reports](https://docs.livekit.io/testing/observability/data/)
- [Build your own observability](https://docs.livekit.io/testing/observability/build/)
- [Cloud agent deployment management](https://docs.livekit.io/deploy/agents/managing-deployments/)
