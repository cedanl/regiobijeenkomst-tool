#!/usr/bin/env bash
# Start Caddy met het Caddyfile in deze map.
# Eerste keer: macOS vraagt om je wachtwoord om de lokale Caddy CA te installeren —
# zo wordt het https://localhost certificaat automatisch vertrouwd door Chrome/Safari/Firefox.

set -euo pipefail

cd "$(dirname "$0")"

if ! command -v caddy >/dev/null 2>&1; then
	echo "Caddy is nog niet geïnstalleerd."
	echo ""
	echo "Installeer met Homebrew (macOS):"
	echo "    brew install caddy"
	echo ""
	echo "Of bekijk: https://caddyserver.com/docs/install"
	exit 1
fi

echo "▶ Caddy starten op https://localhost ..."
echo "  (Stop met Ctrl+C)"
echo ""
exec caddy run --config Caddyfile --adapter caddyfile
