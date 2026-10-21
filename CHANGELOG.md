# Changelog

## 0.2.0 — 2026-10-22

- Add inline per-message timings, session timing summaries and source-scoped agent latency views.
- Include user-message speech/turn delays without counting them as LLM/TTS/response samples.
- Preserve exact telemetry record selection, URL-backed investigation and private recording seek.
- Refine console layouts, mobile navigation, accessible controls, tables, forms and worker history.
- Restore near-black dark surfaces while retaining softer accents and the light/system themes.
- Add validated runtime name/domain/logo/favicon settings and an independent default console symbol.

See [release notes](docs/releases/0.2.0.md) for upgrade instructions, validation and limitations.

## 0.1.0-preview.1

Initial public preview. The private workspace packages use version 0.1.0.

### Fixes and operations
- Updated Vite and React Router to resolve the dependency audit findings.
- Removed the fixed page width cap on wide displays.
- Repository traffic defaults to 30 days, preserves saved All time, and shows loading/request failures while retaining cached data on refresh failure.
- Added WAL-aware Docker backup/restore instructions and a Cloud coverage/validation checklist.

### Features
- Live room and participant management, agent dispatch and token generation.
- SIP trunk and dispatch rule forms with JSON editing and cross-links.
- Egress and ingress management, with recording locations and credential redaction.
- Signed webhook collection in SQLite for session, participant, call and usage history.
- Worker endpoint polling, uptime and load charts, outage history and renamed-agent history.
- Admin and viewer accounts, deployment scripts, and repository traffic collection.

### Limitations
- History depends on events collected after setup; reconstructed sessions have limited information.
- SIP call direction is inferred from participant attributes.
- Per-session network quality and Cloud agent observability are not implemented.
- Worker identification depends on fields exposed by the worker endpoint.

See [features](docs/features.md) and [getting started](docs/getting-started.md) for the current supported behavior.
