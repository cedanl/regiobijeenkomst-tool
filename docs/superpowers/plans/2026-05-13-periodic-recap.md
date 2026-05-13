# Periodieke recap-save Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tussentijds en stil de state van alle deelnemers in één samengevoegd bestand per kamer opslaan, met behoud van leesbaarheid van legacy per-user-files.

**Architecture:** Elke client POST't z'n eigen state via debounce (5s) + heartbeat (60s) naar `/api/recap`. Server doet read-modify-write op `<RECAP_DIR>/<ROOM>/state.json` via een per-room Promise-chain mutex; atomair `*.tmp` + `rename`. Eindknop verdwijnt; korte consent-regel in de header informeert deelnemers. Spec: `docs/superpowers/specs/2026-05-13-periodic-recap-design.md`.

**Tech Stack:** Node 18+, Express, vanilla JS frontend. Geen test-framework — verificatie via `curl` + browser smoke-tests, conform `CLAUDE.md`.

---

## Pre-flight

Voor je begint: lees `docs/superpowers/specs/2026-05-13-periodic-recap-design.md` en `app/server.js` helemaal door. `app/ceda-workshop.html` regels rond `saveState`, `renderRecap`, en de header-render zijn de relevante secties (~3900 regels totaal, zoek via grep).

```bash
grep -n "function saveState\|function renderRecap\|Oogst opslaan\|state.roomCode" app/ceda-workshop.html | head -40
```

Hou een dev-server draaiend tijdens implementatie:

```bash
cd app && npm install   # eenmalig
cd app && npm run dev   # node --watch — restart automatisch bij wijzigingen
```

---

### Task 1: Per-room mutex helper

**Files:**
- Modify: `app/server.js` (helper toevoegen vlak voor `app.post('/api/recap', ...)` rond regel 99)

- [ ] **Step 1: Voeg de mutex-helper toe**

Plek: in `app/server.js`, direct boven de bestaande `app.post('/api/recap', ...)`-handler.

```js
// Per-room write serialization. Each /api/recap call chains itself behind
// the previous write for the same room, so read-modify-write on
// state.json never races. Different rooms run in parallel.
const roomLocks = new Map(); // roomCode → Promise (most recent write chain)

function withRoomLock(room, fn) {
  const prev = roomLocks.get(room) || Promise.resolve();
  const next = prev.catch(() => {}).then(fn);
  roomLocks.set(room, next);
  next.finally(() => {
    if (roomLocks.get(room) === next) roomLocks.delete(room);
  });
  return next;
}
```

- [ ] **Step 2: Syntax-check**

```bash
node --check app/server.js
```

Verwacht: exit 0, geen output.

- [ ] **Step 3: Commit**

```bash
git add app/server.js
git commit -m "feat(server): per-room mutex helper voor recap-writes"
```

---

### Task 2: `/api/recap` herschrijven naar read-modify-write op state.json

**Files:**
- Modify: `app/server.js` (vervang body van bestaande `app.post('/api/recap', ...)`-handler)

- [ ] **Step 1: Vervang de handler**

Huidige handler schrijft `<ROOM>/<userId>.json`. We schrijven nu `<ROOM>/state.json` als merged bestand. Vervang het hele blok beginnend met `app.post('/api/recap', express.json(...), async (req, res) => {` en eindigend op de bijbehorende `});` (~regels 104-136) door:

