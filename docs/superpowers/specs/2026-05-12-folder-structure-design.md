# Mappenstructuur: `app/` · `docker/` · `docs/` · `data/`

**Datum:** 2026-05-12
**Status:** Goedgekeurd door eigenaar — klaar voor implementatieplan.

## Doel

De repo opnieuw indelen in vier duidelijk afgebakende top-level mappen, zodat (a) applicatiecode, (b) deployment-artefacten, (c) documentatie en (d) lokale runtime-data van elkaar gescheiden zijn. De huidige flat layout vermengt deze categorieën in de root.

## Eindstructuur

```
regiobijeenkomst-tool/
├── README.md                    ← blijft (GitHub-landingspagina)
├── INSTRUCTIONS.md              ← NIEUW (praktische quickstart in NL)
├── CLAUDE.md                    ← blijft (Claude Code-conventie)
├── .gitignore                   ← blijft, paden bijgewerkt
├── .dockerignore                ← blijft (Docker leest 'm uit build-context root)
├── .claude/                     ← blijft
│
├── app/
│   ├── server.js
│   ├── ceda-workshop.html
│   ├── package.json
│   ├── package-lock.json
│   └── Start Workshop.command
│
├── docker/
│   ├── Dockerfile
│   ├── entrypoint.sh
│   ├── fly.toml
│   ├── Caddyfile
│   └── start-caddy.sh
│
├── docs/
│   ├── sessions/                ← bestaand
│   ├── superpowers/specs/       ← bestaand (dit document)
│   └── README-caddy.md          ← verhuisd uit root
│
└── data/
    └── recaps/                  ← lokale dev-opslag (gitignored)
```

## Verantwoording per map

- **`app/`** — alles dat het draaiende product is: server, frontend, npm-manifest, end-user launcher. `npm install` en `npm start` worden voortaan **vanuit `app/`** gedraaid.
- **`docker/`** — alle artefacten voor containerisatie en deploy (Fly.io + lokale Caddy). Bouwen blijft mogelijk vanaf repo-root als build-context.
- **`docs/`** — bestaande session-logs blijven; secundaire READMEs verhuizen hierheen. `README.md` in root blijft als GitHub-landing.
- **`data/`** — lokale ontwikkel-opslag van recaps. Op productie (Fly) blijft de mount `/data`, ongewijzigd.

## Codewijzigingen naast verplaatsen

### `app/server.js`
- Regel 15: `const RECAP_DIR = process.env.RECAP_DIR || path.join(__dirname, 'recaps');`
  → `path.join(__dirname, '..', 'data', 'recaps')`
- Productie blijft `RECAP_DIR=/data/recaps` via env (Dockerfile + fly.toml). De default-fallback raakt alleen lokaal dev.

### `app/Start Workshop.command`
- Script gebruikt `cd "$(dirname "$0")"` (te verifiëren bij implementatie). `node server.js` blijft kloppen omdat `package.json` en `server.js` mee verhuizen. `pkill -f "node server.js"`-pattern verandert niet.

### `docker/Dockerfile`
- Build-context blijft repo-root. Buildcommando: `docker build -f docker/Dockerfile -t ceda-workshop .`
- `COPY package.json package-lock.json ./` → `COPY app/package.json app/package-lock.json ./`
- `COPY server.js ceda-workshop.html ./` → `COPY app/server.js app/ceda-workshop.html ./`
- `COPY entrypoint.sh /entrypoint.sh` → `COPY docker/entrypoint.sh /entrypoint.sh`

### `docker/fly.toml`
- `[build] dockerfile = "Dockerfile"` → `dockerfile = "docker/Dockerfile"` (Fly leest fly.toml-paden vanaf de directory waarin `fly deploy` draait; build-context blijft die directory).
- Deploy-workflow wordt: `fly deploy --config docker/fly.toml` (uitvoeren vanaf repo-root).
- Mount `source = "recaps"`, `destination = "/data"` ongewijzigd.
- Comments bovenaan fly.toml bijwerken met het nieuwe deploycommando.

