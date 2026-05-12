#!/usr/bin/env bash
# CEDA Regiobijeenkomst — Workshop Launcher
# Dubbelklik om de Node.js-server te starten (en optioneel Caddy ervoor voor HTTPS).

set -e
cd "$(dirname "$0")"

B='\033[1m'; N='\033[0m'; G='\033[32m'; Y='\033[33m'; R='\033[31m'; C='\033[36m'

clear
cat <<'BANNER'
╔══════════════════════════════════════════════════════════════╗
║   CEDA Regiobijeenkomst — Workshop starten (Node.js)         ║
╚══════════════════════════════════════════════════════════════╝
BANNER
echo ""

# --- Stap 1: Node.js check ---
if ! command -v node >/dev/null 2>&1; then
    echo -e "  ${R}✗${N} Node.js is niet geïnstalleerd."
    echo ""
    if command -v brew >/dev/null 2>&1; then
        echo -e "  ${Y}▶${N} Bezig met installeren via Homebrew..."
        brew install node || {
            echo -e "  ${R}✗${N} Installatie mislukt. Probeer handmatig: https://nodejs.org/"
            read -n 1 -s -r -p "Druk op een toets om af te sluiten..."
            exit 1
        }
    else
        echo "    Installeer Node.js: https://nodejs.org/  (of: brew install node)"
        read -n 1 -s -r -p "Druk op een toets om af te sluiten..."
        exit 1
    fi
fi
echo -e "  ${G}✔${N} Node.js: $(node --version)"

# --- Stap 2: dependencies ---
if [ ! -d node_modules ]; then
    echo -e "  ${Y}▶${N} Dependencies installeren (eenmalig, ~30 sec)..."
    npm install --silent --no-fund --no-audit
    echo -e "  ${G}✔${N} Dependencies klaar."
else
    echo -e "  ${G}✔${N} Dependencies aanwezig."
fi

# --- Stap 3: oude processen opruimen ---
pkill -f "node server.js" 2>/dev/null || true
pkill -f "caddy run --config Caddyfile" 2>/dev/null || true
sleep 1

# --- Stap 4: Node-server starten ---
echo -e "  ${Y}▶${N} Node-server starten op poort 3000..."
node server.js > /tmp/ceda-node.log 2>&1 &
NODE_PID=$!

# Wacht tot Node luistert
for i in 1 2 3 4 5 6 7 8 9 10; do
    sleep 1
    if curl -s --max-time 1 "http://localhost:3000/healthz" -o /dev/null 2>&1; then
        break
    fi
done

if ! curl -s --max-time 1 "http://localhost:3000/healthz" -o /dev/null 2>&1; then
    echo -e "  ${R}✗${N} Node-server reageert niet — log in /tmp/ceda-node.log"
    tail -n 20 /tmp/ceda-node.log
    kill $NODE_PID 2>/dev/null || true
    read -n 1 -s -r -p "Druk op een toets om af te sluiten..."
    exit 1
fi
echo -e "  ${G}✔${N} Node draait op http://localhost:3000"

# --- Stap 5: optioneel Caddy voor HTTPS ---
CADDY_PID=""
URL="http://localhost:3000"
if command -v caddy >/dev/null 2>&1; then
    echo -e "  ${Y}▶${N} Caddy starten (HTTPS-frontend op poort 8443)..."
    caddy run --config ../docker/Caddyfile --adapter caddyfile > /tmp/ceda-caddy.log 2>&1 &
    CADDY_PID=$!
    sleep 2
    if curl -sk --max-time 1 "https://localhost:8443/healthz" -o /dev/null 2>&1; then
        URL="https://localhost:8443"
        echo -e "  ${G}✔${N} HTTPS actief op https://localhost:8443"
    else
        echo -e "  ${Y}!${N} Caddy startte niet correct — Node blijft draaien zonder HTTPS."
        kill $CADDY_PID 2>/dev/null || true
        CADDY_PID=""
    fi
else
    echo "  (Tip: installeer Caddy voor HTTPS — brew install caddy)"
fi

echo ""
echo -e "    URL: ${B}${C}${URL}${N}"
LOCAL_IP=$(ifconfig 2>/dev/null | grep "inet " | grep -v 127.0.0.1 | awk '{print $2}' | head -1 || echo "")
if [ -n "$LOCAL_IP" ]; then
    PORT=$(echo "$URL" | grep -oE '[0-9]+$')
    PROTO=$(echo "$URL" | grep -oE '^https?')
    echo -e "    LAN: ${B}${PROTO}://${LOCAL_IP}:${PORT}${N}"
fi
echo ""
echo -e "  ${C}Browser openen...${N}"
sleep 1
open "$URL" || true

echo ""
echo "  ───────────────────────────────────────────────────────────"
echo -e "  ${B}Sluit dit venster${N} (of Ctrl+C) om beide servers te stoppen."
echo "  ───────────────────────────────────────────────────────────"
echo ""

# Cleanup on exit
trap "echo ''; echo '  Servers stoppen...'; kill $NODE_PID 2>/dev/null; [ -n \"$CADDY_PID\" ] && kill $CADDY_PID 2>/dev/null; exit 0" INT TERM EXIT

wait $NODE_PID
