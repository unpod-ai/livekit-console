# Live agent events and traces

Enable `AGENT_TELEMETRY_EVENTS_ENABLED=true` on the console and worker, alongside the existing dedicated
`AGENT_TELEMETRY_TOKEN` and worker `CONSOLE_URL`. Keep uploads on HTTPS or a trusted private network.
Allow the exact POST routes `/api/telemetry/events`, `/api/telemetry/session-reports`, and optionally
`/api/telemetry/logs` through an upload-only proxy. This does not require making the administration UI public.
The service token grants upload access only; all content reads and downloads require an administrator login.

## Python Agents 1.5.8

Copy both [report uploader](../examples/agent_report_upload.py) and
[live collector](../examples/agent_live_telemetry.py) into the same Python package. Preserve their relative import.
Register once before constructing or starting the native session:

```python
from agent_report_upload import register_shutdown_report
from agent_live_telemetry import attach_session

async def entrypoint(ctx):
    register_shutdown_report(ctx, "my-agent")
    session = AgentSession(...)  # existing models, tools and other options
    attach_session(ctx, session)  # before session.start
    await session.start(agent=my_agent, room=ctx.room)
    await ctx.connect()
```

This legacy shutdown integration requires the SDK to finalize AgentSession before shutdown callbacks; verified
on Python 1.5.8. For other versions verify lifecycle order first. A custom `AgentServer.on_session_end` integration
can call `upload_session_report` followed by the collector's `close()` instead; do not install both shutdown paths.
When sharing an existing OpenTelemetry provider, pass it explicitly to `start_collection` before session start.
Do not configure a competing provider afterward. Span export only copies correlation, stage and timing fields;
prompts, chat context, tool arguments/results and arbitrary span attributes are excluded.

Set `AGENT_LOGS_ENABLED=true` to enable optional namespace-scoped INFO-and-higher live logs. The Python default
namespace is `livekit.agents`; `AGENT_TELEMETRY_LOGGERS` can allow additional comma-separated application namespaces.
Exception stacks and arbitrary structured log attributes are excluded. Audit allowed logger messages for sensitive
content. The report helper also submits fixed job start/shutdown entries. These independent entries do not count
against the live stream's terminal expected count.

## Node Agents 1.9.3

Copy [the Node adapter](../examples/agent_live_telemetry.mjs) alongside your worker; install
`@opentelemetry/sdk-trace-node` in that worker. The console itself needs no Agents SDK dependency.
Node native event/report times are milliseconds; this adapter explicitly converts them to wire seconds, including
speech/session usage durations. Python and Node adapters are deliberately separate.

```javascript
import { context, trace } from '@opentelemetry/api';
import { SessionTelemetry, reportEnvelope, transport } from './agent_live_telemetry.mjs';

async function entrypoint(ctx) {
  const send = transport();
  const collector = new SessionTelemetry(ctx, 'my-agent', { sdkVersion: '1.9.3', send });
  await collector.configureTracing(); // before session.start; uses the native SDK tracer
  const session = new voice.AgentSession({ /* existing model configuration */ });
  collector.attach(session, {
    mode: 'pipeline', // use 'realtime' for a realtime model; never invent STT/TTS timings
    context: () => {
      const span = trace.getSpan(context.active())?.spanContext();
      return span ? { traceId: span.traceId, spanId: span.spanId } : {};
    },
  });
  // Register where your SDK closes AgentSession BEFORE running shutdown callbacks.
  ctx.addShutdownCallback(async () => {
    try {
      await send('/api/telemetry/session-reports', JSON.stringify(
        reportEnvelope(ctx.makeSessionReport(session), 'my-agent', '1.9.3')));
    } finally { await collector.close(); }
  });
  await session.start({ agent: myAgent, room: ctx.room });
  await ctx.connect();
}
```

Preserve existing application cleanup and isolate telemetry failures in your callback. Node logs are explicit:
`collector.emit('log', { level: 'ERROR', message: 'Tool unavailable', turnId, traceId, spanId })`.
Add `logs` to `collector.capabilities` when enabled. Do not enable a process-wide logger implicitly.
Do not copy the constructor outside the opt-in `AGENT_TELEMETRY_EVENTS_ENABLED=true` branch in your application.
Run adapter regression tests with `npm test` and `python3 -m unittest discover -s server/tests -p 'test_*.py'`.
These tests include deterministic event fixtures; native SDK and RTC acceptance must also run in your environment.
Other SDK versions have not been declared compatible automatically.

