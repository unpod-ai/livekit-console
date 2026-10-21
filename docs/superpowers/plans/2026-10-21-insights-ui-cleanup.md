# Agent Insights UI cleanup implementation plan

Goal: conversation-first session investigation without the current stack of collection/report/raw-data panels.
Spec: docs/ui-cleanup-checklist.md, step 1; live audit /tmp/console-ui-audit/index.html.
Architecture: retain the report/live/log/recording endpoints and grants. URL-backed insightView selects Transcript,
Traces, Session logs or Metrics inside the existing session page. Report and live content are alternate sources,
not duplicate conversation lists. Reuse existing components, with compact playback and contextual details.
Stack: React/Vite, TanStack Query, React Router, existing theme tokens and Playwright browser fixtures.

- [x] Add behavioral browser fixtures for populated/final, live-only, empty/disabled/expired, independent grants,
      deep links, selection/seek, exports, report switching, drawer focus and mobile/themes. Observe initial failure.
- [x] Separate the Insights workspace and keep job selection, collection status/export and report metadata concise.
- [x] Render one transcript source; place per-item correlation/metrics in a drawer and collection metadata in Details.
- [x] Reuse live traces and session logs in their own views; make advanced filters opt-in.
- [x] Put available per-turn timing summaries and model usage in Metrics; session chart work remains step 2.
- [x] Add compact recording presentation without changing stream authorization or timestamp alignment.
- [x] Build; run focused/new and existing browser tests; inspect populated/empty desktop/mobile screenshots.
- [x] Review changes and update main checklist with local/live status separately. No Git publication or release.

Local implementation and live deployment verified on 22 October 2026. Build, 14 administration/Insights/theme
and 7 deployment/RTC browser checks passed. Live acceptance covered populated/empty sessions, all views, metadata
drawer, real private-recording seek and light/dark/mobile, with zero page errors. Runtime branding and worker uptime
were preserved. No Git commit, push or release. See docs/ui-cleanup-checklist.md for the next step.
