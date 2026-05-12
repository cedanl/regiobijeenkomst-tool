# Folder Structure Refactor — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reorganiseer de repo van flat-layout naar vier afgebakende top-level mappen: `app/`, `docker/`, `docs/`, `data/`. Voeg `INSTRUCTIONS.md` toe in de root.

**Architecture:** Pure file-move + path-update refactor. Geen gedragsverandering. Eén commit per logische laag zodat elke stap individueel revertable is. `git mv` overal zodat history bewaard blijft.

**Tech Stack:** Node.js (ES modules), Express, ws, Docker (Fly.io), Caddy. Geen test-suite — verificatie via `npm start` + `curl /healthz` en `docker build`.

**Spec:** `docs/superpowers/specs/2026-05-12-folder-structure-design.md`

---

## Task 1: Voorbereiding — clean working tree + draaiende baseline

**Files:** geen wijzigingen, alleen verificatie.

- [ ] **Step 1: Verifieer clean working tree**

```bash
git status
```

Verwacht: `nothing to commit, working tree clean`. Als er ongeplande wijzigingen zijn: stop en stash/commit eerst.

- [ ] **Step 2: Verifieer dat huidige setup draait**

```bash
npm install
npm start &
sleep 2
curl -s http://localhost:3000/healthz
kill %1
```

Verwacht: `{"ok":true,...}`. Dit is de baseline waarmee we elke volgende task vergelijken.

---

## Task 2: Verhuis applicatiebestanden naar `app/`

**Files:**
- Create directory: `app/`
- Move: `server.js`, `ceda-workshop.html`, `package.json`, `package-lock.json`, `Start Workshop.command` → `app/`
- Modify: `app/server.js:15` (RECAP_DIR default)
- Modify: `app/Start Workshop.command:78` (Caddyfile-pad)

- [ ] **Step 1: Maak `app/` aan en verplaats bestanden met `git mv`**

```bash
mkdir -p app
git mv server.js app/server.js
git mv ceda-workshop.html app/ceda-workshop.html
git mv package.json app/package.json
git mv package-lock.json app/package-lock.json
git mv "Start Workshop.command" "app/Start Workshop.command"
```

- [ ] **Step 2: Update RECAP_DIR default in `app/server.js`**

Bestand `app/server.js` regel 15, oud:

```javascript
const RECAP_DIR = process.env.RECAP_DIR || path.join(__dirname, 'recaps');
```

Vervang door:

```javascript
const RECAP_DIR = process.env.RECAP_DIR || path.join(__dirname, '..', 'data', 'recaps');
```

Reden: `server.js` zit nu één map dieper; de lokale dev-default moet naar `<repo>/data/recaps` wijzen. Productie-env (`RECAP_DIR=/data/recaps`) blijft via env override leidend.

- [ ] **Step 3: Update Caddyfile-pad in `app/Start Workshop.command`**

Bestand `app/Start Workshop.command` regel 78, oud:

```bash
caddy run --config Caddyfile --adapter caddyfile > /tmp/ceda-caddy.log 2>&1 &
```

Vervang door:

```bash
caddy run --config ../docker/Caddyfile --adapter caddyfile > /tmp/ceda-caddy.log 2>&1 &
```

Reden: het script blijft via `cd "$(dirname "$0")"` in `app/` werken; Caddyfile zit straks in `docker/`.

- [ ] **Step 4: Verifieer dat de app vanuit `app/` draait**

```bash
rm -rf node_modules
cd app && npm install
mkdir -p ../data/recaps
npm start &
sleep 2
curl -s http://localhost:3000/healthz
kill %1
cd ..
```

Verwacht: `{"ok":true,...}` en in de server-output `[recap] storage OK at <pad>/data/recaps`.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor: verhuis applicatiecode naar app/

