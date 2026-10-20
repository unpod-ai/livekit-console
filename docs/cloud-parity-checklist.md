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

## Before calling the current preview verified

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

Initial slice implemented locally: authenticated final-report uploads, Python integration example, admin-only
report viewer/export, retry protection and configurable content retention. The complete Phase 1 collection
pipeline remains open; a real agent upload has not yet been enabled or verified on the POC deployment.

- [x] Define and validate the version-1 Python post-session report envelope.
- [x] Accept bounded uploads with a dedicated service token and persist reports independently of webhook arrival.
- [x] Make final-report retries idempotent and reject conflicting room/job reports.
- [x] Enforce administrator-only report reads and expiration without restoring content on retry.

- [ ] Define versioned telemetry records and supported Python/Node Agents SDK versions.
- [ ] Provide authenticated ingestion separate from browser login sessions.
- [ ] Add agent integration examples for session reports, live events, metrics, traces and structured logs.
- [ ] Correlate room SID, participant SID, session/job identifiers, agent identity, worker and trace identifiers.
- [ ] Handle retries, duplicate records, late/out-of-order events and interrupted uploads.
- [ ] Show collection state: disabled, receiving, incomplete, complete or expired.
- [ ] Configure collection, access permissions, retention and redaction before storing conversation content.

### Session experience

- [x] Add an Agent Insights view to session details.
- [x] Display final-report user/assistant text, tool/error/handoff markers, interruption flags and reported timings.
- [x] Download the normalized report shown in the console.
- [ ] Display timestamped user/agent transcripts, tool calls, handoffs and errors.
- [ ] Display a span timeline for turns, STT, LLM, TTS and tools.
- [ ] Search/filter session logs and correlate log lines with turns and traces.
- [ ] Show response latency, stage timing, interruptions and model/token/speech usage where reported.
- [x] Distinguish agent join latency from conversational response latency.
- [ ] Handle realtime-model and pipeline-model telemetry differences with explicit unavailable states.
- [ ] Export a session's available transcript, events, metrics, traces and logs.

Acceptance:

- [ ] Run a real agent session and correlate its transcript, trace, logs and usage with the existing session page.
- [ ] Verify tool calls, an interrupted turn, an agent error and incomplete telemetry remain understandable.
- [x] Verify final-report retries do not duplicate conversation reports or extend retention (isolated HTTP tests).
- [x] Verify report text is inaccessible to anonymous users/viewers (HTTP and browser checks).
- [ ] Verify duplicates in the future live event/log/usage pipelines do not inflate totals.
- [ ] Verify all future conversation telemetry categories obey their access rules.

## Phase 2 — Recordings and interactive analytics

- [ ] Provide authorized access to private storage using short-lived signed URLs or a controlled streaming endpoint.
- [ ] Add in-console audio/video playback with seeking and clear loading, missing and expired-file states.
- [ ] Add audio waveform and timestamp synchronization with transcripts and selected turns.
- [ ] Record which audio source is available; distinguish Egress media from agent-side recordings.
- [ ] Add per-agent/project latency percentiles and stage breakdowns based on collected turn metrics.
- [ ] Add model usage breakdowns; label optional rate-based costs as estimates rather than provider invoices.
- [ ] Click a chart bucket or outlier to open the matching sessions.
- [ ] Drag to select a time window and apply it consistently across the page.
- [ ] Compare selected agents with the same range, filters and metric definitions.
- [ ] Preserve chart selections, filters and detail drawers in shareable URLs.

Acceptance:

- [ ] Selecting a turn seeks to its matching recording timestamp and highlights its trace/log context.
- [ ] Chart drilldowns return the sessions that actually contributed to the selected metric.
- [ ] Chart values and percentiles agree with the underlying retained telemetry.

## Phase 3 — Connection quality and telephony diagnostics

Data sources: media-server metrics, client/participant statistics, SIP-service telemetry/logs and, where needed,
provider integrations. Aggregate Prometheus metrics alone do not establish per-session or per-track quality.

