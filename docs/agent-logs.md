# Structured agent session logs

This opt-in path accepts explicitly submitted application logs and displays them in **Sessions → Agent logs**.
It works independently of final session reports. Python integration can emit job start/shutdown messages; other
application events need explicit calls to the uploader. It does not collect Docker stdout, arbitrary Python loggers
or exceptions automatically, and it does not implement an OTLP collector.

## Enable and integrate

Configure `AGENT_LOGS_ENABLED=true` on both the console and agent, alongside the existing separate
`AGENT_TELEMETRY_TOKEN` and agent `CONSOLE_URL`. Collection is disabled by default. Restart the console and agent
after changing their environments. The upload route must be reachable from the worker; a private upload-only
proxy must forward `/api/telemetry/logs` as well as `/api/telemetry/session-reports`. Keep admin routes restricted.

The existing [Python helper](../examples/agent_report_upload.py) provides:

```python
from agent_report_upload import make_session_log, upload_session_logs

async def record_application_event(ctx):
    event = make_session_log(
        "INFO", "Customer lookup completed", logger="application",
        turnId="turn-example", traceId="a" * 32, spanId="b" * 16,
    )
    accepted = await upload_session_logs(ctx, "my-agent", [event])
    # Keep the same event ID when retrying it in a later batch.
```

Each call builds a stable batch body for two transport attempts, with a 3-second timeout and a short retry delay.
Redirects are denied. Calls return success/failure; they have no durable queue. Schedule explicit application uploads
outside latency-sensitive audio processing. Avoid unbounded background tasks. Redact sensitive content before calling
the uploader: message text can contain personal data or credentials, and automatic PII/secret redaction is not included.

When `register_shutdown_report(ctx, agent_name)` is used with the opt-in flag, it additionally submits fixed
`Agent job started` and `Agent job shutdown` messages. The final log upload runs alongside the protected report
callback; a failed report does not prevent the shutdown log. Allow approximately 15 seconds for the worst-case
log path if the start upload is still retrying. Worker crashes or prolonged outages can lose logs. Other SDK session-end
integrations can call the explicit uploader themselves. No transcript or exception payload is copied into lifecycle logs.

## Upload contract

`POST /api/telemetry/logs` requires the service bearer token and JSON up to 256 KiB:

```json
{
  "schemaVersion": 1,
  "roomSid": "RM_example",
  "jobId": "AJ_example",
  "agentName": "my-agent",
  "batchId": "batch-example",
  "entries": [
    {"id": "event-example", "at": 1700000000, "level": "INFO", "message": "Agent ready", "logger": "application", "turnId": "turn-example"}
  ]
}
```

Provide 1–100 entries per batch. IDs are up to 100 ASCII letters/digits/underscores/hyphens. Room/job IDs require
`RM_`/`AJ_` prefixes. Agent/logger/turn names are up to 200 characters and messages up to 4,000. `at` is Unix seconds;
storage/read timestamps are milliseconds. Levels are `DEBUG`, `INFO`, `WARNING`, `ERROR` and `CRITICAL`. Optional
trace/span IDs are nonzero lowercase hex with 32/16 characters respectively; a span requires a trace. Extra fields
are discarded. The helper's `make_session_log` generates a UUID and current timestamp once per event.

New batches return 201 and identical normalized batch retries return 200. Entry IDs deduplicate within each room/job
even across different batches. Reusing a batch or entry ID with changed content returns 409 and inserts nothing.
A job's existing agent identity cannot change between batches. Invalid inputs return 422, malformed JSON 400 and
oversized bodies 413. Uploads require the service token even when the browser is logged in; collection disabled on
the console returns 503 for an authenticated request.

## Browse, correlate and retain

Only signed-in administrators can read logs. Viewers and the upload token cannot read them. The session page has
a separate Agent logs tab, and Agent Insights reports link to their exact job's logs. Logs need no final report;
the session page itself still requires normal session history. Uploads never fabricate room/session records.

`GET /api/agent-insights/sessions/:sid/logs` supports exact `jobId`/`level` filters, substring message search `q`
(up to 200 characters, SQLite's ASCII case folding), and integer `page` starting at 1. Pages contain 50 entries in
descending event-time order. Turn/trace/span IDs appear as supplied context; a trace viewer is still separate work.
The UI preserves filters in its URL and follows the header's refresh setting. Live arrivals can shift offset pages.

Logs expire from their first receipt using `AGENT_TELEMETRY_RETENTION_DAYS` (default 30). Search excludes expired
content immediately. Cleanup on access, startup and hourly clears message/logger/turn/trace/span content. Identity,
severity, timestamps and digests remain as tombstones; retrying an expired entry in a new batch cannot restore it or
extend retention. The expired count is for the selected room/job, independently of text/severity filters. Retained
logs stay readable if new collection is disabled. SQLite WAL/backups/downloaded copies need their own retention.
Batch/entry tombstone growth and long-term retention controls remain operational roadmap work.