```js
app.post('/api/recap', express.json({ limit: '512kb' }), async (req, res) => {
  if (!recapStorageOk) {
    return res.status(503).json({ ok: false, error: 'storage unavailable' });
  }
  const body = req.body;
  if (!body || typeof body !== 'object') {
    return res.status(400).json({ ok: false, error: 'invalid body' });
  }
  const room = String(body.roomCode || '').trim().toUpperCase();
  const userId = String(body.userId || '').trim();
  if (!ROOM_CODE_RE.test(room)) {
    return res.status(400).json({ ok: false, error: 'invalid roomCode' });
  }
  if (!USER_ID_RE.test(userId)) {
    return res.status(400).json({ ok: false, error: 'invalid userId' });
  }

  try {
    const savedAt = await withRoomLock(room, async () => {
      const dir = path.join(RECAP_DIR, room);
      const file = path.join(dir, 'state.json');
      await fs.mkdir(dir, { recursive: true });

      let merged;
      try {
        const raw = await fs.readFile(file, 'utf8');
        merged = JSON.parse(raw);
        if (!merged || typeof merged !== 'object' || !merged.participants) {
          throw new Error('malformed state.json');
        }
      } catch (err) {
        if (err.code !== 'ENOENT' && !(err instanceof SyntaxError) && err.message !== 'malformed state.json') {
          throw err;
        }
        merged = {
          roomCode: room,
          createdAt: new Date().toISOString(),
          participants: {}
        };
      }

      const now = new Date().toISOString();
      merged.updatedAt = now;
      merged.participants[userId] = { savedAt: now, state: body };

      const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
      await fs.writeFile(tmp, JSON.stringify(merged, null, 2), 'utf8');
      await fs.rename(tmp, file);
      return now;
    });
    res.json({ ok: true, savedAt });
  } catch (err) {
    console.error('[recap] save failed', {
      room, userId, code: err.code, message: err.message
    });
    res.status(500).json({ ok: false, error: 'storage failure' });
  }
});
```

Let op: het bestaande comment-blok boven de handler (regels 99-103) hoort bij het oude per-user-model. Vervang het door:

```js
// Periodic central harvest. Each participant POSTs their full state from
// the workshop (debounced + heartbeat from the client). The server merges
// per-userId into RECAP_DIR/<room>/state.json under a per-room mutex.
// Write is staged via *.tmp + rename so a crash mid-write never replaces
// the previous good save with a truncated one.
```

- [ ] **Step 2: Syntax-check**

```bash
node --check app/server.js
```

Verwacht: exit 0.

- [ ] **Step 3: Start dev-server en doe twee opeenvolgende POSTs**

In een tweede terminal:

```bash
curl -s -X POST http://localhost:3000/api/recap \
  -H 'Content-Type: application/json' \
  -d '{"roomCode":"TEST123","userId":"u_alice","userName":"Alice","insights":["a"]}'

curl -s -X POST http://localhost:3000/api/recap \
  -H 'Content-Type: application/json' \
  -d '{"roomCode":"TEST123","userId":"u_bob","userName":"Bob","insights":["b"]}'

cat data/recaps/TEST123/state.json | python3 -m json.tool
```

Verwacht: beide responses `{"ok":true,"savedAt":"..."}`. Het JSON-bestand bevat `roomCode: "TEST123"`, beide `createdAt` en `updatedAt`, en in `participants` zowel `u_alice` als `u_bob` met de juiste `userName`.

- [ ] **Step 4: Test parallelle writes (mutex sanity)**

```bash
for i in 1 2 3 4 5; do
  curl -s -X POST http://localhost:3000/api/recap \
    -H 'Content-Type: application/json' \
    -d "{\"roomCode\":\"TEST123\",\"userId\":\"u_p$i\",\"insights\":[\"$i\"]}" &
done
wait
python3 -c "import json; d=json.load(open('data/recaps/TEST123/state.json')); print(sorted(d['participants'].keys()))"
```

Verwacht: alle vijf `u_p1` t/m `u_p5` aanwezig in de output naast `u_alice` en `u_bob`. Geen verloren writes.

- [ ] **Step 5: Test foutpad — invalid roomCode**

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3000/api/recap \
  -H 'Content-Type: application/json' \
  -d '{"roomCode":"bad lowercase","userId":"u_x"}'
