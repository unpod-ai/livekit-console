# LiveKit Console

A self-hostable admin console for a **self-hosted LiveKit** server, modeled on the LiveKit Cloud dashboard
(which has no open-source equivalent). React + Vite + TypeScript frontend; a small Express backend that holds the
API key/secret so the browser never sees them, receives LiveKit webhooks and stores history in SQLite.

## What it covers
| Area | Source |
|---|---|
| Live rooms, participants, agent dispatch, token generator | LiveKit server APIs (live) |
| SIP trunks (inbound/outbound), dispatch rules (agent dispatch, trunk/number routing), phone numbers view | LiveKit SIP admin API, with create/edit forms and a JSON editor |
| Egress (start/stop/inspect), ingress (create/delete) | LiveKit egress/ingress API |
| Sessions, participants, events, calls, usage, overview insights | Webhooks stored in SQLite (history starts when the collector starts) |

Not available on a self-hosted server (so not faked): per-session bandwidth/latency analytics, agent observability,
PCAP/codec/SIP response per call, calls rejected before a room is created, number purchasing, billing.

## Run locally
    cp .env.example .env     # LIVEKIT_URL, API key/secret, ADMIN_USER, ADMIN_PASSWORD, SESSION_SECRET
    npm install
    npm run dev              # web :5173 (proxies /api), server :8080

## Production
    npm run build && npm start
    # or
    docker build -t livekit-console . && docker run --env-file .env -p 8080:8080 -v console-data:/data -e DB_PATH=/data/console.db livekit-console

Put it behind HTTPS (the session cookie is `Secure` only for HTTPS requests; `trust proxy` is on).

## Webhooks
Point LiveKit at `http://<console>/webhook` (signed with your API key, verified by the console):

    webhook:
      api_key: <key name from keys:>
      urls: [http://127.0.0.1:8090/webhook]

## Deploy to a VM
    cp .env.deploy.example .env.deploy   # DEPLOY_HOST, LIVEKIT_CONFIG, CONSOLE_HOST, ALLOWED_IPS, ...
    ./deploy.sh --sync-env               # first deploy: sync code + .env, build, run
    ./deploy.sh                          # later deploys
    ./deploy.sh webhook                  # add the webhook block to LiveKit's config (+ restart if no rooms are active)
    ./deploy.sh https                    # nginx + Let's Encrypt, limited to ALLOWED_IPS

The container binds to `127.0.0.1` on the VM; reach it through an SSH tunnel or the HTTPS step above.
`scripts/simulate-webhooks.ts` and `scripts/check-livekit.ts` help with testing and verifying credentials.
