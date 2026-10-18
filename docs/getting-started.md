# Getting started

LiveKit Console is an admin dashboard for a **self-hosted LiveKit** server (server + SIP + egress + agents). It has a
React UI and a small Express backend. The backend keeps your API key and secret, so the browser never sees them,
receives LiveKit webhooks, and stores history in SQLite.

## Requirements
- Node.js 22.13 or newer (the backend uses the built-in `node:sqlite`), or Docker
- A running self-hosted LiveKit server and an API key/secret from its `keys:` config
- Optional: LiveKit SIP, Egress and Agents workers, for the pages that cover them

## 1. Configure
```bash
cp .env.example .env
```
Fill in at least:

| Variable | Meaning |
|---|---|
| `LIVEKIT_URL` | `ws(s)://` URL of your LiveKit server (the console derives the HTTP URL for the admin APIs) |
| `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` | an API key pair from LiveKit's config |
| `ADMIN_USER`, `ADMIN_PASSWORD` | the first admin sign-in; always works as a fallback |
| `SESSION_SECRET` | a long random string used to sign session cookies |

The rest is optional; see [configuration.md](configuration.md).

## 2. Run
Locally, for development:
```bash
npm install
npm run dev          # UI on :5173 (proxies /api), server on :8080
```
Or as a single process:
```bash
npm run build && npm start
```
Or with Docker:
```bash
docker build -t livekit-console .
docker run --env-file .env -p 8080:8080 -v console-data:/data -e DB_PATH=/data/console.db livekit-console
```
Open the console and sign in with `ADMIN_USER` / `ADMIN_PASSWORD`. Put it behind HTTPS in production: the session
cookie is marked `Secure` for HTTPS requests.

## 3. Turn on history (webhooks)
Live pages work straight away. **Sessions, Calls, Usage and the Overview charts are built from LiveKit webhooks**, so
history starts from the moment you enable them. Add this to `livekit.yaml` and restart LiveKit:
```yaml
webhook:
  api_key: <the key name under keys:>
  urls:
    - http://<console-host>:<port>/webhook
```
The console verifies each webhook's signature with your API key. `./deploy.sh webhook` does this for a VM (see
[deployment.md](deployment.md)). Sessions that began before webhooks were on are rebuilt from LiveKit's retained egress
records and are marked **Reconstructed**.

## 4. Show agent status (optional)
Every LiveKit Agents worker serves a small status server (port 8081 by default). Point the console at it:
```
AGENT_WORKER_URLS=http://127.0.0.1:8081
```
Use comma-separated URLs for several workers. See [features.md](features.md#agents).

## 5. Add teammates
**Settings → Team members** creates users with the **Admin** (full access) or **Viewer** (read-only, enforced on the
server) role. Passwords are stored as scrypt hashes.

## Checking your setup
```bash
cd server && npx tsx --env-file=../.env scripts/check-livekit.ts          # verifies the key/secret against LiveKit
cd server && npx tsx --env-file=../.env scripts/simulate-webhooks.ts http://localhost:8080 6   # seeds demo history
```