server.js, ceda-workshop.html, package.json, package-lock.json en
Start Workshop.command verhuisd naar app/. RECAP_DIR-default wijst
nu naar ../data/recaps (productie blijft via env op /data/recaps).
Start Workshop.command verwijst naar ../docker/Caddyfile."
```

---

## Task 3: Verhuis deployment-bestanden naar `docker/`

**Files:**
- Create directory: `docker/`
- Move: `Dockerfile`, `entrypoint.sh`, `fly.toml`, `Caddyfile`, `start-caddy.sh` → `docker/`
- Modify: `docker/Dockerfile` (COPY-paden)
- Modify: `docker/fly.toml` (dockerfile-veld + comment-block)

- [ ] **Step 1: Maak `docker/` aan en verplaats bestanden met `git mv`**

```bash
mkdir -p docker
git mv Dockerfile docker/Dockerfile
git mv entrypoint.sh docker/entrypoint.sh
git mv fly.toml docker/fly.toml
git mv Caddyfile docker/Caddyfile
git mv start-caddy.sh docker/start-caddy.sh
```

- [ ] **Step 2: Update COPY-paden in `docker/Dockerfile`**

Bestand `docker/Dockerfile` regels 9, 12, 13 — oud:

```dockerfile
COPY --chown=node:node package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --chown=node:node server.js ceda-workshop.html ./
COPY entrypoint.sh /entrypoint.sh
```

Vervang door:

```dockerfile
COPY --chown=node:node app/package.json app/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --chown=node:node app/server.js app/ceda-workshop.html ./
COPY docker/entrypoint.sh /entrypoint.sh
```

Reden: build-context wordt voortaan repo-root; paden zijn relatief daaraan.

- [ ] **Step 3: Update dockerfile-veld in `docker/fly.toml`**

Bestand `docker/fly.toml` regel 22, oud:

```toml
[build]
  dockerfile = "Dockerfile"
```

Vervang door:

```toml
[build]
  dockerfile = "docker/Dockerfile"
```

Reden: `fly deploy --config docker/fly.toml` draait vanaf repo-root; het pad is relatief aan de werkende map.

- [ ] **Step 4: Update deploy-instructies in comment-block bovenaan `docker/fly.toml`**

Bestand `docker/fly.toml` regels 2-8 — oud:

```toml
# Setup eenmalig (`fly launch` is interactief — accepteer de app-naam en
# regio uit dit bestand of overschrijf naar wens):
#   1. fly auth login
#   2. fly launch --copy-config --no-deploy        # neemt deze fly.toml over
#   3. fly volumes create recaps --region ams --size 1   # 1 GB persistent
#   4. fly deploy
# Daarna: nieuwe builds via `fly deploy`.
```

Vervang door:

```toml
# Setup eenmalig (`fly launch` is interactief — accepteer de app-naam en
# regio uit dit bestand of overschrijf naar wens). Draai alle commando's
# vanaf de repo-root:
#   1. fly auth login
#   2. fly launch --copy-config --no-deploy --config docker/fly.toml
#   3. fly volumes create recaps --region ams --size 1 --config docker/fly.toml
#   4. fly deploy --config docker/fly.toml
# Daarna: nieuwe builds via `fly deploy --config docker/fly.toml`.
```

- [ ] **Step 5: Verifieer dat `docker build` slaagt**

```bash
docker build -f docker/Dockerfile -t ceda-test .
```

Verwacht: image build slaagt zonder fouten. Als Docker niet aanwezig is op de dev-machine: sla deze stap over en noteer dat in de commit-body; CI of de eigenaar verifieert later.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor: verhuis deployment-artefacten naar docker/

Dockerfile, entrypoint.sh, fly.toml, Caddyfile en start-caddy.sh
verhuisd naar docker/. Dockerfile COPY-paden bijgewerkt naar
app/...; fly.toml dockerfile-veld naar docker/Dockerfile.
Deploy voortaan: fly deploy --config docker/fly.toml vanaf root."
```

---

## Task 4: Verhuis lokale data naar `data/` + update `.gitignore`

