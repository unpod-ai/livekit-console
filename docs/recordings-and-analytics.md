# Recordings and measured analytics

## Private playback

Sessions → Agent insights includes authorized audio/video playback and an audio waveform. Egress and session
recording rows link to that player. A console administrator login is required for every inventory, HEAD and GET
request; the telemetry service token and viewer accounts cannot read recordings. Storage URLs are never signed
into browser-visible links by this integration. Recordings are streamed through the console with `no-store`
headers and single HTTP byte-range support for seeking.

Configure the server with `RECORDING_S3_BUCKET`, `RECORDING_S3_PREFIX`, `RECORDING_S3_REGION`, optional
`RECORDING_S3_ENDPOINT` and `RECORDING_S3_FORCE_PATH_STYLE`. Use the AWS SDK credential chain (prefer a role or
read-only `s3:GetObject` credentials scoped to the recording prefix). Standard `AWS_ACCESS_KEY_ID`,
`AWS_SECRET_ACCESS_KEY` and optional `AWS_SESSION_TOKEN` remain server-only. Restart the console after changing
its environment; keep credentials out of source control. The console does not change object ACLs or storage IAM.

Only progressive files named by a retained Egress record and matching the configured bucket/prefix are resolved.
The server never fetches a location URL from a request or history row. Traversal/encoded paths and unsupported
formats are rejected. Supported extensions are Ogg/Opus, MP3, WAV, MP4/M4A and WebM; browser codec support still
applies. Streaming playlists, arbitrary local paths and other cloud storage providers are explicitly unsupported.
The source is labeled Egress; agent-side recording files are not collected or guessed from SDK paths.

`RECORDING_ACCESS_DAYS` (default 30, integer 1–3650) limits console access after the Egress ends (or starts if
its end is unknown; a reported file start is used if lifecycle times are absent). Access is unavailable when no
trustworthy age timestamp exists, so reads cannot keep renewing an unknown-age object. It does not delete storage objects or extend conversation retention. Missing objects,
expired access, unsupported sources and unavailable/misconfigured storage produce distinct responses. A configured
inventory entry does not prove the object still exists; actual storage access is checked when loading it.

Waveforms are calculated from actual decoded audio across channels, resampled to 8 kHz in a browser offline audio
context. They are not generated placeholder shapes. Decoding is limited to 16 MiB and five minutes; longer files
remain playable/seekable without a waveform. Source switches cancel downloads and discard stale decode results.

## Recording timeline

Timestamp buttons on final-report items, live events and native spans seek using the Egress file's reported
`startedAt`; the room creation time is never substituted. The chosen source and absolute `mediaAt` timestamp
are retained in the URL. Events outside the selected file's measured duration, or files without a start timestamp,
show an alignment-unavailable message. A waveform can also seek with the pointer or keyboard.

Live event selection preserves supplied turn/trace context, and final-report items are linked to recent retained
live message IDs when available. Log context links can return to that same session timestamp. Correlation lookup
is bounded to the latest 10,000 live message records per job. Older/expired telemetry cannot recreate trace context.
Wall-clock alignment is not forced-word alignment and does not establish conversational/audio correctness.

## Performance investigation

Project → Agent analytics and Agents → Performance show measured response/stage distributions, p50/p90/p95/p99,
bucket trends, exact contributing samples, and final-report model usage. All these reads require an administrator.
Percentiles use nearest rank: sort the measured values, then take `ceil(p*n)-1`; an empty population is unavailable.
Reported zero is a sample, while an absent or expired value is not zero.

Message timing is keyed by room/job/native message/metric. A retained final-report value takes precedence over live
updates; a live value can supply a metric missing from the final report. Native stage durations use exact `stt_node`,
`llm_node`, `tts_node` and `function_tool` span start/end timestamps. Nested provider-request spans are not counted
again. Message timings and node-span durations are separate populations. Marked interrupted/error samples remain
included and visible. Agent join latency remains a separate worker/session measurement.

Timing buckets use event time and refine from daily/hourly bins to one-second bins as the selected range narrows. Usage uses finalized report time and excludes cumulative live snapshots. Token/cache
and speech counters remain per provider/model/stage; no provider invoice or optional rate-based cost is invented.
Expired content and unavailable stages remain explicit coverage gaps.

Select up to four agent names for comparison, using the same range/metric definition for every agent. With none
selected, the page covers the project (projects with over 100 observed names must select agents). Ranges are limited
to 90 days. Header-relative ranges advance on refresh; an explicit form/brush range is frozen in the URL and applies
to the whole page, including comparisons and model usage. Click/keyboard-select a bucket to restrict its contributor
list. Click a sample to open an inspectable drawer and follow its session/trace/media timestamp. Range, metric,
selected agents, bucket, page and drawer state survive URL sharing/reloads. Clearing a bucket restores all contributors.

Investigations are bounded to 100,000 report item rows, 100,000 live source rows, 200,000 unique measurements and
50,000 final usage reports. Oversized requests return an explicit request to narrow the range or selected agents.
The console does not materialize transcript text for performance analytics.

## Deployment verification

Take a consistent SQLite backup before deployment. Check the storage bucket/prefix against an existing retained
Egress filename without printing credentials. Confirm anonymous and viewer media access is denied, then load a
known recording as an administrator, verify byte-range seeking and a nonempty decoded waveform, and test its
transcript/span timestamps only when the recording has a reported start time. Do not backfill missing alignments.

Use a dedicated RTC room and deterministic test agent/audio for recording acceptance; do not make a telephone call
merely to test the player. Keep recordings, transcripts, object names and operational evidence private. Independently
recompute chart counts/nearest-rank percentiles from retained measurements and compare each bucket's contributors.

## Acceptance evidence

Private playback and ranged seeking were verified against an existing retained Egress recording. A separate dedicated
native Python SDK/RTC session published generated test audio and produced a completed private Egress file. Its
conversation and span timestamps sought to the measured file offsets with retained trace context. The browser decoded
actual audio waveforms, and independently extracted native LLM-node durations matched API nearest-rank percentiles
and exact bucket contributors. The audio-free agent response path correctly omitted conversational audio latency;
no missing response latency was fabricated from unrelated span timings. These tests did not place a telephone call.
Operational recordings, identifiers, screenshots and numeric evidence remain private.
