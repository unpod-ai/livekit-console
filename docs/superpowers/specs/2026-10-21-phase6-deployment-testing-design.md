# Deployment management and agent testing

Implement Phase 6 in the single-server console. Use the existing Docker host, Python Agents production
startup and private operator files. No Kubernetes dependency, Cloud deployment API imitation, tags/releases/version
bumps or day/night theme changes. Keep current API-mode worker, credentials and production names intact. No carrier
calls or provider billing solely for acceptance. The POC production worker is observed without restarting it for tests.

## Docker integration boundary

A separate stdlib Python host helper binds loopback and requires a per-console bearer token of at least32 characters.
The console receives only its explicitly configured DEPLOYMENT_HELPER_URL/TOKEN; never mount Docker socket into the
web container. Helper config is a private mode600 JSON outside the source deployment tree. It defines trusted
one console token and fixed targets, each with id/name/agentName/environment/host/region, existing container or managed current
container, allowed image references, Docker network, command/entrypoint, fixed health-port slots, secret-file path,
optional trusted build context/Dockerfile and build image tag prefix. UI cannot send shell commands, paths, arbitrary
Docker options, mounts, ports, registries or build contexts. Docker execution uses argument arrays/timeouts/no shell.
Config paths are operator-controlled. The helper has Docker-host privileges and is not an OS sandbox for hostile code.
Helper credentials grant only configured targets. Reject invalid tokens and unconfigured target IDs.

Read inventory exposes safe image reference/digest, version/build revision when known, actual container health/state,
replicas, current/candidate/draining instances, location metadata, last observed time and registration explicitly
unknown unless natively reported. Worker health is not registration. Build/runtime logs are bounded and require
administrator plus logs grant; redact configured secret values and credential patterns before returning/storing logs.
Do not expose Docker inspect Config.Env, host paths or raw command failures. Helper state/progress/logs persist in
private mode600 files with atomic writes; no plaintext secrets in job snapshots. Restrict retained operations/logs.
Host/current-worker metadata remains distinct from the console's previous sampled worker inventory.

Target actions are operator-enabled; existing production target can be read-only. Controlled test target exercises
mutations. Build action uses only the trusted context/Dockerfile, stores a resulting immutable image ID and safe
progress. Deploy/rollback select an allowed local image or successful helper build image; pin digest before start.
No arbitrary pull/build request from browser. An image/version is deployable only when the helper can inspect it.
Secret updates go to a versioned private file (mode600), write-only through API, keys explicitly allowlisted and
values never returned. Docker environment injection uses a selected secret revision at rollout; the response lists
revision/key names only. This is the chosen local secret-file store, not a claim of Vault/KMS integration. Runtime
secret updates require a new rollout; restart/rollback does not silently change a selected prior secret revision.

Managed rollout creates one candidate with labels, selected immutable image and secret revision and an alternate
loopback health-port slot, using only trusted template options. Wait for health plus valid matching agent_name from
/worker; describe this as health-checked, not proven registration. Failed candidate never drains the existing worker.
Once healthy, disable old Docker restart policy and send SIGTERM. Keep the old process running until it exits; poll
state and report draining/progress. Never SIGKILL or docker stop with a forced deadline. On drain timeout, keep both
records and report timed_out; an active job must not be terminated by the console. When old exits, candidate becomes
current, old container is retained stopped with a rollback snapshot, and helper-managed runtime mapping persists.
Compose is not a second controller for managed targets: adoption is explicit and operators must not reconcile that
same target through compose afterwards. Read-only observed compose targets remain under compose ownership.

Drain-only action similarly signals once and observes exit. Rollback uses the last successful image/template/secret
snapshot and the same candidate-health/drain procedure. Only one mutation per target; duplicate idempotency key
returns the same operation. Helper restart marks interrupted operations unknown/reconcile_required rather than
replaying commands blindly, and inventories actual Docker state. Retry a timed-out drain via explicit reconcile, not
by creating another candidate. Bounded progress/health timeouts and sanitized failures are visible in console.

## Console APIs and UI

Deployment backend routes at `/api/deployments` require administrator; logs additionally logs grant. Proxy bounded
helper JSON without secrets; sanitize errors. Read `/targets` -> `{configured,targets,operations}`. Target shape:
`{id,name,agentName,image,imageId,version,environment,host,region,replicas,state,health,observedAt,managed,actionsEnabled,instances,secretRevision}`.
Instances: `{id,image,imageId,state,health,role,statusUrl?,createdAt}` (status URL trusted loopback metadata only).
GET `/targets/:id/logs?kind=runtime|build&lines=...` -> `{lines:[string],truncated}`.
GET `/targets/:id/secrets` -> `{revision,keys,allowedKeys}`. PUT same accepts `{values:{key:value},confirm:id}`.
POST `/targets/:id/actions` body `{action:'build'|'deploy'|'drain'|'rollback'|'reconcile',image?,confirm:id,requestId}`
-> operation `{id,targetId,action,state,startedAt,updatedAt,steps:[{at,state,message}],error?}`.
Helper API same paths under `/...`; backend uses its own configured helper
service token, never the browser's credential. URL is trusted HTTP(S) base with no credentials/query/fragment.
Per-target image selection comes from `allowedImages:[{reference,imageId}]`, never free-text. The console audits
all mutations and logs/secret metadata reads; never log values. No automatic production mutations on page load.
Add Deployments page, links from agent to matching target, target detail/logs/secret edit/confirm actions and polled
progress. Show absent integration clearly. Do not offer controls for read-only targets.

