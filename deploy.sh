#!/usr/bin/env bash
# Deploy LiveKit Console to a VM over SSH. All target settings live in .env.deploy (see .env.deploy.example).
#
#   ./deploy.sh              # sync code, rebuild the image, replace the container (keeps the VM's .env)
#   ./deploy.sh --sync-env   # same, and also copy the local .env to the VM (first deploy / after changing it)
#   ./deploy.sh webhook      # add the webhook block to LiveKit's config on the VM and restart LiveKit
#   ./deploy.sh https        # publish the console over HTTPS (nginx + certbot), limited to ALLOWED_IPS
set -euo pipefail
cd "$(dirname "$0")"

[[ -f .env.deploy ]] || { echo "Missing .env.deploy. Copy .env.deploy.example to .env.deploy and fill it in." >&2; exit 1; }
set -a; . ./.env.deploy; set +a

need() { [[ -n "${!1:-}" ]] || { echo "$1 is not set in .env.deploy" >&2; exit 1; }; }
need DEPLOY_HOST
DEPLOY_DIR="${DEPLOY_DIR:-livekit-console}"
CONSOLE_PORT="${CONSOLE_PORT:-8090}"
SSH=(ssh -o BatchMode=yes -o ConnectTimeout=10 "$DEPLOY_HOST")

case "${1:-}" in
  webhook)
    need LIVEKIT_CONFIG
    echo "==> Enabling webhooks on $DEPLOY_HOST (restarts ${LIVEKIT_CONTAINER:-livekit-livekit-1} if no rooms are active)"
    "${SSH[@]}" "LIVEKIT_CONFIG='$LIVEKIT_CONFIG' LIVEKIT_CONTAINER='${LIVEKIT_CONTAINER:-livekit-livekit-1}' CONSOLE_PORT='$CONSOLE_PORT' bash -s" < scripts/enable-webhook.sh
    exit 0 ;;
  https)
    need CONSOLE_HOST; need ALLOWED_IPS
    echo "==> Publishing https://$CONSOLE_HOST (allowed: $ALLOWED_IPS)"
    # shellcheck disable=SC2086
    "${SSH[@]}" "CONSOLE_HOST='$CONSOLE_HOST' CONSOLE_PORT='$CONSOLE_PORT' bash -s -- $ALLOWED_IPS" < scripts/enable-console-https.sh
    exit 0 ;;
  ""|--sync-env) ;;
  *) echo "usage: ./deploy.sh [--sync-env | webhook | https]" >&2; exit 1 ;;
esac

echo "==> Syncing source to $DEPLOY_HOST:~/$DEPLOY_DIR"
# Start from a clean tree (keeping only the VM's .env): extracting over the old one would leave deleted files behind.
"${SSH[@]}" "mkdir -p ~/$DEPLOY_DIR && cd ~/$DEPLOY_DIR && find . -mindepth 1 -maxdepth 1 ! -name .env -exec rm -rf {} +"
tar czf - --exclude=node_modules --exclude=dist --exclude=.env --exclude=.env.deploy --exclude=data --exclude='*.db*' --exclude=.git . \
  | "${SSH[@]}" "tar xzf - -C ~/$DEPLOY_DIR"

if [[ "${1:-}" == "--sync-env" ]]; then
  echo "==> Copying .env (mode 600)"
  scp -o BatchMode=yes .env "$DEPLOY_HOST:$DEPLOY_DIR/.env"
  "${SSH[@]}" "chmod 600 ~/$DEPLOY_DIR/.env"
fi

echo "==> Building image and restarting container"
# SSH joins command arguments through a remote shell; quote once so empty values and spaces survive.
printf -v remote_command '%q ' bash -s -- "$DEPLOY_DIR" "$CONSOLE_PORT" "${LIVEKIT_INTERNAL_URL:-ws://127.0.0.1:7880}" "${AGENT_WORKER_URLS:-}"
"${SSH[@]}" "$remote_command" <<'REMOTE'
set -euo pipefail
dir="$1"; port="$2"; lk_url="$3"; worker_urls="$4"
cd ~/"$dir"
[[ -f .env ]] || { echo "No .env on the VM; run ./deploy.sh --sync-env" >&2; exit 1; }

docker build -t livekit-console:latest . | tail -2
docker rm -f livekit-console >/dev/null 2>&1 || true
# Host networking so a host-networked LiveKit is reachable on 127.0.0.1 and can POST webhooks to us.
# Explicit -e flags override the values in .env: the console talks to the LiveKit server on this machine.
docker run -d --name livekit-console --restart unless-stopped --network host \
  --env-file .env \
  -e HOST=127.0.0.1 -e PORT="$port" \
  -e LIVEKIT_URL="$lk_url" \
  -e DB_PATH=/data/console.db \
  -e AGENT_WORKER_URLS="$worker_urls" \
  -v livekit-console-data:/data \
  livekit-console:latest >/dev/null

for _ in $(seq 1 45); do
  if curl -fsS "http://127.0.0.1:$port/healthz" >/dev/null 2>&1; then
    echo "==> Healthy on 127.0.0.1:$port"
    docker image prune -f >/dev/null
    exit 0
  fi
  sleep 1
done
echo "Container did not become healthy; logs:" >&2
docker logs --tail 30 livekit-console >&2
exit 1
REMOTE

echo "==> Done. Tunnel: ssh -L $CONSOLE_PORT:127.0.0.1:$CONSOLE_PORT $DEPLOY_HOST  ->  http://localhost:$CONSOLE_PORT"