```

Verwacht: `400`.

- [ ] **Step 6: Opruimen test-data**

```bash
rm -rf data/recaps/TEST123
```

- [ ] **Step 7: Commit**

```bash
git add app/server.js
git commit -m "feat(server): /api/recap merget naar één state.json per kamer"
```

---

### Task 3: `/admin/recaps` toont state.json primair + legacy groep

**Files:**
- Modify: `app/server.js` (handler `app.get('/admin/recaps', ...)` rond regels 163-243)

- [ ] **Step 1: Lees de huidige handler door**

```bash
sed -n '163,243p' app/server.js
```

Doel: per room nu twee groepen tonen — `state.json` (primair, één regel met `updatedAt` + aantal deelnemers + downloadlink) en eventuele resterende `<userId>.json`-files onder een aparte subkop *"Legacy per-deelnemer-saves"*. Beide downloadbaar via de bestaande `/admin/recaps/:room/:file`-route.

- [ ] **Step 2: Vervang de handler**

Vervang het hele `app.get('/admin/recaps', requireAdmin, ...)`-blok door:

```js
app.get('/admin/recaps', requireAdmin, async (req, res) => {
  let roomDirs = [];
  try {
    roomDirs = (await fs.readdir(RECAP_DIR, { withFileTypes: true }))
      .filter(d => d.isDirectory() && ROOM_CODE_RE.test(d.name))
      .map(d => d.name)
      .sort();
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }

  const sections = [];
  for (const room of roomDirs) {
    const dir = path.join(RECAP_DIR, room);
    let files;
    try {
      files = await fs.readdir(dir);
    } catch { continue; }

    // Primair: state.json (merged room file)
    let primary = null;
    if (files.includes('state.json')) {
      const stat = await fs.stat(path.join(dir, 'state.json')).catch(() => null);
      if (stat) {
        let updatedAt = null;
        let participantCount = 0;
        try {
          const parsed = JSON.parse(await fs.readFile(path.join(dir, 'state.json'), 'utf8'));
          updatedAt = parsed.updatedAt;
          participantCount = Object.keys(parsed.participants || {}).length;
        } catch {}
        primary = { size: stat.size, mtime: stat.mtime, updatedAt, participantCount };
      }
    }

    // Legacy: oude per-user files (<userId>.json, niet state.json)
    const legacyFiles = files.filter(f => f.endsWith('.json') && f !== 'state.json');
    const legacy = [];
    for (const f of legacyFiles) {
      const stat = await fs.stat(path.join(dir, f)).catch(() => null);
      if (!stat) continue;
      let saved = null;
      let userName = null;
      try {
        const parsed = JSON.parse(await fs.readFile(path.join(dir, f), 'utf8'));
        saved = parsed.savedAt;
        userName = parsed.state?.userName;
      } catch {}
      legacy.push({ file: f, size: stat.size, mtime: stat.mtime, saved, userName });
    }
    legacy.sort((a, b) => (b.mtime > a.mtime ? 1 : -1));

    if (primary || legacy.length) {
      sections.push({ room, primary, legacy });
    }
  }

  const html = `<!doctype html>
<html lang="nl"><head>
<meta charset="utf-8">
<title>Recaps · CEDA Regiobijeenkomst</title>
<style>
  :root { color-scheme: light; }
  body { font: 15px/1.5 -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 960px; margin: 32px auto; padding: 0 24px; color: #1a1a1a; }
  h1 { font-size: 22px; margin: 0 0 8px; }
  .lede { color: #666; margin: 0 0 32px; }
  .room { border: 1px solid #ddd; border-radius: 8px; padding: 16px 20px; margin-bottom: 16px; background: #fafafa; }
  .room h2 { margin: 0 0 12px; font-size: 16px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: 1px; }
  .room .meta { color: #777; font-size: 13px; margin-left: 8px; font-family: -apple-system, sans-serif; letter-spacing: 0; }
  .primary { padding: 8px 0; border-bottom: 1px solid #eee; margin-bottom: 12px; }
  .primary a { font-weight: 600; }
  .legacy-label { color: #888; font-size: 12px; text-transform: uppercase; letter-spacing: .5px; margin: 8px 0 4px; font-weight: 600; }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid #eee; font-size: 14px; }
  th { color: #666; font-weight: 600; font-size: 12px; text-transform: uppercase; letter-spacing: .5px; }
  a { color: #0a58ca; text-decoration: none; }
  a:hover { text-decoration: underline; }
  .empty { color: #888; font-style: italic; padding: 24px; text-align: center; background: #fafafa; border-radius: 8px; }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
</style>
</head><body>
<h1>Recaps · CEDA Regiobijeenkomst</h1>
<p class="lede">Per bijeenkomst (sessiecode) één samengevoegd bestand met alle deelnemers. Oudere bijeenkomsten kunnen nog per-deelnemer-bestanden bevatten — die staan onder "legacy".</p>
${sections.length === 0
  ? `<p class="empty">Nog geen recaps opgeslagen.</p>`
  : sections.map(s => `
<section class="room">
  <h2>${escapeHtml(s.room)} ${s.primary ? `<span class="meta">${s.primary.participantCount} deelnemer${s.primary.participantCount === 1 ? '' : 's'}</span>` : ''}</h2>
  ${s.primary ? `
  <div class="primary">
    <a href="/admin/recaps/${encodeURIComponent(s.room)}/state.json"><code>state.json</code></a>
    <span class="meta">bijgewerkt ${escapeHtml(s.primary.updatedAt ? new Date(s.primary.updatedAt).toLocaleString('nl-NL') : '—')} · ${(s.primary.size / 1024).toFixed(1)} KB</span>
  </div>` : ''}
  ${s.legacy.length ? `
  <div class="legacy-label">Legacy per-deelnemer-saves</div>
  <table>
    <thead><tr><th>Deelnemer</th><th>Opgeslagen</th><th>Grootte</th><th>Bestand</th></tr></thead>
    <tbody>
    ${s.legacy.map(i => `<tr>
      <td>${escapeHtml(i.userName || '—')}</td>
      <td>${escapeHtml(i.saved ? new Date(i.saved).toLocaleString('nl-NL') : '—')}</td>
      <td>${(i.size / 1024).toFixed(1)} KB</td>
      <td><a href="/admin/recaps/${encodeURIComponent(s.room)}/${encodeURIComponent(i.file)}"><code>${escapeHtml(i.file)}</code></a></td>
    </tr>`).join('')}
    </tbody>
  </table>` : ''}
</section>`).join('')}
</body></html>`;
  res.set('Content-Type', 'text/html; charset=utf-8');
  res.set('Cache-Control', 'no-store');
  res.send(html);
});
```

- [ ] **Step 3: Pas de `/admin/recaps/:room/:file`-validatie aan zodat `state.json` ook door de regex valt**

Bekijk de regex op `app.get('/admin/recaps/:room/:file', ...)` (regel ~249):

```js
if (!/^[A-Za-z0-9_-]{3,40}\.json$/.test(file)) return res.status(400).send('invalid file');
```

`state.json` is 5 alfanumerieke chars + `.json` — die matcht al (`{3,40}`). Geen wijziging nodig. Verifieer met:

```bash
node -e 'console.log(/^[A-Za-z0-9_-]{3,40}\.json$/.test("state.json"))'
```

Verwacht: `true`.

- [ ] **Step 4: Syntax-check**

```bash
node --check app/server.js
```

Verwacht: exit 0.

- [ ] **Step 5: Browser-smoke-test**

Maak test-data en bekijk de admin-UI:

```bash
# Test-data klaarzetten (server moet draaien)
curl -s -X POST http://localhost:3000/api/recap \
  -H 'Content-Type: application/json' \
  -d '{"roomCode":"ADMINT1","userId":"u_alice","userName":"Alice","insights":["a"]}'
