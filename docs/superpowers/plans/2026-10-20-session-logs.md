# Structured agent session logs

Build a bounded, opt-in structured log collection path for self-hosted agent jobs. Use the existing service token
and administrator permissions. Keep logs independent of final-report/webhook arrival and correlate by room/job,
with optional turn/trace/span IDs. No process-wide log scraping or automatic PII redaction is included.

1. Test and implement a versioned 256-KiB/100-entry upload contract, atomic deduplication/conflicts and content
   retention. Preserve batch/entry tombstones after expiration so retries cannot restore expired messages.
2. Add administrator-only session log search, exact severity/job filters and bounded pagination. Render text safely
   and keep expired/disabled/empty states explicit. Use header refresh behavior and shareable URL filters.
3. Extend the Python helper with explicit log-batch uploads and opt-in fixed job lifecycle messages. Build once
   per request, reuse IDs on transport retries, deny redirects and isolate upload failures from job cleanup.
4. Verify HTTP/uploader/browser behavior, merge through protected CI, deploy the console and private upload route
   before activating the worker integration while idle. Verify with disposable synthetic logs; publish no release.

The final day/night toggle remains a later UI task. A single production release follows all phases and acceptance checks.
