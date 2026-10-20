# Agent session reports

This opt-in integration adds post-session conversation reports to **Sessions → Agent insights**. It works with a
self-hosted media server; it does not use Cloud observability APIs. Current support is the snake_case report from
Python Agents `JobContext.make_session_report().to_dict()`. For live events, tracing and the explicit Node SDK adapter, see [live telemetry](agent-live-telemetry.md).

For independent structured application logs and job lifecycle messages, see [agent logs](agent-logs.md).

## Enable collection

Set a separate, randomly generated `AGENT_TELEMETRY_TOKEN` of at least 32 characters on the console server. Leave it
unset to disable uploads. This is not a LiveKit API secret, browser session cookie or user password. Set the same
token and `CONSOLE_URL` on the agent. Use HTTPS for remote uploads, or a trusted loopback connection on the same host.
The agent must be allowed to reach the console's upload route through your existing network allowlist.
Ensure the reverse proxy also accepts the intended report body size, up to the application's 2 MiB limit.

Restart the console after configuration changes. Setting `AGENT_TELEMETRY_RETENTION_DAYS` changes the retention of
new reports (default 30 days, valid range 1–365); it does not extend existing reports.

## Python integration

Copy [the upload helper](../examples/agent_report_upload.py) into your agent project and call it from the existing
session-end callback. It uses the standard library and your installed LiveKit Agents SDK; no new client package
is required. Check that your SDK exposes `make_session_report()` before integrating.

```python
from livekit.agents import AgentServer, JobContext
from agent_report_upload import upload_session_report

server = AgentServer()
AGENT_NAME = "my-agent"

async def on_session_end(ctx: JobContext) -> None:
    await upload_session_report(ctx, AGENT_NAME)

@server.rtc_session(agent_name=AGENT_NAME, on_session_end=on_session_end)
async def entrypoint(ctx: JobContext):
    # Keep your existing agent/session setup here.
    await ctx.connect()
```