curl -s -X POST http://localhost:3000/api/recap \
  -H 'Content-Type: application/json' \
  -d '{"roomCode":"ADMINT1","userId":"u_bob","userName":"Bob","insights":["b"]}'

# Legacy file voor dezelfde room (om groepering te tonen):
mkdir -p data/recaps/ADMINT1
echo '{"savedAt":"2025-01-01T00:00:00.000Z","state":{"userName":"OldUser"}}' \
  > data/recaps/ADMINT1/u_legacy.json

# Tweede room met alleen legacy:
mkdir -p data/recaps/LEGACY1
echo '{"savedAt":"2025-01-01T00:00:00.000Z","state":{"userName":"Solo"}}' \
  > data/recaps/LEGACY1/u_solo.json
```

Zet `ADMIN_PASSWORD` als env-var voor de server (herstart dev-server zodat hij hem oppikt):

```bash
# In de terminal waar npm run dev draait — stop met Ctrl+C en herstart:
ADMIN_PASSWORD=test npm run dev
```

Open `http://localhost:3000/admin/recaps` in de browser, log in met `ceda` / `test`. Verwacht:
- `ADMINT1`: kopregel met `2 deelnemers`, `state.json`-downloadlink met `bijgewerkt …`, daaronder *"Legacy per-deelnemer-saves"* met `u_legacy.json`.
- `LEGACY1`: kopregel zonder deelnemer-aantal, geen `state.json`-link, alleen *"Legacy per-deelnemer-saves"* met `u_solo.json`.

