# Connection quality and telephony diagnostics

Phase 3 adds administrator-only diagnostics backed by opt-in measurements. Enable `DIAGNOSTICS_ENABLED=true` and
configure `AGENT_TELEMETRY_TOKEN` (at least 32 characters). `DIAGNOSTICS_RETENTION_DAYS` defaults to 30 (1–365).
The upload route is `POST /api/telemetry/diagnostics`, independent of browser login. Never distribute this token to
browser clients; native collectors or a trusted backend should authenticate client statistics.

## Sources and scope

- The host collector reads only configured Docker service instances and projects allowlisted structured SIP fields.
  The console container itself needs neither Docker socket access nor host privileges.
- Native RTC track statistics identify the exact room SID, participant SID, track SID, reporter and observation
  direction. An inbound observation describes media received by that reporter; it is not a server-wide measurement.
- Service CPU is Docker process CPU percent (can exceed 100 on multicore systems); memory is bytes and process count
  is a count. Container running/health does not prove SIP readiness, registration or spare concurrent-call capacity.
  Optional Prometheus counters/gauges remain labeled aggregate, never attributed to a room.
- SIP attempts may exist without a room. Durable native/provider call IDs can later link them to participant attributes.
  Ambiguous matches remain unlinked. Room names alone never correlate reused sessions. Service-reported direction is
  distinguished from the older participant-attribute inference.

Unavailable quality metrics stay absent. Bandwidth and interval loss require successive counters for the same track
and statistics source, with monotonically increasing counters. Counter resets yield a gap. Jitter and RTT use
milliseconds; packet loss percent is distinct from lost/received packet counts. Video FPS is displayed only when
reported for video. Connection-quality indicators do not fabricate packet loss, jitter or RTT.

## Read and upload contracts

Read `/api/diagnostics/services`, `/quality` and `/sip` as an administrator. Anonymous requests receive 401 and viewer
requests 403. Reads are `no-store` and support Unix-ms `from`/`to` windows up to 90 days, `limit` (1–1000) and `offset`.
Quality requires `roomSid`, with optional `participantSid`, `trackSid`, `reporterId` and `direction` filters. SIP supports
`roomSid`, `participantSid`, exact `callId` and `q` (call ID/reason search). Results contain the matching retained page,
not a claim of complete lifetime coverage. Quality replies include room lifecycle events separately from track samples.

Uploads use `{schemaVersion:1,records:[...]}` with 1–100 records and a 256KiB body limit. Every record has stable `id`,
Unix-ms `at` and `kind` (`quality`, `service` or `sip`). Fields are allowlisted; raw headers, credentials, network IPs and
unbounded logs are not stored. Free-text reasons/messages use at least standard redaction. Duplicate records are
idempotent; conflicting IDs reject the entire batch. Retention follows source time, so retries cannot extend access;
expired contents are cleared and retry tombstones prevent restoration. Configure database backup/restore as described
in the deployment guide; this store is included in the same SQLite database.

The native collector and host collector installation instructions follow their scripts. Keep all service tokens,
configuration, cursors, operational evidence and screenshots private. Pre-instrumentation media statistics cannot be
reconstructed from webhooks or aggregate Prometheus histograms.

## References

- [LiveKit SIP service](https://github.com/livekit/sip) exposes structured call logs and optional Prometheus metrics.
- [Native Python RTC SDK](https://github.com/livekit/python-sdks) exposes per-track WebRTC statistics.
- [SIP troubleshooting](https://docs.livekit.io/reference/telephony/troubleshooting/) describes signaling versus RTP failures.

## Host collector installation

Run `scripts/collect-diagnostics.py` on a trusted host with permission to read the configured Docker instances.
Create `$HOME/.config/livekit-console/diagnostics.env` with mode 600. Set `AGENT_TELEMETRY_TOKEN`,
`DIAGNOSTICS_URL=http://127.0.0.1:8090` (your actual console base URL) and `DIAGNOSTICS_CONTAINERS` to a JSON object
mapping `server`, `sip` and `egress` to your container names. Optional metric endpoints must be trusted configuration,
not request-supplied URLs. `DIAGNOSTICS_LOG_LOOKBACK_SECONDS` defaults to 3600 (0–2592000) for the first read only; subsequent reads resume the durable cursor. Use a state directory outside the deployed source tree, protected mode 700.

After enabling diagnostics on the console, run `scripts/install-diagnostics.sh` on that host. It installs the collector
as the invoking user under systemd. Override `DIAGNOSTICS_ENV_FILE` if needed. Review Docker access separately; a
Docker-authorized account already has host-level privileges. The web process never receives Docker control.
To stop collection: `sudo systemctl disable --now livekit-console-diagnostics.service`.

## Native agent integration

Copy `examples/connection_quality.py` beside the existing telemetry helpers. Set `AGENT_QUALITY_ENABLED=true` on
instrumented workers; the existing `start_collection` integration attaches one collector per job and closes it during
shutdown. Keep the normal service-token transport and allow its exact `/api/telemetry/diagnostics` route through any
private ingest proxy. Standalone native RTC code can call `attach_quality(room, send, reporter_id=...)` and await
`collector.close()` on shutdown. Collection is opt-in, observes already subscribed tracks and never opens a new room.
