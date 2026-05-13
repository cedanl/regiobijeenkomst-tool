# CEDA Regiobijeenkomst — Workshop Tool

Node.js-app voor de interactieve regiobijeenkomst voor hbo en wo.
Live samenwerking via WebSocket-relay, eigen Node-server, optioneel Caddy ervoor voor HTTPS.

## Snelstart

Dubbelklik op **`app/Start Workshop.command`**. Dat regelt alles:

1. Checkt Node.js (installeert via Homebrew als nodig).
2. `npm install` voor dependencies (eenmalig).
3. Start Node-server op poort 3000.
4. Start Caddy als HTTPS-frontend op 8443 (optioneel — alleen als Caddy is geïnstalleerd).
5. Opent je browser.

Sluit het Terminal-venster om beide servers te stoppen.

Zie ook [`INSTRUCTIONS.md`](INSTRUCTIONS.md) voor een korte commando-quickstart.

## Handmatig

    cd app
    npm install
    npm start

URL: http://localhost:3000

Voor HTTPS via Caddy (vanuit repo-root):

    caddy run --config docker/Caddyfile

URL: https://localhost:8443

## Architectuur

| Component | Rol |
|---|---|
| `app/server.js` | Express + WebSocket-relay. Serveert `ceda-workshop.html`, broadcast berichten binnen sessiecode. |
| `app/ceda-workshop.html` | Frontend (single-file). Verbindt via `ws://host/ws?room=<CODE>`. |
| `docker/Caddyfile` | Optionele HTTPS-frontend met security-headers, reverse-proxied naar Node. |
| `app/Start Workshop.command` | macOS-launcher. Doet `npm install`, start beide servers, opent browser. |

## Endpoints

- `GET /` → workshop-app
- `GET /healthz` → `{ ok: true, rooms: N }`
- `GET /api/stats` → aantal rooms + peers per room (geen content)
- `POST /api/recap` → opt-in eindoogst opslaan (body = participant state JSON)
- `GET /admin/recaps` → browse-UI voor admins (basic-auth via `ADMIN_PASSWORD`)
- `GET /admin/recaps/:room/:file` → JSON-download per recap-bestand
- `WS /ws?room=<CODE>` → relay (broadcast naar andere peers in zelfde room)

## Beveiliging & privacy

- Security-headers (CSP, HSTS, X-Frame-Options, Permissions-Policy) gezet in zowel Express als Caddy.
- Geen authenticatie, geen DB. Sessiecode = enige toegangsdrempel.
- WebSocket-payload gelimiteerd op 64 KB; ongebruikte rooms worden direct opgeruimd.
- Server-ping elke 30s — dode connecties worden beëindigd.
- **Live-verkeer** wordt niet gelogd of opgeslagen — alleen doorgegeven.
- **Sessie-state** wordt tijdens de bijeenkomst periodiek (debounce 5s + heartbeat 60s)
  door elke deelnemer naar `POST /api/recap` gestuurd. De server merget per kamer
  in één bestand `RECAP_DIR/<ROOM>/state.json` (default lokaal `./data/recaps/`,
  productie `/data/recaps`) onder een per-room mutex. Per deelnemer wordt de
  laatste state bewaard; nieuwe writes overschrijven die sectie. Het topbar van
  de app toont een korte regel *"Opslag voor analyse"* zodra een sessie actief is.

## Centrale oogst voor analyse

Tijdens de workshop POST't elke deelnemer zijn state periodiek naar
`/api/recap`. De server houdt per kamer één samengevoegd bestand bij:

Layout op disk:
```
data/recaps/
  <ROOMCODE>/
    state.json   # ← alle deelnemers van deze bijeenkomst, samengevoegd
```

`state.json` heeft de vorm:

```json
{
  "roomCode": "WS2026",
  "createdAt": "2026-05-13T10:02:11.000Z",
  "updatedAt": "2026-05-13T10:47:33.412Z",
  "participants": {
    "u_abc123": { "savedAt": "...", "state": { /* deelnemer-state */ } }
  }
}
```

Oude bijeenkomsten kunnen nog `<ROOMCODE>/<userId>.json`-files bevatten
(legacy per-deelnemer-model van vóór deze wijziging). Die blijven leesbaar
en downloadbaar via de admin-UI onder *"Legacy per-deelnemer-saves"*.

### Resultaten bekijken na afloop

Twee manieren, kies wat past:

**Via de browser** — open `/admin/recaps` op de live URL en log in met
basic-auth. Lijst van alle bijeenkomsten met een downloadlink naar het
samengevoegde `state.json` per kamer (en eventuele legacy files daaronder).
Vereist dat `ADMIN_PASSWORD` als env-var of Fly-secret is gezet — als die
ontbreekt staat de hele admin-route uit (503).

```
fly secrets set ADMIN_PASSWORD='kies-een-sterk-wachtwoord' -a ceda-regiobijeenkomst
```

Default username is `ceda` (overschrijven via `ADMIN_USER`).

**Via CLI / bulk-export** — voor analyse-pipelines of een complete kopie:

```
fly ssh console -C "tar -C /data/recaps -czf - ." > recaps-$(date +%F).tgz
```

## Productie-deployment

### Fly.io (aanbevolen, regio Amsterdam)

```
fly auth login
fly launch --copy-config --no-deploy
fly volumes create recaps --region ams --size 1
fly deploy
```

`fly.toml` (in repo-root) mount het volume op `/data`; de server schrijft naar `/data/recaps`.

### Eigen VPS

1. Vervang in `docker/Caddyfile` `localhost:8443` door je domein.
2. Zorg voor DNS A-record + open poort 80/443.
3. Draai Node als systemd-service of via `pm2`/`launchd`.
4. Caddy regelt Let's Encrypt automatisch.

Zie `docs/README-caddy.md` voor uitgebreide HTTPS-instructies.

## Vereisten

- Node.js ≥ 18
- macOS / Linux / Windows
- (optioneel) Caddy voor HTTPS-frontend
