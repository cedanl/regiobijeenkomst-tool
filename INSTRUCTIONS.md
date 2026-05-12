# Instructies — Aan de slag

Korte praktische gids. Voor projectcontext en achtergrond: zie [`README.md`](README.md).

## Mappenstructuur

| Map | Inhoud |
|---|---|
| `app/` | Applicatiecode (Node-server + frontend + npm-manifest) |
| `docker/` | Dockerfile, Fly.io-config, Caddyfile |
| `docs/` | Documentatie en sessieverslagen |
| `data/` | Lokale recap-opslag (gitignored) |

## Lokaal draaien

```
cd app
npm install
npm start
```

Open http://localhost:3000.

Dubbelklik-alternatief (macOS): `app/Start Workshop.command`.

## Lokaal met HTTPS (Caddy)

Vanuit repo-root, in een tweede terminal naast Node:

```
caddy run --config docker/Caddyfile
```

Open https://localhost:8443.

## Recaps lokaal bekijken

POST naar `/api/recap` schrijft een bestand naar `data/recaps/<room>/<user>.json`.

Browse-UI: http://localhost:3000/admin/recaps (zet eerst `ADMIN_PASSWORD` in
je environment; zonder is de admin-route uit).

## Deploy naar Fly.io

Vanaf repo-root:

```
fly deploy
```

Eerste keer setup:

```
fly auth login
fly launch --copy-config --no-deploy
fly volumes create recaps --region ams --size 1
fly deploy
```

## Docker-image lokaal bouwen

```
docker build -f docker/Dockerfile -t ceda-workshop .
docker run -p 3000:3000 -e ADMIN_PASSWORD=test ceda-workshop
```

## Meer info

- `docs/README-caddy.md` — uitgebreide HTTPS-instructies
- `docs/sessions/` — sessieverslagen en ontwikkellog
- `CLAUDE.md` — instructies voor Claude Code