### `docker/Caddyfile` + `docker/start-caddy.sh`
- Verwijzingen naar `ceda-workshop.html` of `server.js` updaten als die er staan (verifieer bij implementatie — eerste scan vond geen literale verwijzingen).

### `.dockerignore` (blijft in root)
- `node_modules` → `app/node_modules`
- `recaps` → `data/recaps`
- `Dockerfile` → `docker/Dockerfile`
- `fly.toml` → `docker/fly.toml`
- `Caddyfile`, `start-caddy.sh` → `docker/Caddyfile`, `docker/start-caddy.sh`
- `Start Workshop.command` → `app/Start Workshop.command`
- `README*.md` blijft globaal werken (`README.md` in root, `docs/README-caddy.md` in subdir).

### `.gitignore` (blijft in root)
- `recaps/` → `data/recaps/`
- `node_modules/` blijft globaal — vangt zowel `app/node_modules/` als toekomstige andere subdirs.

### `README.md` (root)
- Quickstart-commando's bijwerken: `cd app && npm install && npm start`.
- Verwijzing naar `INSTRUCTIONS.md` toevoegen.
- Verwijzing naar `docs/README-caddy.md` aanpassen.

### `INSTRUCTIONS.md` (NIEUW, root)
- Korte Nederlandse quickstart:
  - **Lokaal draaien:** `cd app && npm install && npm start`
  - **Lokaal met HTTPS (Caddy):** `cd docker && caddy run`
  - **Deploy naar Fly:** `fly deploy --config docker/fly.toml`
  - **Recaps lokaal:** worden opgeslagen in `data/recaps/`
  - Pointer naar `docs/` voor achtergrond en sessieverslagen.

### `CLAUDE.md`
- `## Commands`-blok bijwerken naar nieuwe paden.
- Architectuursectie: "two-file app: `server.js` + `ceda-workshop.html`" → "two-file app onder `app/`".
- Regel over CSP "lives in both `server.js` and `Caddyfile`" updaten met nieuwe paden.

## Migratiestrategie

- Gebruik `git mv` voor alle verplaatsingen zodat history bewaard blijft.
- Eén commit per logisch geheel (verplaatsing + bijbehorende pad-updates), zodat een revert per laag mogelijk is. Voorstel:
  1. `app/` aanmaken en bestanden verplaatsen + interne pad-updates (`server.js` default, `Start Workshop.command` indien nodig).
  2. `docker/` aanmaken en bestanden verplaatsen + `Dockerfile` `COPY`-paden + `fly.toml` `dockerfile`-veld.
  3. `data/` aanmaken (met `.gitkeep`) en `.gitignore` aanpassen; bestaande lokale `recaps/` verhuizen (uitgesloten van commit door gitignore).
  4. `docs/` aanvullen: `README-caddy.md` erin.
  5. `INSTRUCTIONS.md` schrijven + `README.md` + `CLAUDE.md` + `.dockerignore` bijwerken.

## Verificatie na implementatie

- `cd app && npm install && npm start` start de server, `GET /healthz` retourneert 200.
- Recap-POST naar `/api/recap` schrijft een bestand naar `data/recaps/<room>/<user>.json`.
- `docker build -f docker/Dockerfile -t ceda-test .` slaagt zonder fouten.
- `fly deploy --config docker/fly.toml --build-only` (of een dry-run) slaagt — daadwerkelijk deployen pas op gebruikersinitiatief.
- Geen losse verwijzingen meer naar `./server.js` of `./ceda-workshop.html` op repo-root in shell scripts, Dockerfile of docs.

## Out of scope

- Splitsen van `ceda-workshop.html` in modules of bundling.
- Wijzigen van het WebSocket-protocol of opslagformaat.
- Tests/CI toevoegen (er zijn er nog geen).