Klik op `state.json` → JSON-download van het merged bestand. Klik op `u_legacy.json` → JSON van het oude per-user-bestand.

- [ ] **Step 6: Opruimen test-data**

```bash
rm -rf data/recaps/ADMINT1 data/recaps/LEGACY1
```

- [ ] **Step 7: Commit**

```bash
git add app/server.js
git commit -m "feat(admin): toon state.json per kamer + groepeer legacy per-user-files"
```

---

### Task 4: Frontend — auto-save plumbing

**Files:**
- Modify: `app/ceda-workshop.html` (script-blok; functies toevoegen naast `saveState`)

- [ ] **Step 1: Lokaliseer `saveState`**

```bash
grep -n "function saveState\|saveState()" app/ceda-workshop.html | head -10
```

Noteer de regel waar `function saveState()` begint.

- [ ] **Step 2: Voeg auto-save-helpers toe**

Direct ná de body van `function saveState()` (of een logische plek in dezelfde groep helpers), voeg toe:

```js
// Tussentijdse auto-save naar /api/recap.
// Debounce 5s na elke saveState() + verzekerings-heartbeat elke 60s.
// Stil bij fouten — volgende tick probeert opnieuw.
let __autoSaveTimer = null;
let __autoSaveHeartbeat = null;

function scheduleAutoSave() {
  if (!state.roomCode || !state.userId) return;
  clearTimeout(__autoSaveTimer);
  __autoSaveTimer = setTimeout(flushRecap, 5000);
}

async function flushRecap() {
  if (!state.roomCode || !state.userId) return;
  try {
    await fetch('/api/recap', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(state)
    });
  } catch { /* stil */ }
}

function startAutoSaveHeartbeat() {
  if (__autoSaveHeartbeat) return;
  __autoSaveHeartbeat = setInterval(flushRecap, 60000);
}
```

- [ ] **Step 3: Roep `scheduleAutoSave()` aan binnen `saveState()`**

Voeg de aanroep toe als laatste regel binnen `function saveState() { ... }` (na de `localStorage.setItem`-call):

```js
function saveState() {
  // ... bestaande code ...
  scheduleAutoSave();
}
```

- [ ] **Step 4: Start de heartbeat zodra join compleet is**

Zoek de plek waar `state.roomCode` en `state.userId` voor het eerst beide gevuld worden (na de join-flow / `joinSessionRoom`). Voeg daar `startAutoSaveHeartbeat();` toe.

```bash
grep -n "joinSessionRoom\|state.roomCode =\|state.userId =" app/ceda-workshop.html | head -10
```

Plek voor de aanroep: direct ná `saveState()` in de join-finalisatie, zodat de heartbeat alleen start als de gebruiker daadwerkelijk in een sessie zit.

- [ ] **Step 5: Browser-smoke-test (één tab)**

Server draait (`cd app && npm run dev`). Open `http://localhost:3000`, vul naam + sessiecode `WS001` in, voeg een insight toe.

In een tweede terminal:

```bash
sleep 7 && cat data/recaps/WS001/state.json | python3 -m json.tool
```

Verwacht: na ~5s staat er een `state.json` met `participants.<jouwUserId>.state` met de toegevoegde insight. `updatedAt` recent.

Bekijk in de DevTools Network-tab dat `/api/recap` ~5s na elke wijziging gefired wordt en `200 OK` retourneert.

- [ ] **Step 6: Browser-smoke-test (twee tabs, parallel)**

Open een tweede tab met dezelfde sessiecode `WS001`, andere naam. Voeg ook een insight toe.

```bash
sleep 7 && python3 -c "
import json
d = json.load(open('data/recaps/WS001/state.json'))
print('participants:', list(d['participants'].keys()))
for uid, p in d['participants'].items():
    print(uid, '→', p['state'].get('userName'), '/', p['state'].get('insights'))
"
```

