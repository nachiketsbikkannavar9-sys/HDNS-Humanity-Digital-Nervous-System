#!/usr/bin/env bash
# Keeps a public HTTP tunnel alive for the HDNS backend and re-deploys
# the Vercel SPA whenever the tunnel's hostname changes (VITE_API_BASE is baked
# into the static build). Primary transport is a Cloudflare quick tunnel
# (no account, sessions survive for hours); localhost.run is the fallback.
#
# Tunnels can silently stop routing without closing the socket, so the relay
# health-checks the tunnel's own /api/stations and force-reconnects after 3
# consecutive failures. Reconnect -> new hostname -> single serialised
# `vercel deploy --build-env VITE_API_BASE=<url>` (lockfile protects it).
set -u

STATE="/tmp/opencode/last-tunnel-url"
LOG="/tmp/opencode/tunnel-relay.log"
LOCK="/tmp/opencode/deploy.lock"
# cron gives a minimal PATH without nvm's bin -> resolve absolute binary paths.
export PATH="/home/abhilash/.nvm/versions/node/v22.17.1/bin:$PATH"
VERCEL_BIN="$(command -v vercel || true)"
[ -n "$VERCEL_BIN" ] || VERCEL_BIN="/home/abhilash/.nvm/versions/node/v22.17.1/bin/vercel"
CLOUDFLARED=""
for c in ${CLOUDFLARED_BIN:-} "$HOME/.local/bin/cloudflared" /usr/local/bin/cloudflared; do
  [ -z "$c" ] && continue
  [ -x "$c" ] && CLOUDFLARED="$c" && break
done
URL_RE='https://[a-z0-9-]+\.(lhr\.life|trycloudflare\.com)'
mkdir -p /tmp/opencode
rm -rf "$LOCK"

if [ ! -f "$STATE" ] && [ -n "${INITIAL_TUNNEL_URL:-}" ]; then
  echo "$INITIAL_TUNNEL_URL" > "$STATE"
fi

log() { echo "$(date -u) $*" >> "$LOG"; }
on_exit() { log "relay process exiting (rc=$?)"; }
trap on_exit EXIT

deploy_for() {
  local url="$1" current="$2"
  if [ "$url" = "$current" ]; then return 0; fi
  # Clear a stale lock from a crashed previous deploy.
  [ -d "$LOCK" ] && find "$LOCK" -maxdepth 0 -mmin +10 -exec rm -rf {} \; 2>/dev/null
  if ! mkdir "$LOCK" 2>/dev/null; then return 0; fi
  log "relay -> $url (was: ${current:-none})"
  echo "$url" > "$STATE"
  cd /home/abhilash/flood || { rmdir "$LOCK" 2>/dev/null; return 1; }
  "$VERCEL_BIN" deploy --prod --yes --build-env "VITE_API_BASE=$url" >> "$LOG" 2>&1 || log "deploy failed (rc=$?)"
  log "redeploy finished"
  rmdir "$LOCK" 2>/dev/null
}

while true; do
  rm -f /tmp/opencode/tunnel.log
  log "connecting tunnel..."
  if [ -n "$CLOUDFLARED" ]; then
    "$CLOUDFLARED" tunnel --no-autoupdate --url http://localhost:4000 > /tmp/opencode/tunnel.log 2>&1 &
  else
    ssh -o ServerAliveInterval=20 -o ServerAliveCountMax=3 \
      -o ExitOnForwardFailure=yes -o StrictHostKeyChecking=accept-new \
      -R 80:localhost:4000 nokey@localhost.run > /tmp/opencode/tunnel.log 2>&1 &
  fi
  ssh_pid=$!
  url=""
  failures=0

  while kill -0 "$ssh_pid" 2>/dev/null; do
    next="$(grep -oE "$URL_RE" /tmp/opencode/tunnel.log 2>/dev/null | head -1)"
    if [ -n "$next" ] && [ "$next" != "$url" ]; then
      url="$next"
      deploy_for "$url" "$(cat "$STATE" 2>/dev/null)"
      # New tunnels need a moment to become live at the edge before probing.
      log "settling 25s before health checks"
      sleep 25
    fi
    if [ -n "$url" ]; then
      if curl -sf --max-time 10 "https://$url/api/stations" -o /dev/null 2>&1; then
        failures=0
      else
        failures=$((failures + 1))
        log "health check failed ($failures/4) at $url"
      fi
      if [ "$failures" -ge 4 ]; then
        log "tunnel unhealthy, forcing reconnect"
        kill "$ssh_pid" 2>/dev/null
        break
      fi
    fi
    sleep 25
  done

  wait "$ssh_pid" 2>/dev/null
  log "tunnel ended, reconnecting in 3s"
  sleep 3
done