## Browser playground and repeatable scenarios

Add a dedicated Agent testing page using official livekit-client in the browser. Test sessions are administrator
only; viewing/sending transcript text requires transcripts grant; mixed telemetry requires transcripts+logs.
Server creates only console-owned named rooms `console-test-<uuid>`, records native roomSID/name and explicit selected
source agent name, and dispatches that agent once. Token scoped to the test room, short TTL, no admin grants. Browser
connects, subscribes audio, optionally enables microphone only on user action, sends text with topic lk.chat and shows
received lk.transcription plus native transcription events, connection/agent state and retained telemetry links.
Never claim a selected agent answered until an actual participant/transcript is observed. Cleanup deletes only the
owned test room; no arbitrary room delete endpoint. End/reconnect/failure is persisted; page unmount disconnects and
best-effort ends owned room, with server expiry cleanup for abandoned tests. No egress auto-start/private recording.
Use room empty/departure timeout and explicit room dispatch configuration to avoid automatic unnamed-agent races.

Scenario store holds admin-defined name, ordered1–20 prompts (bounded text), optional expected substring per prompt
and timeout10–120s. Browser runs prompts sequentially and waits for actual assistant response; failed/disconnected/
missing response is an explicit result, not pass. Record sent/received text with privacy policy/redaction/expiry and
measured client response delay labeled as browser-observed, not provider/e2e latency. Preserve no-data vszero.
Server stores test runs, prompt outcomes and snapshots of requested deployment/version plus any actual native worker
ID/version proven by telemetry/participant attributes. Requested version is not actual worker provenance; never infer
it from agent name alone. Runs with unverified provenance are labeled and cannot claim measured version regression.
Compare completed runs side by side with scenario revision/prompt outcomes and available server telemetry summary;
only same scenario revision has comparable expectations. No synthesized model costs or LLM-based evaluation.

Testing API at `/api/agent-tests`: GET/POST `/scenarios`, PATCH/DELETE `/scenarios/:id`; GET `/runs`, GET `/runs/:id`;
POST `/runs` body `{agentName,scenarioId?,deploymentId?}` -> `{run,token,wsUrl}`; POST `/runs/:id/results` accepts
bounded prompt/result records with client timestamps and recognized source; POST `/runs/:id/end` triggers owned-room
cleanup; POST `/runs/:id/reconnect` refresh token only for active ownedrun. GET `/compare?left=id&right=id` returns
explicit scenario compatibility, provenance and measured coverage. Every write checks role+transcripts; reads too.
No token stored in DB. Backend results cannot assert server-measured/model metrics supplied by client; load native
telemetry via existing stores. Redact/restrict source fields and enforce test retention using existing live-content
policy, privacy changes and deletion controls; include stores in Operations counts/exports/deletion and backups.

## Acceptance

Unit/integration tests prove helper token/target/image/secret allowlists, log redaction, rollout candidate failure,
active-job drain completion/timeout (no forced kill), rollback, restart reconciliation, unauthenticated denies and
write-only secrets. Exercise real Docker on an isolated disposable target with a signal-aware fixture, not production
agent restart. Verify console helper unavailable/read-only states, account audit/grants, browser dedicated room/token/
selected dispatch/mic lifecycle/scenarios/compare/provenance/no-data and cleanup. Use a dedicated deterministic RTC
text responder on the existing server for live acceptance; no provider calls. Existing production worker remains
healthy; native real test telemetry is evidence only where actually emitted. Verify backups of test/deployment stores
and private helper state/secrets separately, full regressions/build/browser, protected PR/deploy/live checks. No release.

Architecture review decisions: every target includes `allowedImages:[{reference,imageId}]`; helper validates immutable
image IDs against that target's allowlist or completed builds, never a mutable tag supplied by browser. `managed=false`
or `actionsEnabled=false` denies every mutation, including secret PUT and reconcile, inside the helper. Agent-test
store exports immediate scrub and bounded export hooks; prompt, response and expected text use the privacy helper's
recognized text fields. Only server-fetched room-correlated agent evidence can populate observed provenance. Client
source labels/timestamps/worker IDs remain untrusted browser reports and cannot establish a served version.