**Files:**
- Create directory: `data/`
- Move (lokaal, niet getrackt): `recaps/` → `data/recaps/`
- Modify: `.gitignore`

- [ ] **Step 1: Verplaats de lokale `recaps/`-map naar `data/recaps/`**

```bash
mkdir -p data
if [ -d recaps ]; then mv recaps data/recaps; fi
mkdir -p data/recaps
```

Reden: `recaps/` is gitignored, dus geen `git mv`. We borgen alleen dat lokale bestanden niet verloren gaan.

- [ ] **Step 2: Update `.gitignore`**

Bestand `.gitignore` regel 7 — oud:

```
recaps/
```

Vervang door:

```
data/recaps/
```

Volledige nieuwe `.gitignore`:

```
node_modules/
npm-debug.log*
.DS_Store
.env
.env.local
*.log
data/recaps/
```

`node_modules/` blijft globaal en vangt `app/node_modules/` automatisch.

- [ ] **Step 3: Verifieer dat `data/recaps/` gitignored is**

```bash
touch data/recaps/.probe
git status --porcelain data/recaps/
rm data/recaps/.probe
```

Verwacht: lege output (bestand zit onder de ignore).

- [ ] **Step 4: Commit**

```bash
git add .gitignore
git commit -m "refactor: data/recaps/ pad voor lokale recap-opslag

recaps/ verhuisd naar data/recaps/; .gitignore bijgewerkt.
Productie-mount op /data ongewijzigd."
```

---

## Task 5: Verplaats `README-caddy.md` naar `docs/`

**Files:**
- Move: `README-caddy.md` → `docs/README-caddy.md`

- [ ] **Step 1: Verplaats met `git mv`**

```bash
git mv README-caddy.md docs/README-caddy.md
```

- [ ] **Step 2: Commit**

```bash
git add -A
git commit -m "docs: verplaats README-caddy.md naar docs/"
```

---

## Task 6: Update `.dockerignore`

**Files:**
- Modify: `.dockerignore`

- [ ] **Step 1: Vervang volledige inhoud van `.dockerignore`**

Oude inhoud (regels 1-17):

```
.git
.gitignore
.dockerignore
Dockerfile
fly.toml
node_modules
npm-debug.log*
.DS_Store
.env
.env.local
*.log
recaps
README*.md
CLAUDE.md
Caddyfile
start-caddy.sh
Start Workshop.command
```

Vervang volledig door:

```
.git
.gitignore
.dockerignore
docker/Dockerfile
docker/fly.toml
docker/Caddyfile
docker/start-caddy.sh
app/node_modules
node_modules
npm-debug.log*
.DS_Store
.env
.env.local
*.log
data
README*.md
INSTRUCTIONS.md
CLAUDE.md
docs
app/Start Workshop.command
```

Reden: build-context = repo-root. We sluiten `data` (lokale recaps), `docs`, alle markdown en de macOS-launcher uit van de image. **Belangrijk:** `docker/entrypoint.sh` staat bewust **niet** op de ignore-list — die wordt via `COPY docker/entrypoint.sh /entrypoint.sh` in de image binnengehaald, en `.dockerignore` excludeert bestanden volledig uit de build-context (ook voor expliciete `COPY`). De rest van `docker/` is wel veilig te ignoren.

- [ ] **Step 2: Verifieer met een dry-run build**

```bash
docker build -f docker/Dockerfile -t ceda-test . 2>&1 | tail -20
```

Verwacht: succesvolle build. Als Docker niet aanwezig is, sla deze stap over.

- [ ] **Step 3: Commit**

```bash
git add .dockerignore
git commit -m "build: update .dockerignore voor nieuwe mapstructuur"
```

---

## Task 7: Update `README.md`

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Vervang Snelstart- en Handmatig-secties**

Bestand `README.md` regels 6-29 — oud:

```markdown
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
```

Vervang door:

```markdown
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
```

- [ ] **Step 2: Update Architectuur-tabel**