## Collection states and investigation

Sessions → Agent insights shows live records even before a final report arrives. The header's refresh setting
controls polling. Select a job, category, exact turn or exact trace; selecting a span filters its trace, and
Related logs carries room/job/turn/trace/span correlation into the log viewer. Span bars use actual start/end times
within the current paginated result, not estimated model timings. Final report data remains separately available.

- Receiving: data has arrived and completion has not been confirmed.
- Complete: a terminal marker's unique record count matches, no drops were reported, and any promised final report exists.
- Incomplete: dropped/missing records, missing promised reports, explicit collector failure, or no terminal marker after
  the room ends or 120 seconds without data. This can recover if delayed data arrives within retention.
- Expired: all retained content for the job has expired. Metadata and retry tombstones remain.
- Disabled: new event collection is switched off. Retained data stays readable until its original expiry.

Collectors send a coverage heartbeat every 30 seconds while running. An upload outage can appear incomplete after
120 seconds even if the room remains open; this is a coverage warning, not proof that the worker died. Older report-only jobs cannot reconstruct live traces.
Worker IDs are shown only when supplied (`LIVEKIT_WORKER_ID`); the SDK does not necessarily expose them per job.
Messages may include updated versions of the same native message ID. Usage records are cumulative snapshots and
never contribute again to final-report usage charts. Missing/realtime stages remain unavailable.

## Wire protocol and delivery

`POST /api/telemetry/events`: schemaVersion 1, maximum 256 KiB and 100 records per batch. Envelope fields are
`roomSid`, `jobId`, `agentName`, `batchId`, `sdk: {language, version}`, `participantSid`, `workerId`, `mode`,
`capabilities`, and `entries`. Use opaque identifiers; every record has `id`, `kind`, `at` (Unix seconds) and optional
`turnId`, `traceId` (32 lowercase hex), `spanId` (16 lowercase hex). Spans additionally require `end`, `name`, `stage`;
only validated measurement fields are accepted. Supported kinds are message, tool, handoff, state, error, metrics,
usage, span, log and collection. Tool payloads, system/developer messages and arbitrary attributes are discarded.

Terminal collection records include `state`, `expectedCount` (all unique non-collection records attempted), and
`droppedCount`. Batches and record IDs are immutable. Retries must reuse the exact serialized body; changed records,
identity or terminal markers return 409. End markers can arrive before data without falsely marking completeness.
Adapters cap the queue at 1,000 entries, batch at 25 entries and dedup metadata at 100,000 IDs; overflow is incomplete.
Neither adapter has a durable offline queue. Crashes/outages can lose content or even the final marker. First receipt
sets content expiry; duplicates and late events cannot extend it or restore expired content.

`GET /api/agent-insights/sessions/:sid/telemetry` supports jobId, turnId, traceId, kind and page (100 records/page).
`GET /api/agent-insights/sessions/:sid/export?jobId=...` combines retained reports, live records and logs. Export
is bounded to 50,000 entries per category and a 32 MiB preflight budget (including metadata allowance), otherwise returns 413; use job-scoped export or paginated reads.

## Privacy

`AGENT_TELEMETRY_REDACTION=standard` (default) masks recognizable email, phone and credential patterns in text,
messages and names before storage and on reads/exports. `AGENT_TELEMETRY_REDACT_TERMS` adds comma-separated literal
case-insensitive phrases. `strict` removes freeform content; `off` preserves allowed content. Standard mode is
best-effort pattern matching, not a guarantee that every kind of PII is found. Use source-side redaction or strict
mode when required. IDs and model/provider identities remain intact for correlation and aggregation; keep those opaque.

On startup the current policy also scrubs retained report/event/log content without changing its original retry
digest. A stricter policy cannot restore previously removed text. This is logical database redaction, not secure
erasure of old SQLite pages, WAL files, backups, existing exports or external logs. Apply backup retention separately.
All reads/exports are administrator-only and `Cache-Control: no-store`; browser logout does not delete prior downloads.
