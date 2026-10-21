# Console UI cleanup checklist

Based on the live UI audit of 21 October 2026. This tracks presentation work separately from the implemented
Cloud-parity features. Checked means implemented and verified; deployment is recorded separately.
Keep existing permissions, redaction, retention, native/source distinctions and component links.
Implementation and live acceptance were completed before publication was authorized for v0.2.0.

## 1. Agent Insights — first

- [x] Put a compact recording player above the workspace; hide an absent recording instead of rendering an empty panel.
- [x] Separate Transcript, Traces, Session logs and Metrics into URL-backed views.
- [x] Show conversation turns before SDK and collection metadata; avoid duplicate report/live transcripts.
- [x] Put job/report/collection identifiers and advanced information behind Details.
- [x] Open selected transcript items/spans in one details drawer; preserve recording seek and correlation links.
- [x] Use one clear no-telemetry state; retain distinct loading, error, disabled, partial and expired states.
- [x] Preserve live-only sessions and separate transcript, log and recording access grants.
- [x] Verify report switching, browser back/reload, exported data, drawer keyboard behavior and both themes/mobile.
- [x] Deploy and repeat checks on an existing populated session and an empty session.

## 2. Metrics and usage

- [x] Lead with measured latency summaries and charts, followed by stage breakdowns.
- [x] Use the shared time range by default; put exact timestamps and correlation inputs under Advanced filters.
- [x] Open contributing sessions/measurements in a drawer instead of an always-visible raw table.
- [x] Add session turn-latency/distribution charts and preserve turn-to-recording selection.
- [x] Separate token usage and speech usage; hide columns and tiles that do not apply to the measured stage.
- [x] Put coverage/methodology in contextual help; keep incomplete-data warnings visible and accurate.
- [x] Verify chart values, units, contributor selection and shareable URLs against retained measurements.

## 3. Agents and worker presentation

- [x] Default agent table: name, observed status, sessions, measured latency and last seen; load is optional.
- [x] Keep console/native IDs in row details, with copy controls; round percentages and duration values.
- [x] Collapse the empty Running now section and retain archived-agent/worker discovery.
- [x] Put useful overview summaries/charts before worker metadata.
- [x] Keep worker history, endpoints and identity links under Workers; remove deployment panels from agent screens.
- [x] Remove deployment panels from agent tabs; put alias management behind a deliberate action.
- [x] Verify renamed/archived agents, current workers and all related-session links.

## 4. Shared UI consistency

- [x] Replace repeated banners with concise status/help; preserve actionable warnings and errors.
- [x] Render only charts with relevant measurements; use one empty state when a quality source has no samples.
- [x] Standardize number, percent, time and latency formatting, table defaults and detail drawers.
- [x] Simplify narrow-screen headers and filters; verify settled layout after resize.
- [x] Verify keyboard focus, accessible control names, readable contrast and desktop/mobile in both themes.

## 5. Remaining workflows

- [x] Calls: readable overview and links first; provider IDs and SIP attributes in Details.
- [x] Egress: playback/session/status first; storage paths and request JSON behind Details.
- [x] Diagnostics: service/failure summaries first; exact source filters and snapshots under Advanced.
- [x] Testing: separate Test session, Scenarios and Results; reveal controls when relevant to connection state.
- [x] Operations/Settings: consistent grouping, concise collector health and clear actionable failures.
- [x] Keep repository traffic in Tools with its independent time range.
- [x] Repeat the live screen audit and record remaining limits before calling UI cleanup complete.

## Completed cleanup acceptance (steps 1–5)

- [x] Run the production build and relevant behavioral browser tests.
- [x] Inspect rendered screenshots with real and empty data, desktop/mobile and light/dark.
- [x] Preserve access denial, exports, cross-links, selected recording timestamps and URL restoration.
- [x] Review the diff; document what is implemented, verified locally and verified live separately.

## Completed cleanup status (steps 1–5)

Steps 1–5 are implemented and deployed directly to the POC console on 22 October 2026.
No Git staging, commit, push or release was performed.

