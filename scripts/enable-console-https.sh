#!/usr/bin/env bash
# Publishes the console at https://$CONSOLE_HOST, reachable ONLY from the given IPs (your VPN exit).
# Runs ON THE VM (needs sudo for nginx + certbot):
#
#   ./deploy.sh https        (CONSOLE_HOST / ALLOWED_IPS come from .env.deploy)
#
# What it does: adds a new nginx site (the existing livekit.unpod.tv site is not touched), gets a Let's Encrypt
# cert for the console hostname, allows only the listed IPs on 443, and rate-limits the login endpoint.
# If nginx rejects the config, the new files are removed and nothing is reloaded.
set -euo pipefail

HOST="${CONSOLE_HOST:?set CONSOLE_HOST (public hostname for the console)}"
UPSTREAM="http://127.0.0.1:${CONSOLE_PORT:-8090}"
SITE=/etc/nginx/sites-available/livekit-console
LIMIT_CONF=/etc/nginx/conf.d/livekit-console-ratelimit.conf

[[ $# -ge 1 ]] || { echo "usage: bash -s -- <allowed-ip-or-cidr> [...]" >&2; exit 1; }
ALLOW=""
for ip in "$@"; do
  [[ "$ip" =~ ^[0-9a-fA-F:.]+(/[0-9]+)?$ ]] || { echo "not an IP/CIDR: $ip" >&2; exit 1; }
  ALLOW+="    allow $ip;"$'\n'
done
# Always allow loopback and the VM's own private address(es) (10.x / 192.168.x), so on-box checks work.
PRIVATE_IPS=$(ip -4 -o addr show scope global | awk '{split($4,a,"/"); print a[1]}' | grep -E '^(10\.|192\.168\.)' || true)
for ip in 127.0.0.1 $PRIVATE_IPS; do ALLOW+="    allow $ip;"$'\n'; done
echo "allowed sources: $* 127.0.0.1 $(echo $PRIVATE_IPS)"

curl -fsS -m 5 "$UPSTREAM/healthz" >/dev/null || { echo "console is not answering on $UPSTREAM" >&2; exit 1; }

cleanup_on_fail() {
  echo "FAILED: removing new nginx files, leaving the existing config untouched" >&2
  sudo rm -f /etc/nginx/sites-enabled/livekit-console "$SITE" "$LIMIT_CONF"
  sudo nginx -t >/dev/null 2>&1 && sudo systemctl reload nginx || true
}
trap cleanup_on_fail ERR

echo "limit_req_zone \$binary_remote_addr zone=console_login:1m rate=10r/m;" | sudo tee "$LIMIT_CONF" >/dev/null

# Step 1: plain-HTTP site so certbot can validate the name (port 80 stays open to the internet for this).
sudo tee "$SITE" >/dev/null <<EOF
server {
    listen 80;
    server_name $HOST;
    location / { return 301 https://\$host\$request_uri; }
}
EOF
sudo ln -sf "$SITE" /etc/nginx/sites-enabled/livekit-console
sudo nginx -t
sudo systemctl reload nginx

sudo certbot certonly --nginx -d "$HOST" --non-interactive --agree-tos --register-unsafely-without-email

# Step 2: full config, HTTPS restricted to the allowed IPs.
sudo tee "$SITE" >/dev/null <<EOF
server {
    listen 80;
    server_name $HOST;
    location / { return 301 https://\$host\$request_uri; }
}

server {
    listen 443 ssl;
    server_name $HOST;

    ssl_certificate /etc/letsencrypt/live/$HOST/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/$HOST/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;

$ALLOW    deny all;

    location = /api/auth/login {
        limit_req zone=console_login burst=5 nodelay;
        proxy_pass $UPSTREAM;
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    location / {
        proxy_pass $UPSTREAM;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
EOF
sudo nginx -t
sudo systemctl reload nginx
trap - ERR

echo "--- done: https://$HOST  (allowed: $* 127.0.0.1 $(echo $PRIVATE_IPS))"
echo "To remove: sudo rm /etc/nginx/sites-enabled/livekit-console $SITE $LIMIT_CONF && sudo systemctl reload nginx"
