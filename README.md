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
- **Eindoogst** wordt alleen centraal opgeslagen als een deelnemer in de recap-fase
  expliciet op *Oogst opslaan voor analyse* klikt. Files belanden in `RECAP_DIR`
  (default lokaal: `./data/recaps`, productie: `/data/recaps`) als
  `<roomCode>/<userId>.json`. De UI zelf legt deze
  consent uit in een kader direct boven de knop — de bedoeling is dat
  deelnemers daar geïnformeerd worden, niet via een aparte facilitator-brief.

## Centrale oogst voor analyse

Iedere deelnemer ziet aan het einde van de workshop een knop *Oogst opslaan voor analyse*.
Klikken POST't de eigen JSON-state naar `POST /api/recap` en schrijft die naar disk.
Per deelnemer wordt één bestand bewaard; herhaald opslaan overschrijft.

Layout op disk:
```
recaps/
  <ROOMCODE>/
    u_xxxxx.json   # ← deelnemer 1, laatste save
    u_yyyyy.json   # ← deelnemer 2, laatste save
```

### Resultaten bekijken na afloop

Twee manieren, kies wat past:

**Via de browser** — open `/admin/recaps` op de live URL en log in met
basic-auth. Lijst van alle bijeenkomsten met deelnemers per sessie; klik
op een bestand om de JSON te downloaden. Vereist dat `ADMIN_PASSWORD`
als env-var of Fly-secret is gezet — als die ontbreekt staat de hele
admin-route uit (503).

```
fly secrets set ADMIN_PASSWORD='kies-een-sterk-wachtwoord' -a ceda-regiobijeenkomst
```

Default username is `ceda` (overschrijven via `ADMIN_USER`). Het kader
boven de save-knop in de app maakt geen melding van dit endpoint — het
is bedoeld voor jullie als facilitators/admins, niet voor deelnemers.

**Via CLI / bulk-export** — voor analyse-pipelines of een complete kopie:

```
fly ssh console -C "tar -C /data/recaps -czf - ." > recaps-$(date +%F).tgz
```

## Productie-deployment

### Fly.io (aanbevolen, regio Amsterdam)

```
fly auth login
fly launch --copy-config --no-deploy --config docker/fly.toml
fly volumes create recaps --region ams --size 1 --config docker/fly.toml
fly deploy --config docker/fly.toml
```

`docker/fly.toml` mount het volume op `/data`; de server schrijft naar `/data/recaps`.

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
