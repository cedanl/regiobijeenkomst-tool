# CEDA Regiobijeenkomst — Workshop Tool

Node.js-app voor de interactieve regiobijeenkomst voor hbo en wo.
Live samenwerking via WebSocket-relay, eigen Node-server, optioneel Caddy ervoor voor HTTPS.

## Snelstart

Dubbelklik op **`Start Workshop.command`**. Dat regelt alles:

1. Checkt Node.js (installeert via Homebrew als nodig).
2. `npm install` voor dependencies (eenmalig).
3. Start Node-server op poort 3000.
4. Start Caddy als HTTPS-frontend op 8443 (optioneel — alleen als Caddy is geïnstalleerd).
5. Opent je browser.

Sluit het Terminal-venster om beide servers te stoppen.

## Handmatig

    npm install
    npm start

URL: http://localhost:3000

Voor HTTPS via Caddy:

    caddy run

URL: https://localhost:8443

## Architectuur

| Component | Rol |
|---|---|
| `server.js` | Express + WebSocket-relay. Serveert `ceda-workshop.html`, broadcast berichten binnen sessiecode. |
| `ceda-workshop.html` | Frontend (single-file). Verbindt via `ws://host/ws?room=<CODE>`. |
| `Caddyfile` | Optionele HTTPS-frontend met security-headers, reverse-proxied naar Node. |
| `Start Workshop.command` | macOS-launcher. Doet `npm install`, start beide servers, opent browser. |

## Endpoints

- `GET /` → workshop-app
- `GET /healthz` → `{ ok: true, rooms: N }`
- `GET /api/stats` → aantal rooms + peers per room (geen content)
- `WS /ws?room=<CODE>` → relay (broadcast naar andere peers in zelfde room)

## Beveiliging

- Security-headers (CSP, HSTS, X-Frame-Options, Permissions-Policy) gezet in zowel Express als Caddy.
- Geen authenticatie, geen DB. Sessiecode = enige toegangsdrempel.
- Berichten worden niet gelogd of opgeslagen — alleen doorgegeven.
- WebSocket-payload gelimiteerd op 64 KB; ongebruikte rooms worden direct opgeruimd.
- Server-ping elke 30s — dode connecties worden beëindigd.

## Productie-deployment

1. Vervang in `Caddyfile` `localhost:8443` door je domein.
2. Zorg voor DNS A-record + open poort 80/443.
3. Draai Node als systemd-service of via `pm2`/`launchd`.
4. Caddy regelt Let's Encrypt automatisch.

Zie `README-caddy.md` voor uitgebreide HTTPS-instructies.

## Vereisten

- Node.js ≥ 18
- macOS / Linux / Windows
- (optioneel) Caddy voor HTTPS-frontend
