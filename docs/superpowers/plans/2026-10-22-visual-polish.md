# Phase 6 visual polish execution

Spec: docs/ui-cleanup-checklist.md phase6, approved by user "start work on all".
Preserve the dirty feat/runtime-branding branch, local-only branding assets, source data, grants, links and URL state.
No Git staging/commit/push/release. Direct POC console deployment follows verified implementation; never restart agent worker.

1. Shared foundations: charcoal/teal semantic colours, neutral heading/KPI hierarchy, spacing/type/field sizes.
2. Shared controls: repair Dropdown keyboard focus/positioning; customisable native short selects with fallback;
   searchable accessible long-list picker, aligned input/help/error states and touch targets.
3. Navigation/mobile: labelled mobile navigation drawer with focus/dismissal, secondary admin group;
   table summaries for primary lists, compact mobile KPI grid; maintain URLs and content grants.
4. Components: compact short forms, readable investigative drawers, row-action menus, concise empty states;
   chart size/units/sparse samples and model filter refinements, preserve measured/source semantics.
5. Per-page pass: Overview, Agents/Insights, Usage/Performance, Sessions/Calls/Egress, routing, Diagnostics,
   Operations/Settings, Testing/traffic and empty tools. Group forms and clear primary actions.
6. Verify regression suites, keyboard/popover/search/mobile/theming tests, fresh screenshots and scoped review.
7. Direct deploy with rollback image, verify live routes, controls/playback and unchanged worker start time;
   mark only verified checklist items complete and leave any remaining limits explicit.

Ruling: work remains in existing feature workspace to preserve authorized uncommitted changes.
Ruling: native short select uses progressive CSS base-select styling where supported, retaining native semantics
and platform fallback; searchable long lists use an explicit accessible combobox. No global fake select interception.
Ruling: no new backend/platform capabilities; visual improvements operate on existing APIs and source semantics.

Progress: started. Baseline audits reproduced range ArrowDown focus defect and clipped mobile checkmark.

Tasks1–5 implemented. Task6 locally verified: production build;136 server tests;41 browser checks pass.
Review: fixed mobile Search stacking, mobile sort access and Combobox focus departure. No remaining important
findings in scoped follow-up. Read-only real-data preview53 states+16 control states captured, no API/page errors.
Task7: console-only deployment and live verification next. No Git changes staged or published.

Final control suite now11 checks (41 browser checks total). Native CSS picker keyboard selection verified;
custom range navigation/positioning, long-list search/escape/focus departure, mobile nav/Search/sort,
refresh/range controls, text/button contrast and routing delete cancellation all pass. Final scoped review clear.
Deployment started with rollback tag before-visual-polish. Live audit will include320/375/640px reflow,
light/dark, existing session playback and unchanged production worker start time.

Completed: Task7 deployed and verified. Live acceptance:63 main/layout/theme states,4 populated Insights
views,16 control states; zero page errors/API failures/document overflow. Existing recording seek and
per-agent worker history verified. Health200, anonymous inventory401, console running with0 restarts.
Worker start unchanged (the recorded pre-deployment start time); runtime branding preserved.
Rollback image livekit-console:before-visual-polish retained. Checklist Markdown/HTML updated.
No Git staging/commit/push/tag/release. Manual physical touch, browser zoom and screen-reader certification
remain outside these checks;320/375/640px reflow and automated keyboard/contrast/label checks passed.
