# Agent and session latency refinement

User request: expose model latency in agents, show LLM TTFT/STT/other timings on transcript rows,
refine agent/session Insights and restore the previous deeper dark background.

1. Reproduce with retained live data. Confirmed final-report assistant rows carry response latency,
   LLM TTFT and TTS TTFB. Follow-up live inspection found transcription/end-of-turn delays on user messages; aggregation incorrectly excluded all user messages. Final report model usage
   identifies models at report level, without reliable per-turn model attribution.
2. Add behavioural regressions for inline timing values, absent/invalid measurements, row-to-metric
   navigation/seek, agent stage summaries and source-name scoping, grants and restored dark colours.
3. Add compact transcript timing strips and a session timing overview with report-level model context.
   Use final-report measurements directly; live transcript rows display their own submitted timings.
   Never associate an arbitrary neighbouring metric/span/model with a message.
4. Add an agent overview model/response latency summary linked to the existing detailed Performance
   view; preserve the tab URL and label it Latency. Keep source-name attribution explicit.
5. Restore near-black neutral surfaces and preserve the current softer semantic/chart palette.
6. Build/test, inspect desktop/mobile light/dark with real retained calls, then console-only deploy
   with rollback image; verify recording seek and unchanged production worker start time.

Constraints: preserve all pre-existing uncommitted work/branding, no staging/commit/push/tag/release,
no agent worker restart. Native recordings/exports and content grants remain unchanged.

Implementation: inline final/live message timings and exact metric/seek navigation, session p50/model context,
source-name-scoped agent stage summary and Latency tab. Near-black neutral theme restored.
Root-cause correction: include user transcription/end-of-turn/callback values in canonical and session
metric populations; continue excluding user response/LLM/TTS values. No cross-message inference.
Live visual review also found long unbroken session names clipped on mobile; wrap them within the header.
Initial console deploy healthy, worker unchanged. Final corrections are under regression verification
before redeploy. No staging/commit/push/tag/release.

Completed and deployed: build,138 server tests,38 browser checks pass. Live acceptance:11 captured
states,20 exact source timing values,agent-source filtering,recording seek/reload,light/dark/mobile;
zero page errors/API failures. STT delay verified on user rows and in agent/session summaries.
Manual scoped review completed; no unresolved correctness/permission findings. Health200,anonymous
inventory401,console0 restarts,worker start unchanged. Rollback before-turn-latency retained.
Model metadata remains job-level; no per-turn model attribution was inferred. No Git publication.