The final agent layout has three summary cards, a readable list and activity overview. Per-agent current and
archived workers remain in Workers, with IDs and last checks in a drawer. Deployment panels are removed from
agent screens. Identity management and sampled health history are collapsed. Empty activity uses a concise state.

Verification: production web/server build; 136 server tests; 16 administration/Insights/Agents/quality browser
checks; 8 deployment/RTC checks; 6 metrics/usage checks. All passed, with zero browser page errors. Checks cover
native worker session links, archived worker details, malformed stored table preferences, partial/expired data,
content grants, chart values/units, URL restoration, recording seek, mobile containment and both themes.

Live verification covered 29 main/detail/tab views with zero page errors; compact Agents/Workers, drawer URL
restoration, mobile/light/dark; existing populated/empty Insights and real private-recording seek. Anonymous
inventory requests still return 401. The console is healthy; the production agent worker start time is unchanged.
Runtime branding and the remote environment were preserved. Rollback image: livekit-console:before-ui-cleanup.
Private screenshots and audit evidence remain under /tmp/console-ui-audit and /tmp/agents-live-*.

Limits: this is a presentation cleanup over retained self-hosted observations, not a claim of managed Cloud
feature equivalence. Missing response metrics, native worker IDs or diagnostics remain unavailable; endpoint
availability does not establish native worker registration. No new provider calls, live deployments, identity
merges or destructive operations were triggered for this acceptance pass.


## 6. Visual polish — complete and deployed

Added from the fresh whole-console and control-pattern audits of 22 October 2026.
Implementation is complete and locally verified. Live acceptance is tracked separately below. Preserve the completed cleanup above.
Goal: a clear, elegant, visually engaging console, with calmer night colours and consistent patterns across all pages.
Implementation order: shared colours and controls, layout and typography, individual pages, then mobile and accessibility verification.

### 6.1 Colours and themes

- [x] Introduce charcoal backgrounds with subtly distinct card, field and overlay surfaces.
- [x] Replace repeated bright cyan panel headings and KPI values with neutral text; reserve softer teal for primary actions, selection and key measurements.
- [x] Reduce chart cyan/purple/orange saturation and use consistent semantic success, warning and error colours.
- [x] Verify text, control boundaries, focus and chart contrast in both themes; do not make supporting text harder to read.

### 6.2 Typography and spacing

- [x] Establish consistent page/section headings, readable labels, hints, table text and chart legends.
- [x] Standardise card padding, section spacing, table row heights and field alignment.
- [x] Reserve monospace for technical identifiers; keep names and descriptions readable.
- [x] Simplify summary units and precision, such as 3.97 s instead of 3971.95 ms; retain exact values in details.

### 6.3 Selects and dropdowns — priority defects

- [x] Unify select trigger surfaces, borders, chevrons, spacing, selected states and popup styling in both themes; remove the bright browser-blue mismatch where a custom desktop select is used.
- [x] Distinguish value selection from action menus; preserve accessible native mobile selection where appropriate.
- [x] Add searchable comboboxes for genuinely long agent/model lists; keep short lists simple.
- [x] Fix custom time-range keyboard focus: Enter/Space opening, Arrow Up/Down, Home/End, typeahead, selection, Escape dismissal and focus return.
- [x] Fix narrow-screen menu clipping and the hidden selected checkmark with viewport-aware positioning and collision handling.
- [x] Verify long labels, empty options, disabled options, scrolling and loading states without losing current values or URL filters.

### 6.4 Inputs and forms

- [x] Give text, number, date, select and textarea fields consistent surfaces, borders, padding and size variants.
- [x] Align labels, controls, hints and validation messages; retain explicit accessible labels.
- [x] Standardise hover, focus, disabled, loading and error states with visible restrained focus rings.
- [x] Group related settings into readable sections instead of many visually identical inputs.

### 6.5 Buttons, checkboxes and row actions

- [x] Define consistent compact/default/touch sizes and enlarge touch hit areas; remove uneven adjacent 26px/32px/44px controls.
- [x] Make primary, secondary and destructive actions clearly distinguishable without excessive bright fills.
- [x] Standardise checkbox/choice indicators, spacing, labels and checked/disabled/focus states.
- [x] Consolidate crowded row actions into accessible menus; preserve confirmations and permission boundaries.

