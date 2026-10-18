# Changelog

## Unreleased

Initial public preview. The current package version is 0.1.0; a tagged release has not yet been published.

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
