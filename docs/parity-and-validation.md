# Cloud coverage and preview validation

This console provides an administration UI for a self-hosted LiveKit deployment. It does not include LiveKit Cloud's
managed infrastructure or its analytics pipeline. LiveKit's own
[Cloud comparison](https://docs.livekit.io/intro/cloud/#comparing-livekit-cloud-to-self-hosted) distinguishes the shared
server capabilities from managed hosting and observability.

See the [Cloud parity checklist](cloud-parity-checklist.md) for prioritized implementation and acceptance tasks.

## Current coverage

| Area | Console implementation | Remaining difference |
|---|---|---|
| Rooms and participants | Live admin APIs, room actions, participant details and session links | Historical records depend on webhook collection |
| Sessions and calls | Webhook history, SIP attributes, participant/call/agent/egress links | Inbound/outbound direction is inferred; calls that never join a room are not recorded |
| Agent workers | Worker endpoint health, load, SDK, job count, last check and retained worker history | No managed builds, deployments or region inventory; worker IDs require the worker to expose them |
| Agent analytics | Sessions served, join latency, sampled uptime/load; optional admin-only reports, turn timings, model usage/charts, and explicit structured log browsing | Opt-in native SDK events/spans and scoped logs only; no project-wide usage aggregation or synchronized audio |
| SIP configuration | Inbound/outbound trunks, dispatch rules, numbers referenced by configuration | Phone number purchasing and provider billing remain with the SIP provider |
| Recordings and ingress | Egress/ingress admin APIs, egress history, recording location links | Private recordings need storage access or signed URLs; media files are not stored in the console database |
| Usage and charts | Counts and participant durations derived from stored events | No per-session bandwidth, packet loss, FPS or Cloud billing measurements |
| Accounts | Local admin/viewer accounts and bootstrap admin | No organization SSO or Cloud account management |

LiveKit exposes room administration through its
[Room service API](https://docs.livekit.io/reference/other/roomservice-api/). Matching the remaining observability
features requires collecting additional client, SIP-service or agent telemetry and storing it separately; adding UI
controls alone cannot supply those measurements.

## Preview checks

- Frontend and backend type checks and production builds run in CI.
- Browser checks cover login redirects, navigation, encoded room names and URL-backed tabs.
- Repository traffic checks cover fresh/invalid/saved range preferences, loading, initial failure, empty counts and
  retained data after a failed background refresh.
- Responsive checks cover six list/dashboard pages at 375, 768, 1024, 1440 and 1920px. Wide pages use the content
  column without a fixed width cap; wide tables scroll inside their own containers.
- The [backup procedure](deployment.md#back-up-the-database) has been exercised with disposable Docker volumes,
  including a WAL database, account records/roles/password hashes, historical sessions and integrity checks.
- Existing recorded outbound call data has been used to check session ↔ call, session ↔ agent and session ↔ egress
  navigation. Recording metadata links are checked; access to private media depends on the storage provider.

These checks do not establish full Cloud parity. They do not exercise every destructive admin action, every SIP
provider, every storage configuration or every browser.

## Live acceptance verification

Inbound routing, component navigation, final lifecycle state and private recording access have been exercised.
Operational evidence is retained privately. Repeat the [acceptance procedure](validation/inbound-calls.md) with
your provider, agent and storage configuration. Console login alone does not authorize private storage URLs;
integrated recording playback remains a planned feature. These checks do not assess conversational quality.

## Phase 1 native SDK acceptance

The live collection path was exercised on a self-hosted RTC server using Python Agents 1.5.8, a dedicated
agent/room/client and deterministic local model responses. Native conversation, handoff, tool-error,
interruption, model-error, timing, usage and span records correlated with the finalized version-2 report
and job logs. The client received text over RTC. A separate forced queue-overflow run verified that the
collection remained incomplete while its available report and records were readable.

Live browser checks covered session correlation, trace-to-log navigation, combined redacted export,
administrator access, anonymous export denial and a narrow viewport. Node Agents 1.9.3 native message/span
objects and tracer setup were checked separately; the cross-language unit suites cover retry identity,
measurement conversion, bounded failure handling and privacy. Operational evidence stays private.
These are deterministic SDK/RTC tests, not new telephone calls or provider billing evidence. Missing STT/TTS
stages and pre-instrumentation history cannot be reconstructed; existing real inbound-call acceptance remains
separate. See [the integration guide](agent-live-telemetry.md) for repeating collection in your deployment.