### 6.6 Navigation, headers and tabs

- [x] Prioritise session, agent and call workflows; group deployments, diagnostics, testing and operations as secondary administrative tools.
- [x] Give titles and primary actions more room; make refresh/theme controls quieter and more compact.
- [x] Keep repository traffic's time range independent of project/session filters.
- [x] Distinguish top-level and nested investigation tabs with consistent selected/focus states; preserve working arrow-key navigation and deep links.

### 6.7 Tables and record details

- [x] Lead with readable names, context, status and duration; place UUIDs/provider identifiers in secondary text or details.
- [x] Improve wrapping, column widths and row density, particularly in worker/session lists and contributor drawers.
- [x] Preserve copy controls, native/source distinctions, cross-links and optional technical columns.

### 6.8 Charts and metrics

- [x] Reduce oversized sparse/single-bucket charts and explain measured sample counts without inventing trends.
- [x] Standardise units, decimal precision, legends, gridlines and interaction cues.
- [x] Highlight important measurements selectively; keep secondary series visually quieter.
- [x] Preserve missing-data gaps, source attribution, partial coverage and exact contributor selection.

### 6.9 Dialogs and drawers

- [x] Use compact dialogs for short creation forms rather than full-height mostly empty drawers.
- [x] Use wider drawers or stacked summaries for investigations; prevent repeated long names from squeezing essential data.
- [x] Keep readable context first and technical identifiers secondary; preserve keyboard focus, dismissal and state restoration.

### 6.10 Mobile layouts

- [x] Replace the permanent icon-only rail with a labelled navigation drawer suitable for small screens.
- [x] Compact stacked summary cards and place useful records earlier in the page.
- [x] Show essential record summaries before secondary columns instead of requiring repeated horizontal scrolling.
- [x] Verify popover positioning, touch targets, long labels, drawers and tabs at narrow and zoom-equivalent viewport widths.

### 6.11 Empty states and guidance

- [x] Use consistent empty states with one clear next action.
- [x] Hide unnecessary search/column tooling on truly empty lists while preserving active filters and recovery paths.
- [x] Make explanatory banners quieter; keep current failures, access denials and partial-data warnings prominent.

### 6.12 Page-specific refinement

- [x] Overview: prioritise current state and session activity; reduce competing shortcuts, bright counters and secondary breakdowns.
- [x] Agents/Insights: refine spacing, speaker/timestamp hierarchy, playback/job/export controls and nested navigation while retaining worker history.
- [x] Usage/Performance: compact filters, clarify summaries and sample counts, and reduce vertically stacked sparse charts.
- [x] Sessions/Calls/Egress: prioritise readable context, status, duration and playback over identifiers.
- [x] Telephony routing: simplify badge-heavy dispatch/trunk/number tables and repeated edit/delete actions.
- [x] Diagnostics: lead with service/call health and failure context; reduce repeated methodology while retaining coverage limits.
- [x] Operations/Settings: prioritise collector health; group retention, recording access, redaction and server/access configuration.
- [x] Testing: clarify start flow and run results; reveal comparison after meaningful selections.
- [x] Repo traffic: compact mobile cards and retention guidance while preserving its independent filter and history coverage.
- [x] Live rooms/Ingress/Tokens: provide clear next actions, consistent short-form patterns and useful field guidance.

### 6.13 Acceptance for the visual-polish phase

- [x] Review rendered changes across every main page and representative details, forms, menus, drawers and empty/error states.
- [x] Verify desktop/mobile, light/dark, keyboard, touch target sizes, reflow and accessible labels/selection states; record manual-device limits.
- [x] Reproduce and resolve the confirmed dropdown keyboard and mobile checkmark-clipping defects.
- [x] Verify filter/range behaviour, URL restoration, grants, source semantics, exports, cross-links and recording selection remain intact.
- [x] Run production build and relevant behavioural tests; inspect fresh screenshots and document any remaining limits.
- [x] Record local verification and live deployment separately; preserve runtime branding and the production agent worker.
- [x] Keep Git staging, commits, pushes and releases pending a new explicit instruction.