- [ ] Collect server/SIP/egress service health and capacity metrics.
- [ ] Collect session/participant/track quality samples with durable identifiers.
- [ ] Show bandwidth, packet loss, jitter, RTT, FPS, reconnects and disconnect reasons where measured.
- [ ] Add participant and track quality charts alongside session lifecycle events.
- [ ] Collect SIP attempts and failures that occur before a participant joins a room.
- [ ] Correlate provider call IDs, SIP call IDs, trunks, dispatch rules, rooms and participants.
- [ ] Display SIP response codes, failure stages and termination reasons where available.
- [ ] Mark inferred call direction separately from confirmed provider/service data.
- [ ] Expose relevant service logs for failures without a room or session record.

Acceptance:

- [ ] Investigate a degraded connection using measured quality samples from the correct participant/track.
- [ ] A failed pre-room SIP attempt appears with its available identifiers and failure reason.
- [ ] Successful inbound and outbound calls retain correct component links after completion.

## Phase 4 — Persistent agent and worker inventory

- [ ] Introduce stable console identities for agents and worker instances; retain native IDs when reported.
- [ ] Keep historical agent names/aliases so renaming does not hide earlier sessions or workers.
- [ ] Persist worker IDs when available; clearly distinguish console IDs from LiveKit-native IDs.
- [ ] Retain first seen, last seen, last healthy, stopped/dead state and deployment/version metadata.
- [ ] Preserve archived inventory independently of the current 14-day worker sample cleanup.
- [ ] Separate sampled endpoint availability from job registration/readiness and session-serving status.
- [ ] Add long-range uptime/load rollups with configurable retention.
- [ ] Link agents, worker instances, jobs, versions and sessions wherever source identifiers exist.

Acceptance:

- [ ] Rename an agent, restart its worker and restart the console; older history remains discoverable.
- [ ] Removing an endpoint or expiring raw samples does not erase the archived worker inventory.

## Phase 5 — Project administration and operations

- [ ] Support multiple configured LiveKit projects with isolated credentials, data and permissions.
- [ ] Add project-scoped access and configurable access to transcripts, recordings and logs.
- [ ] Add SSO/OIDC if organizational access requires it.
- [ ] Record administrative changes and destructive actions in an audit history.
- [ ] Configure retention, deletion, export and redaction for each collected data category.
- [ ] Show collector health, ingestion lag, last successful sync and collection failures.
- [ ] Alert on worker outages, ingestion failures, call failures and measured latency/quality thresholds.
- [ ] Monitor ingestion/storage growth and select indexes, rollups or external stores based on measured volume.
- [ ] Verify backup and restore after adding each new telemetry store.

## Phase 6 — Deployment management and agent testing

Requires an explicit integration with our deployment infrastructure; Cloud deployment APIs do not manage our
self-hosted worker fleet.

- [ ] Display deployed agent image/version, environment, replicas and region/host where available.
- [ ] Integrate build/runtime logs and deployment status with Docker/Kubernetes or the chosen orchestrator.
- [ ] Manage deployment secrets through the chosen secret store.
- [ ] Support rolling deployments, draining and rollback with visible progress/failures.
- [ ] Add a browser test session with explicit agent selection and live transcript/telemetry.
- [ ] Add repeatable agent scenarios and compare results across versions.

## Scope boundary

Phone number purchasing, telecom billing, managed inference, globally distributed hosting, autoscaling and
Cloud account billing require their own provider/platform integrations. Treat these as separate projects rather
than completed dashboard features.

## Reference behavior

- [LiveKit Agent Insights](https://docs.livekit.io/testing/observability/insights/)
- [Agent SDK data hooks and self-hosted session reports](https://docs.livekit.io/testing/observability/data/)
- [Build your own observability](https://docs.livekit.io/testing/observability/build/)
- [Cloud agent deployment management](https://docs.livekit.io/deploy/agents/managing-deployments/)