Verwacht: beide userIds in `participants`, ieder met eigen `userName` en `insights`. Geen verloren writes.

- [ ] **Step 7: Opruimen test-data**

```bash
rm -rf data/recaps/WS001
```

- [ ] **Step 8: Commit**

```bash
git add app/ceda-workshop.html
git commit -m "feat(frontend): tussentijdse auto-save (debounce 5s + heartbeat 60s)"
```

---

### Task 5: Frontend — eindknop + uitlegkader verwijderen

**Files:**
- Modify: `app/ceda-workshop.html` (functie `renderRecap`)

- [ ] **Step 1: Lokaliseer de eindknop**

```bash
grep -n "Oogst opslaan voor analyse\|function renderRecap" app/ceda-workshop.html
```

- [ ] **Step 2: Verwijder de knop + omliggend uitlegkader**

Binnen `function renderRecap()`: verwijder het HTML-blok dat:
1. De *"Oogst opslaan voor analyse"*-knop bevat,
2. Het uitlegkader (consent-tekst) eromheen,
3. Eventuele bijbehorende event-handlers verderop in `renderRecap` (klik → POST naar `/api/recap`).

De overige inhoud (samenvatting van de workshop voor de deelnemer zelf) blijft. De recap-stage toont voortaan alleen die samenvatting.

- [ ] **Step 3: Browser-smoke-test**

Herlaad de app, doorloop alle stages tot `renderRecap`. Verwacht:
- Geen knop *"Oogst opslaan voor analyse"* meer zichtbaar.
- Geen kader met consent-uitleg op de recap-pagina.
- Inhoudelijke samenvatting blijft zichtbaar.

- [ ] **Step 4: Commit**

```bash
git add app/ceda-workshop.html
git commit -m "feat(frontend): verwijder eindknop 'Oogst opslaan voor analyse'"
```

---

### Task 6: Frontend — consent-regel naast sessiecode in header

**Files:**
- Modify: `app/ceda-workshop.html` (header-render waar de sessiecode-badge staat)

- [ ] **Step 1: Lokaliseer de sessiecode-badge in de header**

```bash
grep -n "roomCode\|sessiecode\|room-badge\|workshop-header" app/ceda-workshop.html | head -20
```

Zoek de plek waar `state.roomCode` als label/badge in de header gerenderd wordt.

- [ ] **Step 2: Voeg de consent-zin toe**

Direct naast (of onder) de roomcode-badge, alleen tonen als `state.roomCode` truthy is:

```html
<span class="recap-consent" title="Tussentijdse opslag naar Fly voor analyse.">
  Deze sessie wordt voor analyse opgeslagen.
</span>
```

En in de bijbehorende `<style>`-sectie (zoek `.room-badge` of vergelijkbaar voor naburige stijlen):

```css
.recap-consent {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.75); /* of passend bij de header-achtergrond */
  margin-left: 12px;
  letter-spacing: 0.2px;
}
```

(Pas de kleur aan op de huidige header-styling — kies een tint die leesbaar maar onopdringerig is naast de bestaande badge.)

- [ ] **Step 3: Browser-smoke-test**

Herlaad. Voor join: alleen naam/sessiecode-formulier zichtbaar, geen consent-zin nodig. Na join: in de header, naast de sessiecode, staat *"Deze sessie wordt voor analyse opgeslagen."* in een klein, dempend lettertype.

- [ ] **Step 4: Commit**

```bash
git add app/ceda-workshop.html
git commit -m "feat(frontend): consent-regel naast sessiecode in header"
```

---

### Task 7: End-to-end smoke-test (twee tabs, disconnect-scenario)

**Files:** geen wijzigingen — verificatie van het hele pad.

- [ ] **Step 1: Reset test-data**

```bash
rm -rf data/recaps/E2ETEST*
```

- [ ] **Step 2: Twee browser-tabs in sessie `E2ETEST`**

- Tab 1: join met naam `Alice`, voeg twee insights toe, vote ergens op.
- Tab 2: join met naam `Bob`, voeg één insight toe.

Wacht ~10s na de laatste wijziging.