Bestand `README.md` regels 31-38 — oud:

```markdown
| Component | Rol |
|---|---|
| `server.js` | Express + WebSocket-relay. Serveert `ceda-workshop.html`, broadcast berichten binnen sessiecode. |
| `ceda-workshop.html` | Frontend (single-file). Verbindt via `ws://host/ws?room=<CODE>`. |
| `Caddyfile` | Optionele HTTPS-frontend met security-headers, reverse-proxied naar Node. |
| `Start Workshop.command` | macOS-launcher. Doet `npm install`, start beide servers, opent browser. |
```

Vervang door:

```markdown
| Component | Rol |
|---|---|
| `app/server.js` | Express + WebSocket-relay. Serveert `ceda-workshop.html`, broadcast berichten binnen sessiecode. |
| `app/ceda-workshop.html` | Frontend (single-file). Verbindt via `ws://host/ws?room=<CODE>`. |
| `docker/Caddyfile` | Optionele HTTPS-frontend met security-headers, reverse-proxied naar Node. |
| `app/Start Workshop.command` | macOS-launcher. Doet `npm install`, start beide servers, opent browser. |
```

- [ ] **Step 3: Update privacy-noot over `RECAP_DIR`**

Bestand `README.md` regels 57-61 — oud:

```markdown
- **Eindoogst** wordt alleen centraal opgeslagen als een deelnemer in de recap-fase
  expliciet op *Oogst opslaan voor analyse* klikt. Files belanden in `RECAP_DIR`
  (default `./recaps`) als `<roomCode>/<userId>.json`. De UI zelf legt deze
```

Vervang door:

```markdown
- **Eindoogst** wordt alleen centraal opgeslagen als een deelnemer in de recap-fase
  expliciet op *Oogst opslaan voor analyse* klikt. Files belanden in `RECAP_DIR`
  (default lokaal: `./data/recaps`, productie: `/data/recaps`) als
  `<roomCode>/<userId>.json`. De UI zelf legt deze
```

- [ ] **Step 4: Update Productie-deployment-sectie**

Bestand `README.md` regels 102-112 — oud:

```markdown
### Fly.io (aanbevolen, regio Amsterdam)

    ```
    fly auth login
    fly launch --copy-config --no-deploy
    fly volumes create recaps --region ams --size 1
    fly deploy
    ```

`fly.toml` mount het volume op `/data`; de server schrijft naar `/data/recaps`.
```

Vervang door:

```markdown
### Fly.io (aanbevolen, regio Amsterdam)

    ```
    fly auth login
    fly launch --copy-config --no-deploy --config docker/fly.toml
    fly volumes create recaps --region ams --size 1 --config docker/fly.toml
    fly deploy --config docker/fly.toml
    ```

`docker/fly.toml` mount het volume op `/data`; de server schrijft naar `/data/recaps`.
```

- [ ] **Step 5: Update verwijzing naar `README-caddy.md`**

Bestand `README.md` regel 121 — oud:

```markdown
Zie `README-caddy.md` voor uitgebreide HTTPS-instructies.
```

Vervang door:

```markdown
Zie `docs/README-caddy.md` voor uitgebreide HTTPS-instructies.
```

- [ ] **Step 6: Update verwijzing naar `Caddyfile` in VPS-stappen**

Bestand `README.md` regel 116 — oud:

```markdown
1. Vervang in `Caddyfile` `localhost:8443` door je domein.
```

Vervang door:

```markdown
1. Vervang in `docker/Caddyfile` `localhost:8443` door je domein.
```

- [ ] **Step 7: Commit**

```bash
git add README.md
git commit -m "docs: README bijgewerkt voor nieuwe mapstructuur"
```

---

## Task 8: Schrijf `INSTRUCTIONS.md`

**Files:**
- Create: `INSTRUCTIONS.md`

- [ ] **Step 1: Maak `INSTRUCTIONS.md` aan**

Volledige inhoud:

```markdown
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

