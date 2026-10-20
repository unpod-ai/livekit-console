# Agent report model usage milestone

Scope: extend the existing final-report integration with per-provider/model usage. This is a Phase 1 preview
milestone; live traces/logs and project-wide usage analytics remain separate work.

1. Preserve version-1 normalization exactly; accept version-2 SDK usage through a bounded numeric allowlist.
   Verify legacy retries, omitted SDK defaults, missing data, unknown types, duplicates and invalid counters.
2. Display per-model counters in administrator-only session Agent Insights, with explicit units and incomplete
   states. Keep usage subject to the existing report access, export and expiry rules.
   Verify the HTTP lifecycle and browser states, text escaping, export and mobile layout.
3. Update the Python helper and setup/upgrade guidance. Run regression suites and production builds.
4. Merge through a protected PR, deploy the console before updating the worker helper, verify the native SDK
   upload path using a disposable synthetic report, then tag and publish a preview release.

No historical reports are backfilled and no external call is initiated for this milestone. A real completed
post-rollout session report is still a separate verification requirement.
