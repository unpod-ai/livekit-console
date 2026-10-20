# Agent usage analytics

Extend the existing agent page with an administrator-only Usage tab. Reuse report retention, header time ranges,
chart styling and model counter definitions. Filter by report timestamp; do not imply coverage of uninstrumented
calls. Aggregate each stage/provider/model independently and never add cached/modality subsets to parent totals.

1. Add a bounded time-range API with collection coverage, model totals, time buckets, model filtering and paginated
   contributing-report links. Verify exact totals, isolation, retries, expiry, boundaries, overflow and permissions.
2. Add the Usage tab, separate token/speech charts, model selection and session report drilldowns. Preserve the
   selected job in session URLs. Verify actual browser rendering, filtering, navigation, empty states and mobile layout.
3. Update documentation, review and run regression/build checks. Merge through protected CI and deploy/verify.
   Publish no intermediate tag or release. The final production release waits for every roadmap phase and acceptance check.

This milestone covers agent-specific retained reports, not project-wide usage, provider billing or historical backfill.
