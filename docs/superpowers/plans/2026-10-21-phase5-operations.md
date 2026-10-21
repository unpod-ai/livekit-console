# Phase 5 project administration and operations implementation plan

> **For agentic workers:** Use scoped parallel implementation and one final whole-branch review. Parent owns the gateway security boundary; workers own independent project operations and UI slices. Verify RED→GREEN for behavior changes.

**Goal:** Isolate configured projects and expose permissioned operational controls without regressing the existing POC.
**Architecture:** Parent gateway/control store plus isolated loopback backend processes, existing per-project SDK/SQLite modules, operations tables and React views.
**Tech stack:** Node 22, Express, node:sqlite, React/Vite; use existing dependencies.
**Spec:** docs/superpowers/specs/2026-10-21-phase5-operations-design.md

## Constraints
Preserve default deployment/credentials and production worker names. Additional projects cannot inherit default credentials. Signed project-specific gateway assertions, explicit scoped media paths, immediate membership revocation and no cross-project fallback. Raw signed webhook streams stay unmodified. No tags/releases/version/theme changes. OIDC deferred absent an organization requirement. Private evidence outside repository.

## Tasks
- [x] 1. Write isolation/access tests; implement project config validation, control memberships/audit, supervised backend processes, raw streaming gateway and signed child authentication. Verify colliding IDs, credentials, revoked access, default compatibility and forged assertions.
- [x] 2. Test/implement project operations policies, retroactive content retention/redaction, bounded export/deletion, collector receipt/sync health, explicit deduplicated alert rules and storage measurements. Add integration hooks to ingestion/sync workers without logging bodies/secrets.
- [x] 3. Add project selector and cache/page isolation, scoped API/media/download resources, capability-aware content UI, global membership controls and Operations views. Verify role gates, range/media routing, switching/reload/in-flight requests and mobile layout.
- [x] 4. Review whole branch; resolve important defects, run all server/Python/build/browser checks and verify consistent control/project backups and restore.
- [x] 5. Merge protected PRs, back up/deploy default project safely, verify live history/recording/worker/collector health; update Markdown/HTML checklists. No release.

## Boundary contracts
- Project config: `{projects:[{id,name,envFile?}]}`, id regex `[a-z][a-z0-9-]{0,47}`, `default` always present. Additional env file requires explicit LiveKit URL/key/secret and unique absolute DB_PATH. Child `CONSOLE_PROJECT_CHILD=1`, `CONSOLE_PROJECT_ID`, `CONSOLE_GATEWAY_SECRET`, loopback HOST/PORT; parent retains control DB_PATH.
- Public API: legacy `/api/*` stays default; explicit `/p/:id/api/*` routes to selected project; auth login/logout, `/api/projects`, `/api/users` are control routes. `GET /api/projects` -> array `{id,name,role,capabilities:{transcripts,recordings,logs},globalAdmin,backend:{state}}` authorized for current user. `GET /p/:id/api/auth/me` -> `{user,role,source,globalAdmin,capabilities,projectId}`.
- Membership control: `GET/PUT/DELETE /api/projects/:id/members[/:userId]`, global-admin only. Rows `{userId,username,role,transcripts,recordings,logs}`; PUT body those role/capability fields (booleans required). Existing default viewers migrate once; new global viewers have no project access until granted.
- Auth assertion: HS256 private gateway secret, audience `console-project:<id>`, short expiry, claims `{sub,role,capabilities,globalAdmin}`. Child requireAuth must reject cookie/forged/mismatched project tokens in gateway mode; standalone tests without child secret retain current auth behavior.
- Operations worker owns `server/src/operations*.ts` and its tests, `config.ts`, `collector.ts`, `telemetry.ts`, `live-telemetry.ts`, `session-logs.ts`, `diagnostics.ts`, `reconcile.ts`, `importer.ts`, `traffic.ts`, `workers.ts`, `recordings.ts`. Export `operations` Router, `startOperations()`, `observeIngestion(source)` middleware from `operations.ts`. Router mounted `/api/operations` by parent, auth+admin inside router. `GET /summary`, `GET/PATCH /policy`, `GET /alerts`, `GET/POST /rules`, `PATCH /rules/:id`, `POST /alerts/:id/ack`, `POST /alerts/:id/resolve`, `GET /export/:category`, `DELETE /data/:category` (body `{confirm:category}`). Summary keys `{collectors,storage,categories,alerts}`. `GET /policy` returns validated category retention/redaction/access fields plus bounds. `GET /rules` array; alerts response `{rows}`. Audit is provided by gateway at scoped `GET /operations/audit` -> `{rows}`; control audit retention uses `AUDIT_RETENTION_DAYS` (default365), no project-admin audit deletion.
- Parent owns `index.ts`, new `app.ts`, `auth.ts`, `projects.ts`, `project-control.ts`, `project-gateway.ts`, gateway integration tests; coordinates operations mounts/hooks and docs.
- UI worker owns web/** except unrelated theme. Explicit project prefix media/resource URLs; preserve current single-project browser harnesses via default legacy API fallback if control projects endpoint unavailable (but never fallback after selecting a non-default project). API helper `projectResource(path)` scopes raw `/api/...` links to current project. Operations page reads contracts above; membership controls are global-only.

## Review focus
Project-header/path spoofing; encoded paths and special proxy routes; cookie/assertion/role escalation; content-export mixed-grant leakage; AWS/project environment leakage; long uploads/Range/backpressure; revoked users and process restart; local data deletion vs upstream reimport; alert missing measurements vs zero; shortened retention never resurrecting tombstones. Default UI fallback must not hide a failed configured multi-project gateway.

Architecture-review refinements: separate control DB with one-time user copy; distinct child assertion keys/HS256;
content grants never inferred from project admin; mixed telemetry/export requires transcripts+logs; strip raw upstream
recording locations; explicit AWS credentials/default-provider opt-in; raw streaming before JSON parser; pending audit
before mutation; subsequent-request revocation; category log duplication/live-job expiry; private config mounts and
canonical paths. See spec decisions for exact behavior.

Implementation checks: project/control/auth/gateway tests plus actual two-child-process SDK/database/token isolation pass. Interim integrated server suite 103/103 and Python 44/44 pass; UI worker verified 17 isolated browser scenarios and parent verified five scenarios against the actual gateway/two backend processes. Final whole-branch review and live migration remain pending.

Final review: four reproduced findings fixed RED→GREEN: audit every export and fail closed; capture ingestion source before nested mount paths change; require distinct identified final SIP failures (exclude401/407); count worker failed checks with disclosed minute-bucket boundaries. Denied membership edits also audited with regression coverage. Full server suite108/108; Python44/44; production builds pass. Control and operations VACUUM snapshots restore with integrity. Live migration still pending.

Live acceptance: PR23 implementation and PR24 SSH argument correction passed required CI and merged. POC migration retained default-project login/history/current and archived workers. Authenticated Chrome verified Operations measurements, scoped private S3 Range playback (206), project-preserving navigation, mobile containment and anonymous denial with zero page errors. Separate control/project VACUUM snapshots restored all new stores with integrity OK. Console/worker/collector healthy; fresh service snapshots and zero collector backlog/drops. Final checks:108 server,45 Python,17 UI scenarios,5 real two-backend browser scenarios plus deployed live acceptance. No tags/releases/version changes.
