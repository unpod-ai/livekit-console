#!/usr/bin/env bash
# Adds the console's webhook block to the POC LiveKit config and restarts the LiveKit server.
# Runs ON THE VM (needs sudo to read/write livekit.yaml):
#
#   ./deploy.sh webhook      (settings come from .env.deploy)
#
# Safe to re-run: it backs up the file first and does nothing if a webhook block exists.
# Restarting livekit-livekit-1 disconnects any live calls, so it refuses to restart while rooms are active.
set -euo pipefail

F="${LIVEKIT_CONFIG:?set LIVEKIT_CONFIG (path of livekit.yaml on the VM)}"
CONTAINER="${LIVEKIT_CONTAINER:-livekit-livekit-1}"
URL="http://127.0.0.1:${CONSOLE_PORT:-8090}/webhook"

sudo test -f "$F" || { echo "missing $F" >&2; exit 1; }
if sudo grep -q -E '^webhook:' "$F"; then
  echo "webhook block already present in $F; nothing to do"
  exit 0
fi

# First key name under `keys:` (the name only, never the secret).
KEY=$(sudo awk '/^keys:/{f=1;next} f&&/^[[:space:]]+[^#[:space:]][^:]*:/{sub(/^[[:space:]]+/,"");sub(/:.*/,"");print;exit} f&&/^[^[:space:]#]/{exit}' "$F")
[ -n "$KEY" ] || { echo "could not find an API key under keys: in $F" >&2; exit 1; }

BAK="$F.bak-$(date +%Y%m%d-%H%M%S)"
sudo cp -p "$F" "$BAK"
echo "backup: $BAK"

printf '\nwebhook:\n  api_key: %s\n  urls:\n    - %s\n' "$KEY" "$URL" | sudo tee -a "$F" >/dev/null
echo "added webhook block -> $URL"

if ! docker exec livekit-console node -e '
  import("/app/server/dist/livekit.js").then(async (m) => {
    const rooms = await m.rooms.listRooms();
    if (rooms.length) { console.log("active rooms: " + rooms.length); process.exit(3); }
    process.exit(0);
  }).catch((e) => { console.log("room check failed: " + e.message); process.exit(1); });
' 2>/dev/null; then
  echo "Rooms are active (or the check failed); config is edited but NOT restarted." >&2
  echo "Restart later with: docker restart $CONTAINER" >&2
  exit 3
fi

docker restart "$CONTAINER" >/dev/null
sleep 5
docker ps --filter "name=$CONTAINER" --format '{{.Names}}: {{.Status}}'
echo "--- recent LiveKit log lines mentioning webhook/errors:"
docker logs --tail 40 "$CONTAINER" 2>&1 | grep -i -E 'webhook|error|fatal|yaml' || echo "(none)"
echo "To roll back: sudo cp -p $BAK $F && docker restart $CONTAINER"