- [ ] **Step 3: Verifieer merged state**

```bash
python3 -c "
import json
d = json.load(open('data/recaps/E2ETEST/state.json'))
print('roomCode:', d['roomCode'])
print('updatedAt:', d['updatedAt'])
for uid, p in d['participants'].items():
    print(uid, '→', p['state'].get('userName'), 'savedAt', p['savedAt'])
"
```

Verwacht: beide deelnemers aanwezig, recente `savedAt`'s, één gedeeld `roomCode`.

- [ ] **Step 4: Disconnect-scenario**

Sluit Tab 1 (Alice) zonder een eindknop of iets dergelijks. Vlak voor het sluiten: voeg in Tab 1 nog een derde insight toe, sluit tab binnen 2s (vóór de 5s-debounce klaar is) en wacht dan ~65s.

Verwacht na 65s:
- Alice's state in `state.json` bevat ofwel de laatste insight (als de debounce nog gefired heeft vóór close — fetch-buffer of pagehide is best-effort), ofwel de voorlaatste state.
- Bob blijft volledig zichtbaar.

*Opmerking voor de uitvoerder:* `fetch` op `pagehide`/`beforeunload` is niet gegarandeerd; deze test laat zien hoe goed de "halverwege afhaken"-belofte in de praktijk uitpakt. Geen actie nodig als de derde insight ontbreekt — dat is een bekende beperking van debounce. De heartbeat van Bob blijft 't kamer-bestand wel updaten.

- [ ] **Step 5: Opruimen test-data**

```bash
rm -rf data/recaps/E2ETEST
```

- [ ] **Step 6: Commit (geen wijzigingen, alleen merker)**

Niet committen — dit is een smoke-test, geen code-verandering. Als er een bug naar boven komt: fix in de relevante task en herhaal de smoke-test.

---

### Task 8: Documentatie bijwerken

**Files:**
- Modify: `README.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: README — sectie *"Beveiliging & privacy"* en *"Centrale oogst voor analyse"***

Open `README.md`. Vervang in *"Beveiliging & privacy"* het bullet over consent door:

```markdown
- **Live-verkeer** wordt niet gelogd of opgeslagen — alleen doorgegeven.
- **Sessie-state** wordt tijdens de bijeenkomst periodiek (debounce 5s + heartbeat 60s) door elke deelnemer naar Fly geschreven. De server merget dit per kamer tot één bestand `RECAP_DIR/<ROOM>/state.json` met daarin alle deelnemers. Per deelnemer wordt de laatste state bewaard; nieuwe writes overschrijven. Een korte consent-regel in de header van de app informeert deelnemers dat de sessie voor analyse wordt opgeslagen.
```

Vervang de hele sectie *"Centrale oogst voor analyse"* (vanaf de kop tot aan *"Resultaten bekijken na afloop"*) door:

```markdown
## Centrale oogst voor analyse

Tijdens de workshop schrijft elke deelnemer zijn state periodiek naar
`POST /api/recap`. De server houdt per kamer één samengevoegd bestand bij:

Layout op disk:
\`\`\`
data/recaps/
  <ROOMCODE>/
    state.json   # ← alle deelnemers van deze bijeenkomst, samengevoegd
\`\`\`

`state.json` heeft de vorm:

\`\`\`json
{
  "roomCode": "WS2026",
  "createdAt": "2026-05-13T10:02:11.000Z",
  "updatedAt": "2026-05-13T10:47:33.412Z",
  "participants": {
    "u_abc123": { "savedAt": "...", "state": { /* deelnemer-state */ } }
  }
}
\`\`\`

Oude bijeenkomsten kunnen nog `<ROOMCODE>/<userId>.json`-files bevatten
(legacy per-deelnemer-model). Die blijven leesbaar en downloadbaar via
de admin-UI onder *"Legacy per-deelnemer-saves"*.
```

(Let op: in de hierboven getoonde code zijn de drievoudige backticks geëscaped met een backslash zodat ze in dit plan zichtbaar blijven — schrijf ze in `README.md` als gewone drievoudige backticks.)

- [ ] **Step 2: CLAUDE.md — file-layout regel**

Open `CLAUDE.md`. Vervang de regel:

```
No lint, no automated tests, no build step — ... Opt-in central harvest at `POST /api/recap` (stores `<RECAP_DIR>/<room>/<userId>.json`; default lokaal `./data/recaps/`, productie `/data/recaps`). The recap directory is created on first write — no need to pre-`mkdir`.
```

door:

```
No lint, no automated tests, no build step — the frontend ships as-is. Verify changes by running the server and exercising the workshop flow in a browser; after path or structure changes a UI smoke-test (host + join from a second tab, sync an op) is the only reliable check. Inspect a running server via `GET /healthz` and `GET /api/stats`. Periodic central harvest at `POST /api/recap`: each client POSTs its own state (debounce 5s + heartbeat 60s); the server merges per `userId` into `<RECAP_DIR>/<room>/state.json` under a per-room mutex (default lokaal `./data/recaps/`, productie `/data/recaps`). Legacy `<room>/<userId>.json`-files from before this change blijven leesbaar via de admin-UI. The recap directory is created on first write — no need to pre-`mkdir`.
```

- [ ] **Step 3: Commit**

```bash
git add README.md CLAUDE.md
git commit -m "docs: README en CLAUDE.md bijgewerkt voor periodieke recap-save"
```

---

### Task 9: Sessieverslag

**Files:**
- Create: `docs/sessions/2026-05-13-periodic-recap.md`

- [ ] **Step 1: Schrijf het verslag**

```bash
cat > docs/sessions/2026-05-13-periodic-recap.md <<'EOF'
# 2026-05-13 — Periodieke recap-save

## Wat
Auto-save tijdens de bijeenkomst in plaats van alleen een eindknop. Alle deelnemers komen samen in één `<ROOM>/state.json` op Fly. Eindknop *"Oogst opslaan voor analyse"* verdwenen; korte consent-regel in de header.

## Waarom
Deelnemers die halverwege afhaken lieten niets achter. Voor analyse op kamerniveau was joinen op `roomCode` over losse user-files onhandig.

## Hoe
- **Frontend:** debounce 5s na elke `saveState()` + verzekerings-heartbeat 60s. Stil bij fouten.
- **Server:** read-modify-write op `<RECAP_DIR>/<ROOM>/state.json` onder per-room Promise-chain mutex. Atomair `*.tmp` + `rename`.
- **Admin-UI:** per kamer één regel met `updatedAt` + deelnemer-aantal; legacy per-user-files gegroepeerd onder eigen subkop.

## Spec
`docs/superpowers/specs/2026-05-13-periodic-recap-design.md`

## Niet aangeraakt
- WS-relay (blijft dom).
- Bestaande legacy per-user-files (blijven op disk, blijven downloadbaar).
- CSP, healthz, stats.

## Verificatie
- Twee browser-tabs in dezelfde sessie → één `state.json` met beide deelnemers.
- Parallelle POSTs via `curl` (5 tegelijk) → mutex serialiseert, geen verloren writes.
- Admin-UI toont primary `state.json` + legacy-groep zoals ontworpen.
EOF
```

- [ ] **Step 2: Commit**

```bash
git add docs/sessions/2026-05-13-periodic-recap.md
git commit -m "docs(session): sessieverslag periodieke recap-save"
```

---

## Self-review checklist

**Spec coverage:** Elke beslissing uit de spec heeft een task:
- Consent stil + header-zin → Task 6
- Trigger debounce + heartbeat → Task 4
- Per-room mutex + read-modify-write → Tasks 1+2
- Bestandslayout `<ROOM>/state.json` → Task 2
- Eindknop weg → Task 5
- Admin-UI met legacy-groep → Task 3
- README/CLAUDE.md updates → Task 8
- Sessieverslag → Task 9

**Placeholders:** geen TBD/TODO; alle code-blokken zijn compleet.

**Type-consistentie:**
- `scheduleAutoSave`, `flushRecap`, `startAutoSaveHeartbeat` consistent gebruikt in Tasks 4.
- `withRoomLock`, `roomLocks` consistent tussen Tasks 1 en 2.
- `participants[userId] = { savedAt, state }` consistent tussen Task 2 (write) en Task 3 (read).

Geen gaten gevonden.