Add this call to an existing callback rather than replacing application cleanup. Allow the callback enough time
to upload; the helper makes two attempts with a 3-second request timeout and a short delay. It constructs the
report once and reuses the body for retries. Upload failures are logged without payloads or credentials. This
helper has no durable queue: a worker crash or prolonged outage can lose a report. Apply source-side redaction as needed and configure the console’s [privacy policy](agent-live-telemetry.md#privacy) before collection.

### Legacy WorkerOptions integrations

For SDKs that close the primary `AgentSession` before invoking job shutdown callbacks (verified with Python
Agents 1.5.8), the helper also provides a registration function. Call it once at the beginning of your existing
entrypoint, keeping the application's other cleanup callbacks:

```python
from agent_report_upload import register_shutdown_report

async def entrypoint(ctx: JobContext):
    register_shutdown_report(ctx, "my-agent")
    # Keep the existing connection and AgentSession setup here.
```

Choose either this shutdown hook or the `on_session_end` integration. Do not register both. The registration
function does nothing when collection is not configured. Upload exceptions are isolated from application cleanup.
A handler that never creates a native `AgentSession` cannot produce this SDK report; it needs its own adapter.
Check the shutdown order for your installed SDK before using this hook.

### Workers in a separate container network

A worker container cannot reach a host service through its own `127.0.0.1`. Use a reachable internal endpoint for
`CONSOLE_URL`. If the console UI must stay bound to host loopback, an upload-only proxy can listen on the worker's
private network gateway and forward only `/api/telemetry/session-reports` to the console. Keep other routes closed,
retain bearer-token authentication, and limit the proxy's bind address and source network. The public admin UI
does not need broader access for agent uploads.

## Upload contract (versions 1 and 2)

`POST /api/telemetry/session-reports` requires `Authorization: Bearer <AGENT_TELEMETRY_TOKEN>` and JSON of at most
2 MiB. Browser login does not authorize uploads. The envelope is:

```json
{
  "schemaVersion": 2,
  "agentName": "my-agent",
  "participantSid": "PA_optional",
  "workerId": "AW_optional",
  "report": {
    "room_id": "RM_example",
    "job_id": "AJ_example",
    "sdk_version": "1.5.8",
    "timestamp": 1700000010,
    "usage": [
      {"type": "llm_usage", "provider": "example", "model": "my-model", "input_tokens": 120, "input_cached_tokens": 20, "output_tokens": 40},
      {"type": "tts_usage", "provider": "example", "model": "my-voice", "characters_count": 80, "audio_duration": 3.5}
    ],
    "chat_history": {
      "items": [
        {"id": "turn-1", "type": "message", "role": "user", "content": ["Hello"], "created_at": 1700000000},
        {"id": "turn-2", "type": "message", "role": "assistant", "content": ["Welcome"], "created_at": 1700000001,
         "metrics": {"llm_node_ttft": 0.2, "tts_node_ttfb": 0.1, "e2e_latency": 0.7}}
      ]
    }
  }
}
```

All SDK timestamps and durations in this input are seconds; stored timestamps are milliseconds. The room SID
and job ID are required. Optional participant/worker IDs must come from your integration; the helper does not
invent them. At most 5,000 history items and 64,000 text characters per message are accepted.

A new report returns 201. An identical normalized report for the same room/job returns 200 without duplicating
content or extending retention. Different normalized content or metadata for that room/job returns 409. A final
report is immutable; this endpoint does not accept growing snapshots. Invalid shapes return 422, malformed JSON
returns 400 and oversized bodies return 413. A missing/invalid service token returns 401; disabled collection returns 503.

Reports are correlated by room SID even if they arrive before webhooks. Uploads do not fabricate sessions or
participants. A session page becomes available once normal session history exists. Conversation item order follows
the SDK report; timestamps are shown when present. Realtime models may omit pipeline-specific turn timings.

## Stored content and access

The database stores an allowlisted projection: user/assistant text, tool names/call IDs/error flags, handoff IDs,
interruption flags, supported numeric turn timings and version-2 model usage counters. Raw report options/events,
system/developer prompts, tool arguments/results, media and arbitrary extra fields are discarded. Text itself can
contain personal information or secrets; the allowlist is not transcript redaction. The collection token is an
explicit opt-in to storing this content.

Only signed-in administrators can read or download reports. Viewer accounts and the upload token cannot read
them. Downloads contain the same normalized content displayed by the console, not the original SDK payload.
The latest 100 report summaries are listed per room; only the selected report's content is returned.

Content expires from the time it is first received. Reads enforce expiry immediately, and cleanup removes expired
content on startup, during report access/uploads and hourly. Identifying metadata and a content digest remain so
expired reports can be recognized and retries cannot restore them. Logical deletion does not scrub SQLite WAL,
old backups or copies already downloaded; manage their retention separately.

## Model usage (version 2)

Version 2 accepts the SDK's `report.usage` model summaries and displays them in the session's Agent Insights tab.
The helper restores each typed usage object's `type`, `provider` and `model` fields: Python SDK 1.5.8's default
suppression omits the type discriminator from `to_dict()`. Custom upload adapters must preserve these fields too.
Deploy the updated console before updating the Python upload helper. Version 1 uploads remain accepted with their
original normalization and retry digest; usage in version 1 is still ignored. Existing reports are immutable:
re-uploading a finalized version-1 job as version 2 returns 409 rather than changing its content or retention.

Supported kinds are `llm_usage`, `tts_usage`, `stt_usage`, `interruption_usage` and `eot_usage`. Provider/model names
may be empty when the SDK has no metadata; the UI labels them unknown. Up to 200 entries with names of at most
200 characters are accepted. Duplicate type/provider/model combinations are rejected. Counters must be nonnegative
safe integers; audio and session durations must be finite, nonnegative seconds within the safe numeric range.
Unknown kinds are excluded and counted so the UI marks the result incomplete. Unknown fields are discarded.

The SDK omits default zero counters when serializing known model rows, so absent counters in those rows normalize
to zero. An absent/null usage collection means **not reported**; an empty collection means no model rows were
reported. Neither state reconstructs historical consumption. These counters were checked against Python Agents
1.5.8's usage schema; newer optional cache-creation, reasoning, STT-audio and end-of-turn counters are also accepted.
Empty default counters do not establish that a provider exposes every breakdown.

LLM input/output totals already include their cached/audio/text/image subsets; reasoning tokens are included in
output tokens. Do not add these breakdowns again. Speech audio seconds belong to each STT/TTS stage, not to call
duration. These are SDK usage counters, not monetary costs or provider invoices. The current view is per final
report; agent rollups are available in the agent Usage tab. Project-wide totals and estimated costs remain roadmap work.

Usage has the same administrator-only access, export and content expiration as the conversation report. It is
not retained in a separate long-term usage table after report expiry.

## Agent usage analytics

Open **Agents → an agent → Usage** as an administrator. The header time range filters final report timestamps,
not call start times. The view shows collection coverage, LLM token and STT/TTS audio charts, per-model totals and
contributing reports. Filter by stage/provider/model to inspect that model's series and reports. Drilldown links
select the exact room/job report in Session Agent Insights. Reports arriving before room webhooks are marked as
awaiting session history rather than linked to a nonexistent session.

`GET /api/agent-insights/agents/:name/usage?hours=24&page=1` uses the same administrator-only permissions as report
reads. `hours` accepts integers 1–2160 and report pages contain 25 entries. An optional `model` query parameter
contains a URL-encoded JSON array `[type, provider, model]`. The response includes models, time buckets, coverage
and paginated contributing-report metadata; it never includes conversation text. Pages do not limit the totals.

Aggregation reads retained content only. Expired reports, older reports with no usage and unsupported rows are
counted as coverage gaps, not zero consumption. Empty reported arrays and genuine zero counters remain distinct.
Totals are grouped by agent name; historical aliases are not merged. No long-term rollup survives report expiry.
Late reports appear in their original report-time buckets when still retained. Aggregate numeric overflow returns
422 instead of silently rounding large counters. Header refresh controls apply to this view.

## Not included in this slice

Live event streaming, OTLP trace ingestion, automatic process-log collection, automatic PII redaction, project-wide usage
aggregation, estimated costs, synchronized audio and agent-wide performance charts remain on the [Cloud parity checklist](cloud-parity-checklist.md).
No historical transcripts can be reconstructed from room webhooks. Existing calls gain report data only if the
agent collected and uploaded it.

SDK references: [data hooks](https://docs.livekit.io/testing/observability/data/) and
[session report source](https://github.com/livekit/agents/blob/main/livekit-agents/livekit/agents/voice/report.py).
