# Features

Layout and styling follow the LiveKit Cloud dashboard. Everything below works against a self-hosted server. What
LiveKit Cloud computes but a self-hosted server does not expose is not faked; see [Not available](#not-available).

## Overview
Live state (rooms, participants, active calls, LiveKit reachability, time of the last webhook), shortcuts, and
Insights charts: total sessions, sessions with agents, sessions with telephony, average session duration, agent
minutes, participants, top countries (from the caller's phone calling code) and participants by kind.

![Overview](images/overview.png)

## Sessions
Every room session recorded from webhooks, with filters for status, features (Agents, SIP, Egress) and agent. A session
page lists its participants, calls, recordings and events, and links to each of them. Each participant has a page
with its details.

![Sessions](images/sessions.png)

## Live rooms
Rooms that exist right now. Create a room (name, empty timeout, max participants) or delete one. A room's page lists its participants (with a button to remove one), lets you dispatch an agent to the room or remove a dispatch, and links to the room's session history.

## Agents
Agent status comes from the workers themselves, not from test jobs. The LiveKit Agents framework runs a status server in
every worker (`GET /` for health, `GET /worker` for name, job type, load, active jobs and SDK version). Set
`AGENT_WORKER_URLS` and the console polls them every 10 seconds.

- **Agents list:** sampled endpoint availability, load, active jobs, SDK, check availability, sessions and agent minutes, plus a session
  activity chart.
- **Running now:** agents currently inside a room, with their state (listening, speaking, thinking).
- **Agent page:** Overview (sessions served and connection latency p50/p90/p95 of when the agent joins a session),
  **Inventory** (stable agent/worker console IDs, linked names, current/archived workers, native IDs when reported,
  lifecycle, safe deployment metadata and independent 30/90/365-day sampled availability/load rollups), Sessions,
  Usage and Performance. [Identity links](agent-inventory.md) include previous names without rewriting source reports.
- **Job type:** `JT_ROOM` means one job per room, `JT_PUBLISHER` one per publishing participant, `JT_PARTICIPANT` one
  per participant.
- **Worker ID:** shown only if the worker reports one; the status server does not include it.

![Agents](images/agents.png)
![Agent detail](images/agent-detail.png)

### Agent session reports

With [optional report uploads](agent-telemetry.md), **Sessions → Agent insights** shows post-session user/agent
text, tool/error/handoff markers, interruption flags and SDK-reported response/LLM/TTS timings. Administrators
can select reports and download their normalized content. Viewer accounts cannot access conversation reports.
Uploads use a separate service token; content expires after the configured retention window (30 days by default).
With [live telemetry](agent-live-telemetry.md) enabled, native events and span timelines are visible before
the final report. Trace/turn filters link to structured logs, combined exports include retained categories,
and collection states identify missing or dropped data. Per-model usage is available in reports and the agent
Usage tab. Configurable standard/strict content redaction applies before storage and to reads/exports;
standard mode is best-effort. Configured S3 Egress recordings can be replayed with waveforms and measured timestamp seeking; see [recordings and analytics](recordings-and-analytics.md).

## Telephony
- **Calls:** SIP calls reconstructed from SIP participants: from, to, direction, duration, status, provider call ID and
  SIP host. Direction is inferred from the attributes LiveKit adds (a dispatch rule means inbound, a trunk only means
  outbound).
- **SIP trunks:** inbound and outbound trunks with create/edit forms and a JSON editor.
- **Dispatch rules:** individual, direct and callee rules, including agent dispatch (`roomConfig.agents`).
- **Phone numbers:** the numbers referenced by your trunks and dispatch rules; each links to the calls for that number.

![Calls](images/calls.png)

## Media
- **Egress:** start room composite, participant, track composite, track or web egress, stop one, and inspect its
  details. The destination and the recording file are shown and linked; storage credentials are redacted.
- **Ingress:** create and delete RTMP/WHIP/URL ingresses.

## Usage
Agent minutes, WebRTC and SIP participant minutes, inbound/outbound telephony minutes and counts, and room sessions,
computed from webhook history.

## Tools
- **Token generator:** mint a join token for a room and identity, with a display name, a TTL and can-publish /
  can-subscribe grants.
- **Repo traffic:** GitHub clones and views per day, kept beyond GitHub's 14 days when `GITHUB_TOKEN` is set.

## Working with the UI
- **Header controls:** one global time range (applies to Overview, Sessions, Calls, Usage, Agents), a Refresh button,
  and an auto-refresh interval (off, 5s, 10s, 30s or 1m).
- **Tables:** search, sorting, column visibility, and pagination; rows link to their detail pages.
- **Forms:** create/edit in a slide-over drawer, with a JSON tab for advanced fields.
- **Search:** `Ctrl K` jumps to any page.
- **Cross-links:** sessions, participants, calls, egress, trunks, dispatch rules and agents link to one another.

## Access control
Sign in with the `.env` admin, then add users under **Settings → Team members**. **Admin** can change anything.
**Viewer** can read standard console data and change nothing; agent conversation reports require **Admin** access.
This is enforced on the server. Role changes and removals apply on
the person's next request.

## Not available
A self-hosted LiveKit server does not expose: per-session bandwidth, latency and FPS graphs, agent observability and
versions, PCAP and codec details per call, calls rejected before a room exists (those never produce a webhook; check
the `livekit-sip` logs), number purchasing, and billing.

Optional agent report uploads collect a limited set of insights directly from the agent process, independently
of those server APIs. They do not reproduce Cloud's full observability pipeline.

### Measured agent performance

Project → Agent analytics compares retained turn timings and native stage durations, with nearest-rank percentiles, exact contributor drilldowns, drag-selected ranges and shareable measurement drawers. Finalized model usage is shown alongside timing coverage; missing data is not counted as zero.

## Measured connection and telephony diagnostics

Administrators can inspect service CPU/memory and aggregate metrics, native participant/track quality charts, reconnect/disconnect events and retained SIP attempts, including pre-room failures. Collection is opt-in; unavailable values remain explicit. See [setup and limits](connection-diagnostics.md).
