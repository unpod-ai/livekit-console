# Agent deployments and testing

Deployments connects the console to an operator-configured Docker host helper. Agent testing creates dedicated LiveKit
rooms for browser conversations and repeatable text scenarios. Both require administrator access; testing
also requires the transcripts grant, and deployment logs require the logs grant.

## Configure the host integration

Run the helper on the Docker host, separately from the console. It binds loopback and uses a different bearer token
for this console. Set `DEPLOYMENT_HELPER_URL` and `DEPLOYMENT_HELPER_TOKEN` in its private server environment.
Do not mount the Docker socket
into the console or publish the helper port. Operators accessing a remote helper must provide a private authenticated
network/proxy; the loopback default assumes the console runs on the same host.

The private JSON config defines `{token,targets:[...]}`. Keep it outside the deployed source directory,
owned by the helper account, mode `600`. A target identifies a fixed container, agent name and display location. Set
`managed:false` and `actionsEnabled:false` to observe an existing compose-managed worker. All helper mutations,
including secret writes and reconciliation, are denied for read-only targets.

Managed targets additionally define an allowlist of local images, network, command/entrypoint, two alternate loopback
health ports, container health port, secret file and allowed secret keys. Optional builds use only a trusted fixed
context/Dockerfile. The browser cannot supply commands, host paths, mounts, registry URLs or arbitrary Docker flags.
Adopting a worker means the helper controls that target; do not also reconcile it through compose.

Health describes Docker and the worker's HTTP endpoint. It does not establish LiveKit registration. Image/version,
worker inventory identity and the worker that actually served a particular test are separate observations. Missing
native registration or version evidence is shown as unknown.

## Actions, secrets and recovery

Build, deploy, drain, rollback and reconcile require confirmation of the target ID. Operations have persistent progress
and idempotency keys. A candidate must pass HTTP health and report the configured agent name before the old worker
receives SIGTERM. The helper disables the old restart policy, then waits for graceful exit. It never uses SIGKILL to
meet a drain deadline. Match the target drain timeout to the worker SDK settings (Python defaults can be 30 minutes). A timed-out drain keeps the old process and candidate recorded; inspect jobs and reconcile
explicitly. An interrupted helper operation requires reconciliation rather than blind replay.

Secret updates use the chosen local versioned file store. Only allowlisted keys can be written. Responses show key
names and revision, never values. A staged revision applies on a subsequent rollout; rollback restores the selected
previous image and secret revision. Logs are bounded and scrubbed for configured secret values and credential patterns.
Build and runtime logs remain sensitive; administrators also need a logs grant to view them.

## Browser tests and scenarios

Set `LIVEKIT_BROWSER_URL` to a browser-reachable WSS signaling endpoint when server-side `LIVEKIT_URL` uses a private
address or loopback. On an HTTPS console page, the signaling endpoint must use WSS.

Select an agent and optionally a deployment. Starting a test creates a uniquely named `console-test-…` room and an
explicit dispatch for that agent. The browser receives a short-lived room-scoped token, subscribes to audio, and can
send text through `lk.chat`. Microphone access requires a deliberate button click. Received `lk.transcription` text
and transcription events appear in the test view. Ending the test deletes only its owned room; server cleanup handles
expired and abandoned tests. Tests do not automatically record audio or create egress jobs.

An agent may use paid model/speech providers when a real test is run; use a dedicated deterministic responder when
checking transport without provider usage. Merely opening the page does not start a test or contact a carrier.

Scenarios contain 1–20 ordered prompts, optional expected substrings and per-prompt timeouts. The runner waits for
actual assistant text. A timeout, disconnect, missing result or failed expectation is recorded explicitly. Result text,
source labels and response delay are browser-reported and untrusted; they are not model/provider latency or proof of
which deployment served the request. Native telemetry is displayed only when collected for the actual test room.
Comparison identifies matching scenario revisions and distinguishes a requested image from server-observed worker
provenance. Missing measurements are not converted to zero, and no cost or version-regression claim is synthesized.

Test prompt, expectation and response content follows the console's live-content retention/redaction policy. Operations
counts, exports and live-content deletion include scenario/run/result stores. Deleted/expired content cannot be restored
by retrying results. Increasing retention does not restore expired text.

## Backup and restore

The application SQLite snapshot includes scenarios, runs and results. Back it up consistently with the private
environment and existing telemetry stores; see [Operations](operations.md). Room tokens are not stored.
Keep helper config, state and versioned secret files in a separate private backup with mode `600`. Pause helper actions
while copying these files to preserve the image/secret revision mapping. Restore with the helper stopped, inspect actual
Docker containers, then reconcile interrupted operations before enabling mutations. Restoring SQLite does not recreate
a LiveKit room, running worker or external image. Never publish these backups or operational screenshots.

Install the service copy after reviewing the private config (installation does not start it):

```bash
sudo DEPLOYMENT_CONFIG=/etc/livekit-deployment-helper/config.json \
  DEPLOYMENT_STATE_DIR=/var/lib/livekit-deployment-helper DEPLOYMENT_PORT=8095 \
  sh scripts/install-deployment-helper.sh
sudo systemctl enable --now livekit-deployment-helper
```

The service uses a stable installed script so replacing the console source tree does not delete a running helper.
Its account has Docker host privileges. Restrict operator access to the config and service; do not treat this as an OS
sandbox for untrusted build contexts or images. After installation, verify unauthenticated requests are rejected,
the socket is bound only to loopback, and every configured production target is read-only unless explicitly adopted.
