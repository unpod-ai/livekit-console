#!/usr/bin/env bash
# Install the opt-in host collector; does not grant Docker access to the web container.
set -euo pipefail
console_dir="$(cd "$(dirname "$0")/.." && pwd)"
collector_user="$(id -un)"
collector_home="$HOME"
env_file="${DIAGNOSTICS_ENV_FILE:-$collector_home/.config/livekit-console/diagnostics.env}"
[[ -f "$env_file" ]] || { echo "Create $env_file with AGENT_TELEMETRY_TOKEN and collector configuration first." >&2; exit 1; }
[[ "$(stat -c %a "$env_file")" == 600 ]] || { echo 'Collector environment must have mode 600.' >&2; exit 1; }
# Keep generated systemd configuration free of shell/systemd metacharacters.
for value in "$console_dir" "$env_file" "$collector_home" "$collector_user"; do
  [[ "$value" =~ ^[a-zA-Z0-9_./-]+$ ]] || { echo 'Unsupported installation path or user.' >&2; exit 1; }
done
unit="$(mktemp)"
trap 'rm -f "$unit"' EXIT
cat > "$unit" <<UNIT
[Unit]
Description=LiveKit Console host diagnostics collector
After=network-online.target docker.service
Wants=network-online.target

[Service]
User=$collector_user
EnvironmentFile=$env_file
Environment=DIAGNOSTICS_STATE_DIR=$collector_home/.local/state/livekit-console-diagnostics
ExecStart=/usr/bin/python3 $console_dir/scripts/collect-diagnostics.py
Restart=on-failure
RestartSec=10
UMask=0077
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
UNIT
sudo install -m 644 "$unit" /etc/systemd/system/livekit-console-diagnostics.service
sudo systemctl daemon-reload
sudo systemctl enable --now livekit-console-diagnostics.service
sudo systemctl restart livekit-console-diagnostics.service
sudo systemctl is-active livekit-console-diagnostics.service
