# 2026-05-18 — CLAUDE.md uitbreiding via /init

## Wat
CLAUDE.md aangevuld met gedragsrichtlijnen (Think / Simplicity / Surgical / Goal-driven), een env-var tabel onder Commands en een endpoint-lijst onder `server.js`. Foutje in repo-layout gecorrigeerd: `fly.toml` staat in repo-root, niet in `docker/`.

## Waarom
`/init` getriggerd op een al bestaande CLAUDE.md. De bestaande tekst was projectspecifiek en sterk; alleen kleine aanvullingen toegevoegd in plaats van een rewrite. De env-vars (`RECAP_DIR`, `ADMIN_USER`, `ADMIN_PASSWORD`) en endpoint-lijst stonden alleen in `README.md` — handig om ze ook in CLAUDE.md te hebben zodat toekomstige Claude-instanties ze direct vinden.

## Hoe
- `## Commands` → nieuwe subsectie `### Environment variables` met tabel `PORT`/`HOST`, `RECAP_DIR`, `ADMIN_USER`, `ADMIN_PASSWORD`.
- `## Architecture` → bullet onder `server.js` met de zeven endpoints (`/`, `/healthz`, `/api/stats`, `/api/recap`, `/admin/recaps`, `/admin/recaps/:room/:file`, `/ws`).
- Repo-layout bullet voor `docker/` verduidelijkt dat `fly.toml` in repo-root staat.
- `CLAUDE.md~` backup-bestand verwijderd uit working tree.

## Niet aangeraakt
- Bestaande gedragsrichtlijnen (sectie 1–4) — gebruiker wilde die houden.
- Architectuur-secties over `ceda-workshop.html`, op-based sync, rules of thumb.
- Conventions.

## Commits
- `84fd10d` docs(claude): gedragsrichtlijnen, env-var tabel en endpoint-lijst

Gepusht naar `origin/main`.
