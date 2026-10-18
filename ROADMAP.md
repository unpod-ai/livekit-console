# Roadmap

These are contribution opportunities, not delivery promises. Discuss a proposed change before starting substantial work.

## Reliability
- Add regression tests for webhook retries, duplicate events and events arriving out of order.
- Verify inbound SIP call attribution against a real deployment.
- Improve worker history across renames and multiple workers for the same agent.

## Contributor experience
- Add a repeatable demo setup using fictional data.
- Add keyboard navigation and accessibility checks for menus, drawers and tables.
- Improve troubleshooting documentation for webhooks, worker status and repository traffic.

## Reporting
- Improve repository traffic ranges and calendar-based aggregation.
- Document the difference between measured data, inferred values and reconstructed sessions.

## Scope
The console manages self-hosted LiveKit through its APIs, worker endpoints and collected events. Cloud billing,
number rental and managed agent deployments are outside its scope. Additional telemetry requires a real data source.

Browse [good first issues](https://github.com/unpod-ai/livekit-console/labels/good%20first%20issue), or propose an idea in
[Discussions](https://github.com/unpod-ai/livekit-console/discussions).