## 7. Agent and session timing refinement — complete and deployed

- [x] Show per-message response latency, LLM TTFT, TTS TTFB and supported speech/turn delays inline.
- [x] Link each timing to the exact metric/turn and recording position; preserve reload/back behavior.
- [x] Include user-side transcription/end-of-turn/callback timings without counting user LLM/response values.
- [x] Add a compact session timing summary and clearly scoped report-level model identities.
- [x] Add a source-scoped agent latency summary and links to the detailed Latency tab.
- [x] Restore near-black neutral dark surfaces while preserving the light theme and readable controls.
- [x] Wrap long session names on mobile and verify desktop/mobile/light/dark with retained live calls.
- [x] Verify build, tests, live deployment, content grants and uninterrupted production worker.

## Visual-polish status

Phase 6 is complete and deployed to the POC console. Local verification passed the production build,
136 server tests and 41 browser checks (16 administration/Insights, 8 deployment/RTC, 6 metrics and
11 visual-polish checks), with zero browser page errors. Scoped review findings were fixed and verified:
mobile Search stacking, mobile sorting and long-list focus dismissal.

Live acceptance captured 63 page/layout/theme states, 4 populated Insights views and 16 control states.
The page audits reported zero page errors, failed API responses or document overflow, including
320/375/640px layouts and light/dark comparisons. Keyboard selection, menu dismissal, refresh/range,
per-agent worker history, reload restoration, transcript navigation and seeking an existing private
recording passed. Local behavioural suites also covered grants, exports, source semantics and links.

The console is running with zero restarts; health returns 200 and anonymous inventory access returns 401.
Runtime branding is preserved. The production agent worker was not restarted: its start time remains
the recorded pre-deployment start time. Rollback image: livekit-console:before-visual-polish.
No Git staging, commit, push, tag or release was performed.

The implementation includes calmer semantic colours, readable spacing/type, progressively styled native selects,
searchable long-list pickers, corrected custom-menu keyboard/viewport behaviour, labelled mobile navigation,
responsive primary record lists, compact short forms, readable investigation drawers, grouped settings and
clearer chart summaries. Native platform selection remains the fallback where customisable selects are unsupported.

Limits: narrow viewport reflow was verified; physical touch devices, manual browser zoom and a full
screen-reader/accessibility certification were not performed. Existing data coverage limits remain visible.

Private evidence remains outside Git: /tmp/console-polish-live/audit.json,
/tmp/console-polish-live/detail-audit.json and /tmp/console-polish-live-controls/audit.json.

## Agent/session timing verification

Phase 7 is deployed. Production build and 138 server tests passed. Browser verification passed
11 metrics/turn checks, 16 Insights/administration checks and 11 control/contrast checks.
Live acceptance covered 11 captured states, with 20 displayed timing values checked against the
retained final report, exact source-agent filtering, private recording seek/reload, light/dark and mobile.
No page errors or failed API responses were observed. Long unbroken session names now wrap within
the mobile header. Dark canvas is restored to #070707 with neutral near-black surfaces.

Root cause: SDK transcription and end-of-turn timings are present on user messages; the previous
canonical and session summaries excluded those messages. User speech/callback timings now contribute;
user messages still cannot contribute LLM/TTS/response samples. Each message shows its own submitted
metrics without inferring values from adjacent messages. STT transcription delay is distinct from STT
processing duration. Model names remain report/job-level identities, without invented per-turn attribution.

Health 200, anonymous inventory 401, console running with zero restarts. Production worker start time
remains the recorded pre-deployment start time. Runtime branding preserved. Rollback image:
livekit-console:before-turn-latency. No staging, commit, push, tag or release.
Private live evidence: /tmp/console-turn-latency-live/audit.json.

## Publication

Publication was subsequently authorized for v0.2.0. The implementation-stage no-publication statements above
record the constraints in effect during development; they do not block the approved release. Environment files,
custom deployment assets and private acceptance artifacts remain excluded from version control.