Alle commando's vanaf repo-root:

```
fly deploy --config docker/fly.toml
```

Eerste keer setup:

```
fly auth login
fly launch --copy-config --no-deploy --config docker/fly.toml
fly volumes create recaps --region ams --size 1 --config docker/fly.toml
fly deploy --config docker/fly.toml
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
```

- [ ] **Step 2: Commit**

```bash
git add INSTRUCTIONS.md
git commit -m "docs: voeg INSTRUCTIONS.md toe als praktische quickstart"
```

---

## Task 9: Update `CLAUDE.md`

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update `## Commands`-blok**

Bestand `CLAUDE.md` regels 7-12 — oud:

```markdown
```
npm install
npm start             # node server.js  (PORT=3000, HOST=0.0.0.0)
npm run dev           # node --watch server.js
caddy run             # optional HTTPS frontend on :8443 → proxies to :3000
```
```

Vervang door:

```markdown
```
cd app && npm install
cd app && npm start             # node server.js  (PORT=3000, HOST=0.0.0.0)
cd app && npm run dev           # node --watch server.js
caddy run --config docker/Caddyfile   # optional HTTPS frontend on :8443 → proxies to :3000
```
```

- [ ] **Step 2: Update opmerking over storage-pad**

Bestand `CLAUDE.md` regel 14 — oud:

```markdown
No lint, no test, no build step — the frontend ships as-is. Inspect a running server via `GET /healthz` and `GET /api/stats`. Opt-in central harvest at `POST /api/recap` (stores `<RECAP_DIR>/<room>/<userId>.json`).
```

Vervang door:

```markdown
No lint, no test, no build step — the frontend ships as-is. Inspect a running server via `GET /healthz` and `GET /api/stats`. Opt-in central harvest at `POST /api/recap` (stores `<RECAP_DIR>/<room>/<userId>.json`; default lokaal `./data/recaps/`, productie `/data/recaps`).
```

- [ ] **Step 3: Update productie-deploy-zin**

Bestand `CLAUDE.md` regel 18 — oud:

```markdown
Production deploy: `Dockerfile` + `fly.toml` target Fly.io regio `ams` with a `recaps` volume mounted at `/data`.
```

Vervang door:

```markdown
Production deploy: `docker/Dockerfile` + `docker/fly.toml` target Fly.io regio `ams` with a `recaps` volume mounted at `/data`. Build vanaf repo-root: `docker build -f docker/Dockerfile .`; deploy: `fly deploy --config docker/fly.toml`.
```

- [ ] **Step 4: Update Architecture-introsectie**

Bestand `CLAUDE.md` regels 22-24 — oud:

```markdown
## Architecture

A **two-file app**: `server.js` + `ceda-workshop.html`. No framework, no bundler, no database. Most changes touch both files — treat them as a pair.
```

Vervang door:

```markdown
## Architecture

A **two-file app** in `app/`: `server.js` + `ceda-workshop.html`. No framework, no bundler, no database. Most changes touch both files — treat them as a pair.

Repo-layout:
- `app/` — applicatiecode (server + frontend + npm-manifest + macOS launcher)
- `docker/` — Dockerfile, entrypoint, fly.toml, Caddyfile
- `docs/` — documentatie en sessieverslagen
- `data/` — lokale recap-opslag (gitignored)
```

- [ ] **Step 5: Update CSP-rule-of-thumb**

Bestand `CLAUDE.md` regel 50 — oud:

```markdown
- CSP lives in **both** `server.js` and `Caddyfile` — change it in both, since either may serve the page.
```

Vervang door:

```markdown
- CSP lives in **both** `app/server.js` and `docker/Caddyfile` — change it in both, since either may serve the page.
```

- [ ] **Step 6: Update Start Workshop.command-reference**

Bestand `CLAUDE.md` regel 55 — oud:

```markdown
- `Start Workshop.command` is the macOS double-click launcher end-users actually use; edit carefully.
```

