# Complete the remaining console UI cleanup

Spec: docs/ui-cleanup-checklist.md steps 2–5. Existing step 1 is deployed and must remain functional.
Scope: improve presentation and navigation over existing measured data/APIs; no new managed platform capabilities.
Execution remains on the existing local feat/runtime-branding branch with its authorized uncommitted changes.
No Git staging/commit/push, release or production worker restart. Direct console deployment is authorized.

1. Metrics/usage: scoped implementer owns Performance, Usage, ModelUsage, AgentUsage and session metric charts.
   Verify metric definitions, one range, stage-specific usage columns, URL selection, contributors and media seeking.
2. Agent presentation: readable defaults/filters, archived discovery, useful overview before infrastructure,
   metadata in inventory and explicit alias management. Verify all names/history/links remain reachable.
3. Shared presentation: collection-aware quality empty state, measured chart visibility, consistent formatting,
   contextual coverage, responsive header controls and keyboard-safe drawers. Preserve actionable failures.
4. Remaining workflows: call/egress details, diagnostics, testing/scenarios/results separation and operations/settings.
   Preserve all actions, confirmation boundaries, independent content grants and source distinctions.
5. Run production build and relevant server/Python/browser suites; inspect populated/empty real-data UI in both themes
   and mobile. Review the integrated diff and fix functional or safety regressions.
6. Deploy directly to POC, repeat live read-only audit and preserve worker start time, branding and data.
7. Update Markdown/HTML checklist with actual verified status and explicit remaining limits.

Ruling: concurrency capacity permits one implementation subagent; controller implements the disjoint remaining
surfaces while the metrics worker runs. No task is left waiting solely for an available agent slot.
