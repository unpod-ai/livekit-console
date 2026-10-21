#!/bin/sh
# Install a stable helper copy; configuration/credentials are operator-owned.
# sudo DEPLOYMENT_CONFIG=/private/config.json DEPLOYMENT_STATE_DIR=/private/state \
#   DEPLOYMENT_PORT=8095 sh scripts/install-deployment-helper.sh
# INSTALL_ROOT=/tmp/install-preview writes artifacts without systemctl.
set -eu
umask 077
DEPLOYMENT_CONFIG=${DEPLOYMENT_CONFIG:-/etc/livekit-deployment-helper/config.json}
DEPLOYMENT_STATE_DIR=${DEPLOYMENT_STATE_DIR:-/var/lib/livekit-deployment-helper}
DEPLOYMENT_PORT=${DEPLOYMENT_PORT:-8095}
DEPLOYMENT_PYTHON=${DEPLOYMENT_PYTHON:-/usr/bin/python3}
INSTALL_ROOT=${INSTALL_ROOT:-}
SOURCE_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
for path in "$DEPLOYMENT_CONFIG" "$DEPLOYMENT_STATE_DIR" "$DEPLOYMENT_PYTHON"; do
  case "$path" in /*) ;; *) echo 'Configuration, state, and Python paths must be absolute' >&2; exit 1;; esac
  # Keep systemd environment/ExecStart parsing unambiguous.
  case "$path" in *[!a-zA-Z0-9_./-]*) echo 'Paths may contain only letters, digits, _, ., / and -' >&2; exit 1;; esac
done
case "$DEPLOYMENT_PORT" in ''|*[!0-9]*) echo 'Port must be numeric' >&2; exit 1;; esac
[ "$DEPLOYMENT_PORT" -ge 1024 ] && [ "$DEPLOYMENT_PORT" -le 65535 ]
install -d -m 755 "$INSTALL_ROOT/usr/local/lib/livekit-deployment-helper" "$INSTALL_ROOT/etc/systemd/system"
install -d -m 700 "$INSTALL_ROOT/etc/livekit-deployment-helper"
install -m 755 "$SOURCE_DIR/deployment-helper.py" "$INSTALL_ROOT/usr/local/lib/livekit-deployment-helper/deployment-helper.py"
cat > "$INSTALL_ROOT/etc/livekit-deployment-helper/service.env" <<EOF
DEPLOYMENT_CONFIG=$DEPLOYMENT_CONFIG
DEPLOYMENT_STATE_DIR=$DEPLOYMENT_STATE_DIR
DEPLOYMENT_PORT=$DEPLOYMENT_PORT
PYTHONDONTWRITEBYTECODE=1
EOF
chmod 600 "$INSTALL_ROOT/etc/livekit-deployment-helper/service.env"
cat > "$INSTALL_ROOT/etc/systemd/system/livekit-deployment-helper.service" <<EOF
[Unit]
Description=Restricted loopback deployment host helper
After=docker.service
Requires=docker.service

[Service]
Type=simple
User=root
UMask=0077
EnvironmentFile=/etc/livekit-deployment-helper/service.env
ExecStart=$DEPLOYMENT_PYTHON /usr/local/lib/livekit-deployment-helper/deployment-helper.py
Restart=on-failure
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true
# Worker containers belong to Docker, not this unit's cgroup. Never stop them here.
KillSignal=SIGTERM
SendSIGKILL=no

[Install]
WantedBy=multi-user.target
EOF
chmod 644 "$INSTALL_ROOT/etc/systemd/system/livekit-deployment-helper.service"
if [ -z "$INSTALL_ROOT" ]; then
  # Install only. The operator explicitly enables/starts after reviewing config.
  systemctl daemon-reload
fi
printf '%s\n' 'Installed livekit-deployment-helper.service (not started or enabled).'