Vervang door:

```markdown
- `app/Start Workshop.command` is the macOS double-click launcher end-users actually use; edit carefully.
```

- [ ] **Step 7: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: CLAUDE.md bijgewerkt voor nieuwe mapstructuur"
```

---

## Task 10: Eindverificatie

**Files:** geen wijzigingen, alleen verificatie.

- [ ] **Step 1: Verifieer dat de app vanuit `app/` start**

```bash
cd app && npm install
npm start &
sleep 2
curl -s http://localhost:3000/healthz
kill %1
cd ..
```

Verwacht: `{"ok":true,...}` en in de server-banner `[recap] storage OK at <pad>/data/recaps`.

- [ ] **Step 2: Verifieer dat de recap-flow naar `data/recaps/` schrijft**

```bash
cd app && npm start &
sleep 2
curl -s -X POST http://localhost:3000/api/recap \
  -H "Content-Type: application/json" \
  -d '{"roomCode":"TEST","userId":"u_probe","state":{"foo":"bar"}}'
kill %1
cd ..
ls data/recaps/TEST/
rm -rf data/recaps/TEST
```

Verwacht: `u_probe.json` in `data/recaps/TEST/`.

- [ ] **Step 3: Verifieer dat `docker build` slaagt**

```bash
docker build -f docker/Dockerfile -t ceda-test .
```

Verwacht: succesvolle build. Sla over als Docker niet beschikbaar is.

- [ ] **Step 4: Verifieer geen achterblijvende verwijzingen**

```bash
grep -rn --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=data \
  -E '(^|[^a-z/])\./server\.js|(^|[^a-z/])\./ceda-workshop\.html|(^|[^a-z/])\./recaps|(^|[^a-z/])\./Dockerfile|(^|[^a-z/])\./fly\.toml|(^|[^a-z/])\./Caddyfile' .
```

Verwacht: óf lege output, óf alleen treffers binnen comment-blokken/historische context die niet als pad worden gebruikt. Bekijk elke treffer kritisch.

- [ ] **Step 5: Verifieer eindstructuur**

```bash
ls -la
ls app/
ls docker/
ls docs/
ls data/
```

Verwacht:
- Root: `README.md`, `INSTRUCTIONS.md`, `CLAUDE.md`, `.gitignore`, `.dockerignore`, `.claude/`, `app/`, `docker/`, `docs/`, `data/`, `node_modules/` (mag, gitignored)
- `app/`: `server.js`, `ceda-workshop.html`, `package.json`, `package-lock.json`, `Start Workshop.command`, eventueel `node_modules/`
- `docker/`: `Dockerfile`, `entrypoint.sh`, `fly.toml`, `Caddyfile`, `start-caddy.sh`
- `docs/`: `sessions/`, `superpowers/`, `README-caddy.md`
- `data/`: `recaps/`

- [ ] **Step 6: Geen commit nodig** — alleen verificatie. Als alles klopt: klaar.

---

## Notities voor de uitvoerder

- **Volgorde is bewust.** Task 2 verandert pad-defaults in `server.js`; Task 3 verandert COPY-paden in de Dockerfile die naar `app/`-locaties wijzen. Omdraaien breekt tijdelijk de build.
- **`git mv` overal.** Niet `cp + rm` — dan verlies je history.
- **Geen `npm install` in root.** Na Task 2 is er geen `package.json` meer in de root. Als je `node_modules/` in root tegenkomt vóór Task 4: laat staan, gitignore vangt 'm op; je kunt 'm later opruimen met `rm -rf node_modules`.
- **Docker-stappen optioneel.** Als de dev-machine geen Docker heeft, sla die verificaties over en noteer dat in de commit-body. De Dockerfile-wijzigingen zijn statisch en goed inspecteerbaar.
- **Production-deploy is een aparte actie.** Het plan eindigt zonder `fly deploy` — dat is een keuze van de eigenaar, niet onderdeel van deze refactor.
