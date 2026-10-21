# Phase 6 deployment management and agent testing implementation plan

> **For agentic workers:** Use scoped parallel implementation, TDD and a final whole-branch review.

**Goal:** Integrate the existing Docker host and provide dedicated browser tests/scenarios with honest provenance.
**Architecture:** Restricted per-console Python host helper; bounded TS adapter; console-local test store/LiveKit routes;
React deployment/testing pages using livekit-client. Direct account role/content/audit checks replace the previous gateway.
**Tech stack:** Python stdlib, Node22/Express/SQLite, React/Vite, official livekit-client.
**Spec:** docs/superpowers/specs/2026-10-21-phase6-deployment-testing-design.md

## Constraints
No production worker restart/rename solely for acceptance. No forced kill or cloud/provider/carrier tests. No Docker
socket in web container. Secrets private/write-only, explicit operator config, per-console boundary. No tags/releases/
version/theme changes. Unknown health/registration/version/latency remain explicit.

## Tasks
- [x] 1. Test/implement host helper trusted Docker inventory, build/runtime logs, versioned file secrets, managed candidate/drain/rollback/reconcile state machine. Isolated Docker acceptance; read-only POC integration.
- [x] 2. Test/implement TS deployment adapter/config/routes and account grants/audit; install private helper, no production mutations.
- [x] 3. Test/implement owned-room runs, explicit agent dispatch/tokens, scenario/results/compare and cleanup/retention/privacy/backup integration.
- [x] 4. Add Deployment/testing UI, official browser RTC/text/audio/mic lifecycle and scenario runner; verify responsive state/grants/single-server authentication.
- [x] 5. Fresh branch review, full server/Python/build/browser plus real isolated Docker and deterministic LiveKit text test; backups, protected PR merge/deploy and live health. Update both checklists, no release.

## Ownership/interfaces
Host worker: scripts/deployment-helper.py, scripts/install-deployment-helper.sh, server/tests/test_deployment_helper.py,
disposable fixture scripts/tests only. Expose helper HTTP contracts from spec with console bearer auth and mode600
config/state. Parent supplies private live config. Helper configurable through DEPLOYMENT_CONFIG/DEPLOYMENT_STATE_DIR/
DEPLOYMENT_PORT defaults bound127.0.0.1. Config `{token,targets:[...]}`; targets minimally
`{id,name,agentName,container,managed:false,actionsEnabled:false,environment,host,region}`; managed target additionally
`allowedImages,network,command,entrypoint,ports:[18083,18084],containerPort:8081,secretsFile,allowedSecretKeys,build?`.
Backend helper paths `/targets`, `/targets/:id/logs|secrets|actions`.

Testing worker: server/src/agent-tests.ts + agent-test-store.ts and tests. Parent integrates app/config/operations/auth;
do not edit those shared files. Export `agentTests` Router (auth/admin/content inside), `maintainAgentTests()` and
`deleteAgentTestContent()`, `agentTestStorage()` for Operations integration. Room SDK existing services. Scenario/run
API per spec; communicate exact types to UIworker. Native stats compare use current telemetry stores and metrics utils.

UI worker: web/** except package.json/lock dependency updates owned parent. Deployment routes per spec, agent-testing
routes per spec; add sidebar+agent links. Respect role/admin+content grants. Use direct authenticated resource URLs. Official
livekit-client installed by parent before build; text lk.chat/transcription documented. Parent runs realbrowseracceptance.

Parent: TS deployment adapter/config/app/auth, Operations test-store integration, dependencies/docs/live helper config
and acceptance/deploy. Existing operations-worker files not edited concurrently by other workers. Audit all helper log/
secret reads; require logs for log read, transcripts for agenttests, both for mixed telemetry. Globaladmins preservecaps.

## Verification before deployment

Single-server source/build and 132 server tests pass. Python suite: 72 pass. Both browser suites: 7/7 each,
zero page errors. Independent backend review fixes cover mixed-case insight grants and deletion during deployment
lookup (both reproduced before fixes). Disposable real-Docker build, health, active-job timeout/reconcile, interrupted
state, exact secret/image rollback, failed candidate and drain checks passed. Production worker remains read-only.
Live browser RTC/migration and post-deploy backups subsequently passed as recorded below; no release.

## Live acceptance

Implementation merged through protected PR #26 and deployed. The single-server console preserved accounts, history,
archived workers, Operations/audit and private recording Range206. Canonical account/audit import and the migration
marker were verified; a post-test application snapshot includes all three agent-test tables and passes integrity.
Real dedicated RTC acceptance passed browser connection, observed agent participant, microphone enable/disable,
four sequential responses across two runs, room cleanup and honest unknown-version comparisons. Docker fixture:34
checks, four containers removed after graceful shutdown. Production worker/collector remain healthy, no backlog or
drops. Helper production target is read-only and rejects writes. Private helper state/config backed up separately.
No tags/releases/version changes. Final day/night header toggle remains pending.
