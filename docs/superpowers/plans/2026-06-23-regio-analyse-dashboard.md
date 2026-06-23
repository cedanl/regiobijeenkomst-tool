# Regio-analyse & presentatie-dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Een admin-only analyse-pagina die de vier regio-recaps (HRQT/WTEL/PUXD/MDRH) bundelt tot twee visualisaties (inzichten-treemap + use-case-kaarten) plus een AI-gegenereerd, bewerkbaar 1-A4 verslag, met een in-app bewerkbare regio-map.

**Architecture:** Pure aggregatielogica in een nieuw ES-module `app/analyse-lib.mjs` (unit-getest, geen I/O). `app/server.js` voegt de I/O-glue + drie routes toe (`GET /admin/analyse`, `POST /admin/regios`, `POST /admin/verslag`) achter de bestaande `requireAdmin` basic-auth. De pagina `app/analyse.html` krijgt de geaggregeerde data server-side ingespoten als JSON en rendert/filtert client-side. Regio-map staat als `<RECAP_DIR>/regios.json` op de volume, geseed met vier defaults.

**Tech Stack:** Node ≥18, Express, `@anthropic-ai/sdk` (Claude `claude-opus-4-8`), pure HTML/CSS/SVG (geen charting-lib — past binnen de bestaande strikte CSP), Playwright voor tests.

**Spec:** `docs/superpowers/specs/2026-06-23-regio-analyse-dashboard-design.md`

**Belangrijke vastgestelde feiten (uit de codebase):**
- `state.json` = `{ roomCode, createdAt, updatedAt, participants: { <userId>: { savedAt, state: <clientState> } } }`.
- clientState bevat o.a. `insights[]` = `{ id, type: 'kans'|'uitdaging', text, role: 'praktijk'|'aansturing'|'ondersteuning', authorId, authorName, ts, votes: { <userId>: count } }`.
- clientState bevat `cases{}` = `{ <insightId>: { doel, actoren, resultaat, ai_data, _ts_<veld>: ms } }`.
- `ROOM_CODE_RE = /^[A-Z0-9]{3,16}$/`. `requireAdmin` geeft 503 zonder `ADMIN_PASSWORD`, anders basic-auth (`ADMIN_USER` default `ceda`).
- Bestaande CSP staat `script-src 'self' 'unsafe-inline'` en `connect-src 'self'` toe → de inline-script-pagina + same-origin `fetch` werken **zonder CSP-wijziging**. `docker/Caddyfile` hoeft niet aangepast.

**Prerequisite (eenmalig, lokaal):** `cd app && npm install && npx playwright install chromium`.

**Testcommando's:** vanuit `app/`:
- `npx playwright test tests/analyse-lib.spec.mjs` (pure unit-tests, geen browser)
- `npx playwright test tests/analyse.spec.mjs` (server + browser)
- `npm test` draait alle tests (inclusief de bestaande recap-regressie).

---

## File Structure

- **Create `app/analyse-lib.mjs`** — pure functies: `DEFAULT_REGIOS`, `validateRegios`, `canonicalizeRoom`, `aggregate`, `buildVerslagPrompt`, `buildFallbackVerslag`. Geen fs, geen express. Eén verantwoordelijkheid: data-transformatie. Unit-getest.
- **Create `app/analyse.html`** — de dashboard-pagina (filters, viz1, viz2, verslag, regio-beheer-dialog, print-CSS). Eén ingebedde `<script>` zoals de hoofdpagina.
- **Modify `app/server.js`** — importeert uit `analyse-lib.mjs`; voegt I/O-helpers (`readRegios`/`writeRegios`/`readAllRooms`) + drie routes + een link vanaf `/admin/recaps` toe.
- **Modify `app/package.json`** — dependency `@anthropic-ai/sdk`.
- **Create `app/tests/analyse-lib.spec.mjs`** — unit-tests voor `analyse-lib.mjs`.
- **Create `app/tests/analyse.spec.mjs`** — server-/browser-tests (spawn server tegen tmp `RECAP_DIR`, basic-auth).
- **Modify `CLAUDE.md` / `README.md` / `docs/sessions/`** — env var + sessieverslag (laatste taak).

---

## Task 1: Voeg `@anthropic-ai/sdk` toe

**Files:**
- Modify: `app/package.json`

- [ ] **Step 1: Voeg de dependency toe en installeer**

Run (vanuit repo-root):

```bash
cd app && npm install @anthropic-ai/sdk
```

Dit zet `@anthropic-ai/sdk` in `dependencies` van `app/package.json` en werkt `package-lock.json` bij.

- [ ] **Step 2: Verifieer dat de SDK importeerbaar is**

Run:

```bash
cd app && node -e "import('@anthropic-ai/sdk').then(m => console.log('ok', typeof m.default))"
```

Expected: `ok function`

- [ ] **Step 3: Commit**

```bash
git add app/package.json app/package-lock.json
git commit -m "build(analyse): voeg @anthropic-ai/sdk toe voor verslag-generatie" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: `analyse-lib.mjs` — `DEFAULT_REGIOS` + `validateRegios`

**Files:**
- Create: `app/analyse-lib.mjs`
- Test: `app/tests/analyse-lib.spec.mjs`

- [ ] **Step 1: Schrijf de falende test**

Create `app/tests/analyse-lib.spec.mjs`:

```js
import { test, expect } from '@playwright/test';
import { DEFAULT_REGIOS, validateRegios } from '../analyse-lib.mjs';

test('DEFAULT_REGIOS bevat de vier sessiecodes in vaste volgorde', () => {
  expect(DEFAULT_REGIOS).toEqual([
    { code: 'HRQT', label: 'Arnhem' },
    { code: 'WTEL', label: 'Breda' },
    { code: 'PUXD', label: 'Utrecht' },
    { code: 'MDRH', label: 'Zwolle' },
  ]);
});

test('validateRegios normaliseert en accepteert geldige invoer', () => {
  const r = validateRegios([{ code: 'hrqt', label: ' Arnhem ' }, { code: 'WTEL', label: 'Breda' }]);
  expect(r.ok).toBe(true);
  expect(r.value).toEqual([{ code: 'HRQT', label: 'Arnhem' }, { code: 'WTEL', label: 'Breda' }]);
});

test('validateRegios upsert: dubbele code overschrijft label maar behoudt positie', () => {
  const r = validateRegios([{ code: 'HRQT', label: 'Arnhem' }, { code: 'WTEL', label: 'Breda' }, { code: 'HRQT', label: 'Arnhem-Noord' }]);
  expect(r.ok).toBe(true);
  expect(r.value).toEqual([{ code: 'HRQT', label: 'Arnhem-Noord' }, { code: 'WTEL', label: 'Breda' }]);
});

test('validateRegios weigert ongeldige code en leeg label', () => {
  expect(validateRegios('nope').ok).toBe(false);
  expect(validateRegios([{ code: 'ab', label: 'x' }]).ok).toBe(false);
  expect(validateRegios([{ code: 'HRQT', label: '' }]).ok).toBe(false);
});
```

- [ ] **Step 2: Run test om te bevestigen dat hij faalt**

Run: `cd app && npx playwright test tests/analyse-lib.spec.mjs`
Expected: FAIL — `Cannot find module '../analyse-lib.mjs'`.

- [ ] **Step 3: Schrijf de minimale implementatie**

Create `app/analyse-lib.mjs`:

```js
// Pure aggregatie- en validatielogica voor het regio-analyse-dashboard.
// Geen fs, geen express — alles in/uit als plain objects, zodat dit
// los unit-getest kan worden.

const CODE_RE = /^[A-Z0-9]{3,16}$/;

export const DEFAULT_REGIOS = [
  { code: 'HRQT', label: 'Arnhem' },
  { code: 'WTEL', label: 'Breda' },
  { code: 'PUXD', label: 'Utrecht' },
  { code: 'MDRH', label: 'Zwolle' },
];

// Valideert + normaliseert een regio-map. Retourneert {ok, value} of {ok:false, error}.
// Dubbele code = upsert (laatste label wint), oorspronkelijke positie blijft.
export function validateRegios(input) {
  if (!Array.isArray(input)) return { ok: false, error: 'verwacht een array' };
  const map = new Map();
  for (const item of input) {
    if (!item || typeof item !== 'object') return { ok: false, error: 'ongeldig item' };
    const code = String(item.code || '').trim().toUpperCase();
    const label = String(item.label || '').trim();
    if (!CODE_RE.test(code)) return { ok: false, error: `ongeldige code: ${code || '(leeg)'}` };
    if (!label) return { ok: false, error: `label ontbreekt voor ${code}` };
    if (label.length > 60) return { ok: false, error: `label te lang voor ${code}` };
    map.set(code, label); // Map.set behoudt invoegvolgorde, overschrijft waarde
  }
  return { ok: true, value: [...map.entries()].map(([code, label]) => ({ code, label })) };
}
```

- [ ] **Step 4: Run test om te bevestigen dat hij slaagt**

Run: `cd app && npx playwright test tests/analyse-lib.spec.mjs`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add app/analyse-lib.mjs app/tests/analyse-lib.spec.mjs
git commit -m "feat(analyse): regio-map defaults + validatie" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: `analyse-lib.mjs` — `canonicalizeRoom`

**Files:**
- Modify: `app/analyse-lib.mjs`
- Test: `app/tests/analyse-lib.spec.mjs`

- [ ] **Step 1: Schrijf de falende test**

Voeg toe aan `app/tests/analyse-lib.spec.mjs` (importregel bovenin uitbreiden + nieuwe tests onderaan):

Vervang de bestaande importregel door:

```js
import { DEFAULT_REGIOS, validateRegios, canonicalizeRoom } from '../analyse-lib.mjs';
```

Voeg onderaan toe:

```js
test('canonicalizeRoom unioniseert inzichten en neemt per stemmer de hoogste stem', () => {
  const state = { participants: {
    u1: { state: { insights: [{ id: 'i1', type: 'kans', text: 'A', role: 'praktijk', votes: { u1: 3 } }], cases: { i1: { doel: 'oud', _ts_doel: 100 } } } },
    u2: { state: { insights: [
      { id: 'i1', type: 'kans', text: 'A', role: 'praktijk', votes: { u1: 2, u2: 4 } },
      { id: 'i2', type: 'uitdaging', text: 'B', role: 'aansturing', votes: { u2: 1 } },
    ], cases: { i1: { doel: 'nieuw', _ts_doel: 200 } } } },
  } };
  const { insights, cases } = canonicalizeRoom(state);
  const i1 = insights.find(i => i.id === 'i1');
  expect(i1.votes).toEqual({ u1: 3, u2: 4 });        // max per stemmer
  expect(insights.map(i => i.id).sort()).toEqual(['i1', 'i2']);
  expect(cases.get('i1').doel).toBe('nieuw');         // nieuwste _ts wint
});

test('canonicalizeRoom is bestand tegen ontbrekende velden', () => {
  expect(canonicalizeRoom({}).insights).toEqual([]);
  expect(canonicalizeRoom({ participants: { u: { state: {} } } }).cases.size).toBe(0);
});
```

- [ ] **Step 2: Run test om te bevestigen dat hij faalt**

Run: `cd app && npx playwright test tests/analyse-lib.spec.mjs`
Expected: FAIL — `canonicalizeRoom is not a function` / `not exported`.

- [ ] **Step 3: Schrijf de implementatie**

Voeg toe aan `app/analyse-lib.mjs`:

```js
// Recency van een case = hoogste _ts_<veld>-waarde.
function caseTimestamp(c) {
  let max = 0;
  for (const [k, v] of Object.entries(c)) {
    if (k.startsWith('_ts') && typeof v === 'number' && v > max) max = v;
  }
  return max;
}

// Voegt alle deelnemer-snapshots van één kamer samen tot één canonieke set.
// insights: union op id, votes per stemmer gemerged op max.
// cases: union op insightId, bij conflict de nieuwste (_ts).
export function canonicalizeRoom(state) {
  const participants = (state && state.participants) || {};
  const insightsById = new Map();
  const casesById = new Map();
  for (const p of Object.values(participants)) {
    const cs = (p && p.state) || {};
    for (const ins of (cs.insights || [])) {
      if (!ins || !ins.id) continue;
      const votes = (ins.votes && typeof ins.votes === 'object') ? ins.votes : {};
      const existing = insightsById.get(ins.id);
      if (!existing) {
        insightsById.set(ins.id, { ...ins, votes: { ...votes } });
      } else {
        for (const [uid, count] of Object.entries(votes)) {
          existing.votes[uid] = Math.max(existing.votes[uid] || 0, count || 0);
        }
      }
    }
    for (const [insightId, c] of Object.entries(cs.cases || {})) {
      if (!c || typeof c !== 'object') continue;
      const existing = casesById.get(insightId);
      if (!existing || caseTimestamp(c) > caseTimestamp(existing)) casesById.set(insightId, c);
    }
  }
  return { insights: [...insightsById.values()], cases: casesById };
}
```

- [ ] **Step 4: Run test om te bevestigen dat hij slaagt**

Run: `cd app && npx playwright test tests/analyse-lib.spec.mjs`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add app/analyse-lib.mjs app/tests/analyse-lib.spec.mjs
git commit -m "feat(analyse): canonicaliseer kamerstaat (union-merge per kamer)" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: `analyse-lib.mjs` — `aggregate`

**Files:**
- Modify: `app/analyse-lib.mjs`
- Test: `app/tests/analyse-lib.spec.mjs`

- [ ] **Step 1: Schrijf de falende test**

Werk de importregel bij naar:

```js
import { DEFAULT_REGIOS, validateRegios, canonicalizeRoom, aggregate } from '../analyse-lib.mjs';
```

Voeg onderaan toe:

```js
function fixtureRooms() {
  return [
    { code: 'HRQT', state: { participants: {
      u1: { state: { insights: [{ id: 'i1', type: 'kans', text: 'Studievoortgang', role: 'praktijk', votes: { u1: 3 } }], cases: { i1: { doel: 'Eerder ingrijpen', actoren: 'SLB', resultaat: 'minder uitval', ai_data: 'LMS', _ts_doel: 100 } } } },
      u2: { state: { insights: [
        { id: 'i1', type: 'kans', text: 'Studievoortgang', role: 'praktijk', votes: { u1: 2, u2: 4 } },
        { id: 'i2', type: 'uitdaging', text: 'AVG-drempels', role: 'aansturing', votes: { u2: 1 } },
      ], cases: {} } },
    } } },
    { code: 'WTEL', state: { participants: {
      u3: { state: { insights: [{ id: 'i3', type: 'kans', text: 'Datageletterdheid', role: 'praktijk', votes: { u3: 5 } }], cases: { i3: { doel: 'Docenten data laten duiden', ai_data: 'training', _ts_doel: 50 } } } },
    } } },
    { code: 'TEST1', state: { participants: { u9: { state: { insights: [{ id: 'x1', type: 'kans', text: 'NIET MEETELLEN', role: 'praktijk', votes: { u9: 9 } }], cases: {} } } } } },
  ];
}

test('aggregate poolt alleen gemapte kamers en sorteert op stemmen', () => {
  const { kpis, insights, useCases } = aggregate(fixtureRooms(), DEFAULT_REGIOS);
  // TEST1 zit niet in DEFAULT_REGIOS → uitgesloten (curatie)
  expect(insights.find(i => i.tekst === 'NIET MEETELLEN')).toBeUndefined();
  expect(insights.map(i => i.id)).toEqual(['i1', 'i3', 'i2']); // 7, 5, 1
  const i1 = insights[0];
  expect(i1.totaalStemmen).toBe(7);
  expect(i1.aantalStemmers).toBe(2);
  expect(i1.regio).toBe('Arnhem');
  expect(i1.regioCode).toBe('HRQT');
  expect(kpis).toEqual({ regios: 2, inzichten: 3, stemmen: 13, deelnemers: 3 });
});

test('aggregate maakt use cases met inhoud en sorteert op stemmen van het inzicht', () => {
  const { useCases } = aggregate(fixtureRooms(), DEFAULT_REGIOS);
  expect(useCases.map(u => u.insightId)).toEqual(['i1', 'i3']); // i2 heeft geen case
  expect(useCases[0].doel).toBe('Eerder ingrijpen');
  expect(useCases[0].totaalStemmen).toBe(7);
  expect(useCases[0].rol).toBe('praktijk');
  expect(useCases[0].regio).toBe('Arnhem');
});
```

- [ ] **Step 2: Run test om te bevestigen dat hij faalt**

Run: `cd app && npx playwright test tests/analyse-lib.spec.mjs`
Expected: FAIL — `aggregate is not a function`.

- [ ] **Step 3: Schrijf de implementatie**

Voeg toe aan `app/analyse-lib.mjs`:

```js
const CASE_FIELDS = ['doel', 'actoren', 'resultaat', 'ai_data'];

function voteTotal(votes) {
  if (!votes || typeof votes !== 'object') return 0;
  return Object.values(votes).reduce((s, n) => s + (n || 0), 0);
}
function voterCount(votes) {
  if (!votes || typeof votes !== 'object') return 0;
  return Object.keys(votes).filter(uid => (votes[uid] || 0) > 0).length;
}
function normType(t) { return t === 'uitdaging' ? 'uitdaging' : 'kans'; }

// rooms: [{ code, state }]. regios: [{ code, label }] (volgorde = weergavevolgorde).
// Alleen kamers met een code in regios doen mee (curatie).
export function aggregate(rooms, regios) {
  const order = new Map(regios.map((r, i) => [r.code, { label: r.label, i }]));
  const insights = [];
  const useCases = [];
  let deelnemers = 0;
  const regiosMetData = new Set();

  const mapped = rooms.filter(r => order.has(r.code))
    .sort((a, b) => order.get(a.code).i - order.get(b.code).i);

  for (const room of mapped) {
    const regioLabel = order.get(room.code).label;
    const { insights: roomInsights, cases } = canonicalizeRoom(room.state);
    deelnemers += Object.keys((room.state && room.state.participants) || {}).length;
    if (roomInsights.length || cases.size) regiosMetData.add(room.code);

    const byId = new Map(roomInsights.map(i => [i.id, i]));
    for (const ins of roomInsights) {
      insights.push({
        id: ins.id,
        type: normType(ins.type),
        rol: ins.role || null,
        tekst: ins.text || '',
        regio: regioLabel,
        regioCode: room.code,
        totaalStemmen: voteTotal(ins.votes),
        aantalStemmers: voterCount(ins.votes),
      });
    }
    for (const [insightId, c] of cases) {
      if (!CASE_FIELDS.some(f => String(c[f] || '').trim())) continue; // sla lege cases over
      const ins = byId.get(insightId) || null;
      useCases.push({
        insightId,
        tekst: ins ? (ins.text || '') : '(onbekend inzicht)',
        doel: c.doel || '',
        actoren: c.actoren || '',
        resultaat: c.resultaat || '',
        ai_data: c.ai_data || '',
        type: ins ? normType(ins.type) : null,
        rol: ins ? (ins.role || null) : null,
        regio: regioLabel,
        regioCode: room.code,
        totaalStemmen: ins ? voteTotal(ins.votes) : 0,
      });
    }
  }

  insights.sort((a, b) => b.totaalStemmen - a.totaalStemmen);
  useCases.sort((a, b) => b.totaalStemmen - a.totaalStemmen);

  const kpis = {
    regios: regiosMetData.size,
    inzichten: insights.length,
    stemmen: insights.reduce((s, i) => s + i.totaalStemmen, 0),
    deelnemers,
  };
  return { kpis, insights, useCases };
}
```

- [ ] **Step 4: Run test om te bevestigen dat hij slaagt**

Run: `cd app && npx playwright test tests/analyse-lib.spec.mjs`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add app/analyse-lib.mjs app/tests/analyse-lib.spec.mjs
git commit -m "feat(analyse): aggregeer inzichten + use cases over regio's (curatie + sortering)" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: `analyse-lib.mjs` — `buildVerslagPrompt` + `buildFallbackVerslag`

**Files:**
- Modify: `app/analyse-lib.mjs`
- Test: `app/tests/analyse-lib.spec.mjs`

- [ ] **Step 1: Schrijf de falende test**

Werk de importregel bij naar:

```js
import { DEFAULT_REGIOS, validateRegios, canonicalizeRoom, aggregate, buildVerslagPrompt, buildFallbackVerslag } from '../analyse-lib.mjs';
```

Voeg onderaan toe:

```js
test('buildVerslagPrompt bevat kerncijfers en top-inzicht', () => {
  const data = aggregate(fixtureRooms(), DEFAULT_REGIOS);
  const p = buildVerslagPrompt(data);
  expect(p).toContain('Studievoortgang');
  expect(p).toContain('managementverslag');
  expect(p).toMatch(/3 regio's|2 regio's/);
});

test('buildFallbackVerslag is feitelijk en bevat herkenbare koppen', () => {
  const data = aggregate(fixtureRooms(), DEFAULT_REGIOS);
  const v = buildFallbackVerslag(data);
  expect(v).toContain('behoeften');
  expect(v).toContain('stemmen');
  expect(v).toContain('Studievoortgang');
});
```

- [ ] **Step 2: Run test om te bevestigen dat hij faalt**

Run: `cd app && npx playwright test tests/analyse-lib.spec.mjs`
Expected: FAIL — `buildVerslagPrompt is not a function`.

- [ ] **Step 3: Schrijf de implementatie**

Voeg toe aan `app/analyse-lib.mjs`:

```js
// Bouwt de Nederlandse instructie voor de Claude-API (één messages.create-call).
export function buildVerslagPrompt(data) {
  const { kpis, insights, useCases } = data;
  const lines = [];
  lines.push('Je bent beleidsadviseur. Schrijf een bondig managementverslag van maximaal één A4 in het Nederlands, op basis van onderstaande data uit vier regiobijeenkomsten over datagedreven werken in het onderwijs.');
  lines.push('');
  lines.push('Structuur: (1) korte inleiding/context, (2) de belangrijkste behoeften en patronen, (3) advies over welke 2 à 3 use cases zich het best lenen voor co-creatie en waarom. Lopende tekst met enkele koppen; geen opsomming van alle ruwe data.');
  lines.push('');
  lines.push(`Kerncijfers: ${kpis.regios} regio's, ${kpis.inzichten} inzichten, ${kpis.stemmen} stemmen, ${kpis.deelnemers} deelnemers.`);
  lines.push('');
  lines.push('Inzichten (tekst | type | rol | regio | stemmen):');
  for (const i of insights.slice(0, 30)) lines.push(`- ${i.tekst} | ${i.type} | ${i.rol || '—'} | ${i.regio} | ${i.totaalStemmen}`);
  lines.push('');
  lines.push('Use cases (titel | doel | rol | regio | stemmen):');
  for (const u of useCases.slice(0, 20)) lines.push(`- ${u.tekst} | ${u.doel} | ${u.rol || '—'} | ${u.regio} | ${u.totaalStemmen}`);
  return lines.join('\n');
}

// Getemplate feitelijke samenvatting — gebruikt als er geen API-sleutel is of
// de API-call faalt. Geen narratief, puur de cijfers + top-lijsten.
export function buildFallbackVerslag(data) {
  const { kpis, insights, useCases } = data;
  const topI = insights.slice(0, 8).map(i => `- ${i.tekst} (${i.regio}, ${i.type}, ${i.totaalStemmen} stemmen)`).join('\n');
  const topU = useCases.slice(0, 8).map(u => `- ${u.tekst} — ${u.doel} (${u.regio}, ${u.totaalStemmen} stemmen)`).join('\n');
  return [
    'Samenvatting regio-analyse',
    '',
    `${kpis.regios} regio's · ${kpis.inzichten} inzichten · ${kpis.stemmen} stemmen · ${kpis.deelnemers} deelnemers.`,
    '',
    'Belangrijkste behoeften:',
    topI || '- (geen)',
    '',
    'Use cases (op prioriteit):',
    topU || '- (geen)',
  ].join('\n');
}
```

- [ ] **Step 4: Run test om te bevestigen dat hij slaagt**

Run: `cd app && npx playwright test tests/analyse-lib.spec.mjs`
Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
git add app/analyse-lib.mjs app/tests/analyse-lib.spec.mjs
git commit -m "feat(analyse): verslag-prompt + getemplate fallback-samenvatting" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: `analyse.html` — skeleton (CSS, body, bootstrap, stub-JS)

Maakt de hele pagina-structuur met volledige CSS (scherm + print), alle containers, de bootstrap-injectieplek en de JS-helpers + wiring met **stub render-functies**. Latere taken vervangen één stub per keer. De pagina rendert nog niets zichtbaars, maar geeft geen errors.

**Files:**
- Create: `app/analyse.html`

- [ ] **Step 1: Schrijf het bestand**

Create `app/analyse.html`:

```html
<!doctype html>
<html lang="nl"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Regio-analyse · CEDA Regiobijeenkomst</title>
<style>
  :root { color-scheme: light; --blue:#2563eb; --orange:#ea580c; --ink:#1a1a1a; --muted:#64748b; --line:#e2e8f0; }
  * { box-sizing: border-box; }
  body { font: 15px/1.5 -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: var(--ink); margin: 0; background:#fff; }
  .wrap { max-width: 1100px; margin: 0 auto; padding: 24px; }
  .topbar { display:flex; justify-content:space-between; align-items:center; gap:16px; flex-wrap:wrap; }
  h1 { font-size: 22px; margin: 0; }
  .actions { display:flex; gap:8px; flex-wrap:wrap; }
  button { font: inherit; padding: 7px 12px; border:1px solid var(--line); border-radius:8px; background:#fff; cursor:pointer; }
  button.primary { background: var(--blue); color:#fff; border-color: var(--blue); }
  .filters { display:flex; gap:12px; flex-wrap:wrap; margin: 16px 0 8px; align-items:center; }
  .filters label { font-size:12px; color:var(--muted); display:flex; gap:6px; align-items:center; }
  select { font: inherit; padding:5px 8px; border:1px solid var(--line); border-radius:6px; }
  section { margin: 22px 0; }
  .sec-label { font-size:11px; text-transform:uppercase; letter-spacing:.6px; color:var(--muted); font-weight:700; margin:0 0 10px; }
  .kpis { display:flex; gap:22px; flex-wrap:wrap; }
  .kpi b { font-size:22px; display:block; }
  .kpi span { font-size:12px; color:var(--muted); }
  .legend { font-size:11px; color:var(--muted); display:flex; gap:14px; align-items:center; margin:8px 0; }
  .sw { display:inline-block; width:11px; height:11px; border-radius:3px; vertical-align:-1px; margin-right:4px; }
  .bubbles { display:flex; flex-wrap:wrap; gap:8px; }
  .bub { border-radius:10px; color:#fff; padding:8px 10px; display:flex; flex-direction:column; justify-content:space-between; line-height:1.2; overflow:hidden; }
  .bub small { font-weight:800; font-size:16px; }
  .bub .rg { font-size:9px; opacity:.9; letter-spacing:.5px; text-transform:uppercase; }
  .bub.kans { background: var(--blue); } .bub.uitdaging { background: var(--orange); }
  .cols { display:flex; gap:14px; margin-top:8px; }
  .col { flex:1; background:#fafafa; border:1px solid var(--line); border-radius:8px; padding:10px; min-width:0; }
  .col h5 { margin:0 0 8px; font-size:12px; text-transform:uppercase; letter-spacing:.5px; color:#475569; display:flex; justify-content:space-between; }
  .ci { display:flex; justify-content:space-between; gap:6px; font-size:12px; margin-top:6px; }
  .ci span:first-child { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .cb { height:8px; border-radius:3px; margin-top:2px; }
  .cb.kans { background: var(--blue); } .cb.uitdaging { background: var(--orange); }
  .uc-grid { display:grid; grid-template-columns: repeat(auto-fill, minmax(240px,1fr)); gap:10px; }
  .uc { border:1px solid var(--line); border-radius:10px; padding:10px; position:relative; background:#fff; }
  .uc.starred { border-color:#f59e0b; box-shadow:0 0 0 2px #fef3c7; }
  .uc h4 { margin:0 8px 8px 0; font-size:13px; padding-right:42px; }
  .uc .prio { position:absolute; top:8px; right:8px; background:var(--blue); color:#fff; font-weight:800; font-size:11px; border-radius:999px; padding:2px 8px; }
  .uc .fld { font-size:11px; margin:3px 0; color:#334155; }
  .uc .fld b { color:var(--muted); font-weight:700; text-transform:uppercase; letter-spacing:.3px; font-size:9px; display:block; }
  .uc .meta { margin-top:6px; display:flex; gap:5px; flex-wrap:wrap; align-items:center; }
  .uc .tag { font-size:9px; padding:1px 6px; border-radius:999px; background:#f1f5f9; color:#475569; font-weight:700; }
  .uc .rg { font-size:9px; color:var(--muted); }
  .uc .star { position:absolute; bottom:8px; right:8px; font-size:16px; color:#cbd5e1; cursor:pointer; background:none; border:none; padding:0; line-height:1; }
  .uc.starred .star { color:#f59e0b; }
  #verslag-body { border:1px solid var(--line); border-radius:8px; padding:16px; min-height:120px; white-space:pre-wrap; outline:none; }
  #verslag-body:focus { border-color: var(--blue); }
  .verslag-meta { font-size:11px; color:var(--muted); margin-top:6px; }
  .empty { color:var(--muted); font-style:italic; }
  dialog { border:none; border-radius:12px; padding:0; max-width:560px; width:92vw; box-shadow:0 10px 40px rgba(0,0,0,.2); }
  dialog::backdrop { background: rgba(0,0,0,.35); }
  .dlg-head { padding:16px 20px; border-bottom:1px solid var(--line); display:flex; justify-content:space-between; align-items:center; }
  .dlg-body { padding:16px 20px; max-height:60vh; overflow:auto; }
  .dlg-foot { padding:12px 20px; border-top:1px solid var(--line); display:flex; justify-content:flex-end; gap:8px; }
  .regio-row { display:flex; gap:8px; align-items:center; margin-bottom:8px; }
  .regio-row .code { font-family: ui-monospace, Menlo, monospace; width:90px; }
  .regio-row input.label { flex:1; font: inherit; padding:5px 8px; border:1px solid var(--line); border-radius:6px; }
  .suggest { margin-top:12px; font-size:12px; color:var(--muted); }
  .suggest button { font-size:11px; padding:2px 8px; margin:2px 4px 0 0; }
  @media print {
    .no-print { display:none !important; }
    body { font-size: 11px; }
    .wrap { max-width:none; padding:0; }
    section { margin: 12px 0; page-break-inside: avoid; }
    .uc, .col { break-inside: avoid; }
  }
</style>
</head><body>
<div class="wrap">
  <header class="topbar">
    <h1>Regio-analyse <span style="font-weight:400;color:var(--muted);font-size:14px">· kansen, inzichten &amp; use cases</span></h1>
    <div class="actions no-print">
      <button id="btn-regios">Regio's beheren</button>
      <button id="btn-verslag">Verslag genereren</button>
      <button id="btn-print" class="primary">Opslaan als PDF</button>
    </div>
  </header>

  <div class="filters no-print">
    <label>Regio <select id="f-regio"></select></label>
    <label>Type <select id="f-type"><option value="alle">alle</option><option value="kans">kans</option><option value="uitdaging">uitdaging</option></select></label>
    <label>Rol <select id="f-rol"><option value="alle">alle</option><option value="praktijk">praktijk</option><option value="aansturing">aansturing</option><option value="ondersteuning">ondersteuning</option></select></label>
  </div>

  <section id="kpis"></section>

  <section id="viz1">
    <div class="sec-label">Kansen &amp; inzichten — naar prioriteit</div>
    <div class="legend no-print"><span><span class="sw" style="background:var(--blue)"></span>Kans</span><span><span class="sw" style="background:var(--orange)"></span>Uitdaging</span><span style="margin-left:auto">vlakgrootte = aantal stemmen</span></div>
    <div id="bubbles" class="bubbles"></div>
    <div class="sec-label" style="margin-top:18px">Uitsplitsing per rol</div>
    <div id="cols" class="cols"></div>
  </section>

  <section id="viz2">
    <div class="sec-label">Use cases — kandidaten voor co-creatie</div>
    <div id="uc-grid" class="uc-grid"></div>
  </section>

  <section id="verslag">
    <div class="sec-label">Verslag (1 A4)</div>
    <div id="verslag-body" contenteditable="true"></div>
    <div class="verslag-meta no-print" id="verslag-meta"></div>
  </section>
</div>

<dialog id="regio-dialog">
  <form method="dialog">
    <div class="dlg-head"><strong>Regio's beheren</strong><button value="cancel" aria-label="Sluiten">✕</button></div>
    <div class="dlg-body">
      <div id="regio-rows"></div>
      <button type="button" id="regio-add">+ Regio toevoegen</button>
      <div class="suggest" id="regio-suggest"></div>
    </div>
    <div class="dlg-foot">
      <button value="cancel">Annuleren</button>
      <button type="button" id="regio-save" class="primary">Opslaan</button>
    </div>
  </form>
</dialog>

<script>try { window.__ANALYSE__ = __ANALYSE_JSON__; } catch (e) { window.__ANALYSE__ = null; }</script>
<script>
const A = window.__ANALYSE__ || { regios: [], unmappedRooms: [], kpis: {}, insights: [], useCases: [] };
const filters = { regio: 'alle', type: 'alle', rol: 'alle' };
const SHORTLIST_KEY = 'ceda-analyse-shortlist';
const VERSLAG_KEY = 'ceda-analyse-verslag';

function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])); }
function getShortlist() { try { return new Set(JSON.parse(localStorage.getItem(SHORTLIST_KEY)) || []); } catch { return new Set(); } }
function setShortlist(set) { localStorage.setItem(SHORTLIST_KEY, JSON.stringify([...set])); }
function applyFilters(items) {
  return items.filter(it =>
    (filters.regio === 'alle' || it.regioCode === filters.regio) &&
    (filters.type === 'alle' || it.type === filters.type) &&
    (filters.rol === 'alle' || it.rol === filters.rol));
}

// --- stubs, ingevuld in latere taken ---
function renderKpis() {}
function renderViz1() {}
function renderViz2() {}
function renderRegioDialog() {}
function initRegio() {}
function initVerslag() {}

function render() { renderKpis(); renderViz1(); renderViz2(); }

function initFilters() {
  const sel = document.getElementById('f-regio');
  sel.innerHTML = '<option value="alle">alle</option>' + A.regios.map(r => `<option value="${esc(r.code)}">${esc(r.label)}</option>`).join('');
  sel.addEventListener('change', e => { filters.regio = e.target.value; render(); });
  document.getElementById('f-type').addEventListener('change', e => { filters.type = e.target.value; render(); });
  document.getElementById('f-rol').addEventListener('change', e => { filters.rol = e.target.value; render(); });
}

document.getElementById('btn-print').addEventListener('click', () => window.print());

initFilters();
initRegio();
initVerslag();
render();
</script>
</body></html>
```

- [ ] **Step 2: Verifieer dat het bestand geldig HTML/JS is**

Run: `cd app && node --check analyse.html 2>&1 || echo "node --check werkt niet op HTML — overslaan"`

> `node --check` kan geen HTML parsen; dit is enkel een sanity-stap. De echte verificatie volgt in Task 7 (de route serveert deze pagina en een browser-test leest `window.__ANALYSE__`).

- [ ] **Step 3: Commit**

```bash
git add app/analyse.html
git commit -m "feat(analyse): analyse.html skeleton (layout, CSS, bootstrap, stubs)" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: `server.js` — regios-I/O + `GET /admin/analyse` + link

Voegt de I/O-glue toe (`readRegios`/`writeRegios`/`readAllRooms`), de route die aggregeert en `analyse.html` met ingespoten data serveert, en een link vanaf `/admin/recaps`. Maakt ook het gedeelde test-harnasbestand aan.

**Files:**
- Modify: `app/server.js` (import bovenin; helpers + route na het bestaande `/admin/recaps/:room/:file`-blok rond regel 360; link in de `/admin/recaps`-HTML rond regel 308)
- Create: `app/tests/analyse.spec.mjs`

- [ ] **Step 1: Schrijf de falende test (harnas + eerste tests)**

Create `app/tests/analyse.spec.mjs`:

```js
// Server-/browser-tests voor het analyse-dashboard. Spawnt een verse server
// tegen een tmp RECAP_DIR met vaste fixtures + ADMIN_PASSWORD, en test de
// admin-routes (basic-auth) en de pagina.
//
// LET OP testvolgorde: de curatie-test (unmapped TEST1) draait vóór de
// regio-beheer-test die TEST1 toevoegt. Workers=1 → bestandsvolgorde geldt.

import { test, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_DIR = path.resolve(__dirname, '..');
const ADMIN = { username: 'ceda', password: 'test-admin-pw' };
const authHeader = 'Basic ' + Buffer.from(`${ADMIN.username}:${ADMIN.password}`).toString('base64');

test.use({ httpCredentials: ADMIN });

let server, recapDir, port, base;

function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, () => { const p = srv.address().port; srv.close(() => resolve(p)); });
  });
}
function waitForBoot(child) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('server boot timeout')), 10000);
    const onData = (chunk) => {
      if (chunk.toString().includes('workshop-server gestart')) { clearTimeout(timer); child.stdout.off('data', onData); resolve(); }
    };
    child.stdout.on('data', onData);
    child.once('exit', (code) => { clearTimeout(timer); reject(new Error('server exited prematurely, code=' + code)); });
  });
}
async function writeRoom(code, participants) {
  const dir = path.join(recapDir, code);
  await mkdir(dir, { recursive: true });
  const state = { roomCode: code, createdAt: '2026-06-01T10:00:00+02:00', updatedAt: '2026-06-01T11:00:00+02:00', participants: {} };
  for (const [uid, cs] of Object.entries(participants)) state.participants[uid] = { savedAt: '2026-06-01T11:00:00+02:00', state: cs };
  await writeFile(path.join(dir, 'state.json'), JSON.stringify(state, null, 2));
}

test.beforeAll(async () => {
  recapDir = await mkdtemp(path.join(tmpdir(), 'analyse-test-'));
  await writeRoom('HRQT', {
    u1: { insights: [{ id: 'i1', type: 'kans', text: 'Studievoortgang', role: 'praktijk', votes: { u1: 3 } }], cases: { i1: { doel: 'Eerder ingrijpen', actoren: 'SLB', resultaat: 'minder uitval', ai_data: 'LMS', _ts_doel: 100 } } },
    u2: { insights: [{ id: 'i1', type: 'kans', text: 'Studievoortgang', role: 'praktijk', votes: { u1: 2, u2: 4 } }, { id: 'i2', type: 'uitdaging', text: 'AVG-drempels', role: 'aansturing', votes: { u2: 1 } }], cases: {} },
  });
  await writeRoom('WTEL', {
    u3: { insights: [{ id: 'i3', type: 'kans', text: 'Datageletterdheid', role: 'praktijk', votes: { u3: 5 } }], cases: { i3: { doel: 'Docenten data laten duiden', ai_data: 'training', _ts_doel: 50 } } },
  });
  await writeRoom('TEST1', { u9: { insights: [{ id: 'x1', type: 'kans', text: 'NIET MEETELLEN', role: 'praktijk', votes: { u9: 9 } }], cases: {} } });

  port = await getFreePort();
  base = `http://localhost:${port}`;
  server = spawn('node', ['server.js'], {
    cwd: APP_DIR,
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', RECAP_DIR: recapDir, ADMIN_USER: ADMIN.username, ADMIN_PASSWORD: ADMIN.password },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await waitForBoot(server);
});

test.afterAll(async () => {
  if (server && server.exitCode === null) { server.kill('SIGTERM'); await new Promise(r => server.once('exit', r)); }
  if (recapDir) await rm(recapDir, { recursive: true, force: true });
});

test('GET /admin/analyse vereist auth', async () => {
  const res = await fetch(`${base}/admin/analyse`);            // geen header
  expect(res.status).toBe(401);
});

test('GET /admin/analyse aggregeert en sluit ongemapte kamers uit (curatie)', async ({ page }) => {
  await page.goto(`${base}/admin/analyse`);
  const data = await page.evaluate(() => window.__ANALYSE__);
  expect(data.kpis).toEqual({ regios: 2, inzichten: 3, stemmen: 13, deelnemers: 3 });
  expect(data.insights.map(i => i.id)).toEqual(['i1', 'i3', 'i2']);
  expect(data.insights.find(i => i.tekst === 'NIET MEETELLEN')).toBeUndefined();
  expect(data.unmappedRooms).toEqual(['TEST1']);
  expect(data.regios.map(r => r.code)).toEqual(['HRQT', 'WTEL', 'PUXD', 'MDRH']);
});

test('GET /admin/recaps linkt naar het dashboard', async () => {
  const res = await fetch(`${base}/admin/recaps`, { headers: { authorization: authHeader } });
  const html = await res.text();
  expect(html).toContain('/admin/analyse');
});
```

- [ ] **Step 2: Run test om te bevestigen dat hij faalt**

Run: `cd app && npx playwright test tests/analyse.spec.mjs`
Expected: FAIL — `/admin/analyse` geeft 404 (route bestaat nog niet); `window.__ANALYSE__` is `null`.

- [ ] **Step 3: Voeg de import toe bovenin `server.js`**

Vlak ná `import { fileURLToPath } from 'node:url';` (regel 10), voeg toe:

```js
import { DEFAULT_REGIOS, validateRegios, aggregate } from './analyse-lib.mjs';
```

- [ ] **Step 4: Voeg de I/O-helpers + route toe**

Direct ná het `app.get('/admin/recaps/:room/:file', ...)`-blok (eindigt rond regel 360, vóór `// Default → index`), voeg toe:

```js
// ---- Regio-map (configureerbaar) ----
const REGIOS_FILE = path.join(RECAP_DIR, 'regios.json');

// Leest de regio-map. Ontbreekt het bestand → seed met defaults. Corrupt/leeg
// → defaults (zonder de slechte file te overschrijven). Anders: file is leidend.
async function readRegios() {
  try {
    const parsed = JSON.parse(await fs.readFile(REGIOS_FILE, 'utf8'));
    const v = validateRegios(parsed);
    return (v.ok && v.value.length) ? v.value : DEFAULT_REGIOS;
  } catch (err) {
    if (err.code === 'ENOENT') {
      await writeRegios(DEFAULT_REGIOS).catch(() => {});
      return DEFAULT_REGIOS;
    }
    return DEFAULT_REGIOS;
  }
}

// Atomisch wegschrijven (tmp + rename), net als /api/recap.
async function writeRegios(list) {
  await fs.mkdir(RECAP_DIR, { recursive: true });
  const tmp = path.join(RECAP_DIR, `regios.${process.pid}.${Date.now()}.json.tmp`);
  await fs.writeFile(tmp, JSON.stringify(list, null, 2), 'utf8');
  await fs.rename(tmp, REGIOS_FILE);
}

// Leest alle kamers met een state.json in als { code, state }.
async function readAllRooms() {
  let dirs = [];
  try {
    dirs = (await fs.readdir(RECAP_DIR, { withFileTypes: true }))
      .filter(d => d.isDirectory() && ROOM_CODE_RE.test(d.name))
      .map(d => d.name);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  const out = [];
  for (const code of dirs) {
    try { out.push({ code, state: JSON.parse(await fs.readFile(path.join(RECAP_DIR, code, 'state.json'), 'utf8')) }); }
    catch {}
  }
  return out;
}

app.get('/admin/analyse', requireAdmin, async (req, res) => {
  const regios = await readRegios();
  const rooms = await readAllRooms();
  const data = aggregate(rooms, regios);
  const mapped = new Set(regios.map(r => r.code));
  const unmappedRooms = rooms.map(r => r.code).filter(c => !mapped.has(c)).sort();
  const payload = { regios, unmappedRooms, ...data };
  // < escapen zodat inzicht-tekst geen </script> kan injecteren; functie-vorm
  // van replace zodat $-tekens in de JSON niet als vervangpatroon gelden.
  const json = JSON.stringify(payload).replace(/</g, '\\u003c');
  let html = await fs.readFile(path.join(__dirname, 'analyse.html'), 'utf8');
  html = html.replace('__ANALYSE_JSON__', () => json);
  res.set('Content-Type', 'text/html; charset=utf-8');
  res.set('Cache-Control', 'no-store');
  res.send(html);
});
```

- [ ] **Step 5: Voeg de link toe in de `/admin/recaps`-HTML**

In de bestaande `/admin/recaps`-handler, vervang de lede-regel:

```js
<p class="lede">Per bijeenkomst (sessiecode) één samengevoegd bestand met alle deelnemers. Oudere bijeenkomsten kunnen nog per-deelnemer-bestanden bevatten — die staan onder "legacy".</p>
```

door:

```js
<p class="lede">Per bijeenkomst (sessiecode) één samengevoegd bestand met alle deelnemers. Oudere bijeenkomsten kunnen nog per-deelnemer-bestanden bevatten — die staan onder "legacy". → <a href="/admin/analyse">Naar het analyse-dashboard</a></p>
```

- [ ] **Step 6: Run test om te bevestigen dat hij slaagt**

Run: `cd app && npx playwright test tests/analyse.spec.mjs`
Expected: PASS (4 tests).

- [ ] **Step 7: Commit**

```bash
git add app/server.js app/tests/analyse.spec.mjs
git commit -m "feat(analyse): /admin/analyse route + regios-I/O + link vanaf recaps" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 8: `server.js` — `POST /admin/regios`

**Files:**
- Modify: `app/server.js` (route ná de `GET /admin/analyse`-handler)
- Test: `app/tests/analyse.spec.mjs`

- [ ] **Step 1: Schrijf de falende test**

Voeg onderaan `app/tests/analyse.spec.mjs` toe:

```js
test('POST /admin/regios weigert ongeldige invoer met 400', async () => {
  const res = await fetch(`${base}/admin/regios`, {
    method: 'POST',
    headers: { authorization: authHeader, 'content-type': 'application/json' },
    body: JSON.stringify([{ code: 'ab', label: 'te kort' }]),
  });
  expect(res.status).toBe(400);
  const out = await res.json();
  expect(out.ok).toBe(false);
});

test('POST /admin/regios vereist auth', async () => {
  const res = await fetch(`${base}/admin/regios`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: '[]',
  });
  expect(res.status).toBe(401);
});
```

- [ ] **Step 2: Run test om te bevestigen dat hij faalt**

Run: `cd app && npx playwright test tests/analyse.spec.mjs --grep "POST /admin/regios"`
Expected: FAIL — route geeft 404 i.p.v. 400/401.

- [ ] **Step 3: Voeg de route toe**

Direct ná de `app.get('/admin/analyse', ...)`-handler in `server.js`, voeg toe:

```js
app.post('/admin/regios', requireAdmin, express.json({ limit: '64kb' }), async (req, res) => {
  const v = validateRegios(req.body);
  if (!v.ok) return res.status(400).json({ ok: false, error: v.error });
  try {
    await writeRegios(v.value);
    res.json({ ok: true, regios: v.value });
  } catch (err) {
    console.error('[regios] schrijven faalde', { code: err.code, message: err.message });
    res.status(500).json({ ok: false, error: 'storage failure' });
  }
});
```

- [ ] **Step 4: Run test om te bevestigen dat hij slaagt**

Run: `cd app && npx playwright test tests/analyse.spec.mjs --grep "POST /admin/regios"`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add app/server.js app/tests/analyse.spec.mjs
git commit -m "feat(analyse): POST /admin/regios (valideer + atomisch wegschrijven)" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 9: `analyse.html` — `renderKpis` + `renderViz1` (treemap + rol-kolommen)

**Files:**
- Modify: `app/analyse.html` (vervang twee stub-functies)
- Test: `app/tests/analyse.spec.mjs`

- [ ] **Step 1: Schrijf de falende test**

Voeg onderaan `app/tests/analyse.spec.mjs` toe:

```js
test('viz1 toont KPI-cijfers en het top-inzicht als grootste blok', async ({ page }) => {
  await page.goto(`${base}/admin/analyse`);
  await expect(page.locator('#kpis')).toContainText('inzichten');
  const bubbles = page.locator('#bubbles .bub');
  await expect(bubbles).toHaveCount(3);
  // Top-inzicht (i1, 7 stemmen) staat eerst en is een 'kans' (blauw).
  await expect(bubbles.first()).toContainText('Studievoortgang');
  await expect(bubbles.first()).toHaveClass(/kans/);
  // Rol-kolommen: drie kolommen aanwezig.
  await expect(page.locator('#cols .col')).toHaveCount(3);
});

test('viz1 filtert op type', async ({ page }) => {
  await page.goto(`${base}/admin/analyse`);
  await page.locator('#f-type').selectOption('uitdaging');
  const bubbles = page.locator('#bubbles .bub');
  await expect(bubbles).toHaveCount(1);
  await expect(bubbles.first()).toContainText('AVG-drempels');
});
```

- [ ] **Step 2: Run test om te bevestigen dat hij faalt**

Run: `cd app && npx playwright test tests/analyse.spec.mjs --grep "viz1"`
Expected: FAIL — `#bubbles` is leeg (stubs renderen niets).

- [ ] **Step 3: Vervang de stubs**

In `app/analyse.html`, vervang:

```js
function renderKpis() {}
function renderViz1() {}
```

door:

```js
function renderKpis() {
  const k = A.kpis || {};
  document.getElementById('kpis').innerHTML = `<div class="kpis">
    <div class="kpi"><b>${k.regios || 0}</b><span>regio's</span></div>
    <div class="kpi"><b>${k.inzichten || 0}</b><span>inzichten</span></div>
    <div class="kpi"><b>${k.stemmen || 0}</b><span>stemmen</span></div>
    <div class="kpi"><b>${k.deelnemers || 0}</b><span>deelnemers</span></div>
  </div>`;
}

function renderViz1() {
  const items = applyFilters(A.insights);
  const max = items.reduce((m, i) => Math.max(m, i.totaalStemmen), 0) || 1;
  const bubbles = document.getElementById('bubbles');
  if (!items.length) {
    bubbles.innerHTML = '<p class="empty">Geen inzichten voor deze filters.</p>';
  } else {
    bubbles.innerHTML = items.map(i => {
      const scale = 0.35 + 0.65 * (i.totaalStemmen / max);
      const w = Math.round(90 + 130 * scale);
      const h = Math.round(46 + 56 * scale);
      return `<div class="bub ${i.type}" style="width:${w}px;height:${h}px" title="${esc(i.tekst)}">
        <span>${esc(i.tekst)}</span>
        <div><span class="rg">${esc(i.regio)}${i.rol ? ' · ' + esc(i.rol) : ''}</span><br><small>${i.totaalStemmen}</small></div>
      </div>`;
    }).join('');
  }
  const roles = [['praktijk', 'Praktijk'], ['aansturing', 'Aansturing'], ['ondersteuning', 'Ondersteuning']];
  document.getElementById('cols').innerHTML = roles.map(([key, label]) => {
    const col = items.filter(i => i.rol === key);
    const cmax = col.reduce((m, i) => Math.max(m, i.totaalStemmen), 0) || 1;
    const sum = col.reduce((s, i) => s + i.totaalStemmen, 0);
    return `<div class="col"><h5>${label} <span>${sum} st.</span></h5>
      ${col.length ? col.map(i => `<div class="ci"><span title="${esc(i.tekst)}">${esc(i.tekst)}</span><span>${i.totaalStemmen}</span></div>
        <div class="cb ${i.type}" style="width:${Math.round(100 * i.totaalStemmen / cmax)}%"></div>`).join('') : '<p class="empty">—</p>'}
    </div>`;
  }).join('');
}
```

- [ ] **Step 4: Run test om te bevestigen dat hij slaagt**

Run: `cd app && npx playwright test tests/analyse.spec.mjs --grep "viz1"`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add app/analyse.html app/tests/analyse.spec.mjs
git commit -m "feat(analyse): viz1 — KPI-kop + treemap-blokken + rol-kolommen" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 10: `analyse.html` — `renderViz2` (kaartraster + shortlist)

**Files:**
- Modify: `app/analyse.html` (vervang één stub)
- Test: `app/tests/analyse.spec.mjs`

- [ ] **Step 1: Schrijf de falende test**

Voeg onderaan `app/tests/analyse.spec.mjs` toe:

```js
test('viz2 toont use-case-kaarten gesorteerd op prioriteit', async ({ page }) => {
  await page.goto(`${base}/admin/analyse`);
  const cards = page.locator('#uc-grid .uc');
  await expect(cards).toHaveCount(2);
  await expect(cards.first()).toContainText('Studievoortgang');
  await expect(cards.first().locator('.prio')).toHaveText('7');
  await expect(cards.first()).toContainText('Eerder ingrijpen');
});

test('shortlist-ster togglet en wordt in localStorage bewaard', async ({ page }) => {
  await page.goto(`${base}/admin/analyse`);
  const first = page.locator('#uc-grid .uc').first();
  await expect(first).not.toHaveClass(/starred/);
  await first.locator('.star').click();
  await expect(first).toHaveClass(/starred/);
  const stored = await page.evaluate(() => localStorage.getItem('ceda-analyse-shortlist'));
  expect(JSON.parse(stored)).toContain('i1');
  // Blijft na herladen.
  await page.reload();
  await expect(page.locator('#uc-grid .uc').first()).toHaveClass(/starred/);
});
```

- [ ] **Step 2: Run test om te bevestigen dat hij faalt**

Run: `cd app && npx playwright test tests/analyse.spec.mjs --grep "viz2|shortlist"`
Expected: FAIL — `#uc-grid` is leeg.

- [ ] **Step 3: Vervang de stub**

In `app/analyse.html`, vervang:

```js
function renderViz2() {}
```

door:

```js
function renderViz2() {
  const items = applyFilters(A.useCases);
  const star = getShortlist();
  const grid = document.getElementById('uc-grid');
  if (!items.length) { grid.innerHTML = '<p class="empty">Geen use cases voor deze filters.</p>'; return; }
  grid.innerHTML = items.map(u => {
    const on = star.has(u.insightId);
    return `<div class="uc${on ? ' starred' : ''}" data-id="${esc(u.insightId)}">
      <div class="prio">${u.totaalStemmen}</div>
      <h4>${esc(u.tekst)}</h4>
      ${u.doel ? `<div class="fld"><b>Doel</b>${esc(u.doel)}</div>` : ''}
      ${u.actoren ? `<div class="fld"><b>Actoren</b>${esc(u.actoren)}</div>` : ''}
      ${u.resultaat ? `<div class="fld"><b>Resultaat</b>${esc(u.resultaat)}</div>` : ''}
      ${u.ai_data ? `<div class="fld"><b>AI &amp; data</b>${esc(u.ai_data)}</div>` : ''}
      <div class="meta">${u.rol ? `<span class="tag">${esc(u.rol)}</span>` : ''}<span class="rg">${esc(u.regio)}</span></div>
      <button class="star no-print" title="Markeer als co-creatie-kandidaat">${on ? '★' : '☆'}</button>
    </div>`;
  }).join('');
  grid.querySelectorAll('.star').forEach(btn => btn.addEventListener('click', () => {
    const id = btn.closest('.uc').dataset.id;
    const s = getShortlist();
    if (s.has(id)) s.delete(id); else s.add(id);
    setShortlist(s);
    renderViz2();
  }));
}
```

- [ ] **Step 4: Run test om te bevestigen dat hij slaagt**

Run: `cd app && npx playwright test tests/analyse.spec.mjs --grep "viz2|shortlist"`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add app/analyse.html app/tests/analyse.spec.mjs
git commit -m "feat(analyse): viz2 — use-case-kaarten + shortlist-ster (localStorage)" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 11: `analyse.html` — regio-beheer-dialog

**Files:**
- Modify: `app/analyse.html` (vervang twee stubs: `renderRegioDialog` + `initRegio`)
- Test: `app/tests/analyse.spec.mjs`

> **Testvolgorde:** deze test voegt `TEST1` toe aan `regios.json` in de tmp-dir en herlaadt. Hij moet ná de curatie-test uit Task 7 staan (die `unmappedRooms === ['TEST1']` verwacht). Omdat tests in bestandsvolgorde draaien (workers=1) en deze onderaan wordt toegevoegd, klopt dat.

- [ ] **Step 1: Schrijf de falende test**

Voeg onderaan `app/tests/analyse.spec.mjs` toe:

```js
test('regio-beheer: ongemapte kamer toevoegen → na opslaan telt die mee', async ({ page }) => {
  await page.goto(`${base}/admin/analyse`);
  await page.locator('#btn-regios').click();
  // De suggestieknop voor TEST1 verschijnt en voegt een rij toe.
  await page.locator('#regio-suggest button', { hasText: 'TEST1' }).click();
  // Vul het label van de nieuwe (laatste) rij.
  const lastLabel = page.locator('#regio-rows .regio-row').last().locator('input.label');
  await lastLabel.fill('Testregio');
  // Opslaan → server schrijft regios.json, pagina herlaadt.
  await Promise.all([
    page.waitForResponse(r => r.url().includes('/admin/regios') && r.request().method() === 'POST' && r.ok()),
    page.locator('#regio-save').click(),
  ]);
  await page.waitForLoadState('load');
  const data = await page.evaluate(() => window.__ANALYSE__);
  expect(data.regios.map(r => r.code)).toContain('TEST1');
  expect(data.insights.some(i => i.regioCode === 'TEST1')).toBe(true);
  expect(data.unmappedRooms).not.toContain('TEST1');
});
```

- [ ] **Step 2: Run test om te bevestigen dat hij faalt**

Run: `cd app && npx playwright test tests/analyse.spec.mjs --grep "regio-beheer"`
Expected: FAIL — dialog vult geen rijen / suggestieknop bestaat niet (stubs leeg).

- [ ] **Step 3: Vervang de stubs**

In `app/analyse.html`, vervang:

```js
function renderRegioDialog() {}
function initRegio() {}
```

door:

```js
function regioRowHtml(code, label) {
  return `<div class="regio-row">
    <span class="code">${esc(code)}</span>
    <input type="hidden" class="code-input" value="${esc(code)}">
    <input class="label" type="text" value="${esc(label)}" placeholder="regionaam">
    <button type="button" class="rm">verwijder</button>
  </div>`;
}
function bindRegioRows() {
  document.querySelectorAll('#regio-rows .rm').forEach(btn => {
    btn.onclick = () => btn.closest('.regio-row').remove();
  });
}
function renderRegioDialog() {
  const rows = document.getElementById('regio-rows');
  rows.innerHTML = A.regios.map(r => regioRowHtml(r.code, r.label)).join('');
  bindRegioRows();
  const sug = document.getElementById('regio-suggest');
  if (A.unmappedRooms && A.unmappedRooms.length) {
    sug.innerHTML = 'Kamers met data, nog niet gekoppeld: ' +
      A.unmappedRooms.map(c => `<button type="button" data-code="${esc(c)}">${esc(c)}</button>`).join('');
    sug.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
      rows.insertAdjacentHTML('beforeend', regioRowHtml(b.dataset.code, ''));
      bindRegioRows();
      b.remove();
    }));
  } else {
    sug.innerHTML = '';
  }
}
function initRegio() {
  document.getElementById('btn-regios').addEventListener('click', () => {
    renderRegioDialog();
    document.getElementById('regio-dialog').showModal();
  });
  document.getElementById('regio-add').addEventListener('click', () => {
    const code = (prompt('Sessiecode (3-16 tekens, A-Z 0-9):') || '').trim().toUpperCase();
    if (!code) return;
    document.getElementById('regio-rows').insertAdjacentHTML('beforeend', regioRowHtml(code, ''));
    bindRegioRows();
  });
  document.getElementById('regio-save').addEventListener('click', async () => {
    const list = [...document.querySelectorAll('#regio-rows .regio-row')].map(row => ({
      code: row.querySelector('.code-input').value.trim().toUpperCase(),
      label: row.querySelector('.label').value.trim(),
    })).filter(r => r.code && r.label);
    const res = await fetch('/admin/regios', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(list),
    });
    const out = await res.json().catch(() => ({}));
    if (!res.ok || !out.ok) { alert('Opslaan mislukt: ' + (out.error || res.status)); return; }
    location.reload();
  });
}
```

- [ ] **Step 4: Run test om te bevestigen dat hij slaagt**

Run: `cd app && npx playwright test tests/analyse.spec.mjs --grep "regio-beheer"`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add app/analyse.html app/tests/analyse.spec.mjs
git commit -m "feat(analyse): regio-beheer-dialog (toevoegen/hernoemen/verwijderen + suggesties)" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 12: `server.js` — `POST /admin/verslag` (Claude API + fallback)

**Files:**
- Modify: `app/server.js` (import + env + route)
- Test: `app/tests/analyse.spec.mjs`

- [ ] **Step 1: Maak de fallback-test deterministisch + schrijf de falende test**

In `app/tests/analyse.spec.mjs`, in `test.beforeAll`, vul de spawn-`env` aan met een lege API-sleutel zodat de fallback-tak gegarandeerd draait (ongeacht de omgeving van de ontwikkelaar). Vervang:

```js
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', RECAP_DIR: recapDir, ADMIN_USER: ADMIN.username, ADMIN_PASSWORD: ADMIN.password },
```

door:

```js
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', RECAP_DIR: recapDir, ADMIN_USER: ADMIN.username, ADMIN_PASSWORD: ADMIN.password, ANTHROPIC_API_KEY: '' },
```

Voeg onderaan `app/tests/analyse.spec.mjs` toe:

```js
test('POST /admin/verslag valt terug op getemplate samenvatting zonder API-sleutel', async () => {
  const res = await fetch(`${base}/admin/verslag`, {
    method: 'POST', headers: { authorization: authHeader, 'content-type': 'application/json' }, body: '{}',
  });
  expect(res.ok).toBe(true);
  const out = await res.json();
  expect(out.ok).toBe(true);
  expect(out.fallback).toBe(true);
  expect(out.verslag).toContain('behoeften');
  expect(out.verslag).toContain('Studievoortgang');
});

test('POST /admin/verslag vereist auth', async () => {
  const res = await fetch(`${base}/admin/verslag`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  expect(res.status).toBe(401);
});
```

- [ ] **Step 2: Run test om te bevestigen dat hij faalt**

Run: `cd app && npx playwright test tests/analyse.spec.mjs --grep "verslag"`
Expected: FAIL — route geeft 404.

- [ ] **Step 3: Breid de import uit + voeg env + route toe**

Werk de import-regel uit `analyse-lib.mjs` bij (bovenin `server.js`) naar:

```js
import { DEFAULT_REGIOS, validateRegios, aggregate, buildVerslagPrompt, buildFallbackVerslag } from './analyse-lib.mjs';
import Anthropic from '@anthropic-ai/sdk';
```

Voeg bij de env-constanten (rond regel 19, ná `ADMIN_PASSWORD`) toe:

```js
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';
```

Voeg direct ná de `app.post('/admin/regios', ...)`-handler toe:

```js
app.post('/admin/verslag', requireAdmin, express.json({ limit: '64kb' }), async (req, res) => {
  let data;
  try {
    data = aggregate(await readAllRooms(), await readRegios());
  } catch (err) {
    console.error('[verslag] aggregatie faalde', { code: err.code, message: err.message });
    return res.status(500).json({ ok: false, error: 'aggregatie faalde' });
  }
  // Geen sleutel → meteen de feitelijke samenvatting. Dashboard blijft bruikbaar.
  if (!ANTHROPIC_API_KEY) {
    return res.json({ ok: true, fallback: true, verslag: buildFallbackVerslag(data) });
  }
  try {
    const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
    const msg = await client.messages.create({
      model: 'claude-opus-4-8',
      max_tokens: 4000,
      thinking: { type: 'adaptive' },
      messages: [{ role: 'user', content: buildVerslagPrompt(data) }],
    });
    const text = msg.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
    res.json({ ok: true, fallback: false, model: 'claude-opus-4-8', verslag: text || buildFallbackVerslag(data) });
  } catch (err) {
    console.error('[verslag] Claude-call faalde — fallback', { message: err.message });
    res.json({ ok: true, fallback: true, error: 'ai_failed', verslag: buildFallbackVerslag(data) });
  }
});
```

> **Opmerking (niet-streaming):** conform de spec gebruiken we één niet-streaming `messages.create`-call (korte, begrensde output, admin-only). Zien jullie in productie request-timeouts bij het genereren, schakel dan over op `client.messages.stream(...).finalMessage()` — zelfde parameters, geen verdere wijziging nodig.

- [ ] **Step 4: Run test om te bevestigen dat hij slaagt**

Run: `cd app && npx playwright test tests/analyse.spec.mjs --grep "verslag"`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add app/server.js app/tests/analyse.spec.mjs
git commit -m "feat(analyse): POST /admin/verslag (claude-opus-4-8 + getemplate fallback)" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 13: `analyse.html` — verslag-UI (genereren, bewerken, bewaren)

**Files:**
- Modify: `app/analyse.html` (vervang één stub door drie functies)
- Test: `app/tests/analyse.spec.mjs`

- [ ] **Step 1: Schrijf de falende test**

Voeg onderaan `app/tests/analyse.spec.mjs` toe:

```js
test('verslag genereren vult het veld en bewaart lokaal; bewerken persisteert', async ({ page }) => {
  await page.goto(`${base}/admin/analyse`);
  await Promise.all([
    page.waitForResponse(r => r.url().includes('/admin/verslag') && r.request().method() === 'POST' && r.ok()),
    page.locator('#btn-verslag').click(),
  ]);
  const body = page.locator('#verslag-body');
  await expect(body).toContainText('Studievoortgang');
  await expect(page.locator('#verslag-meta')).toContainText('samenvatting'); // fallback-melding
  const stored = await page.evaluate(() => localStorage.getItem('ceda-analyse-verslag'));
  expect(stored).toContain('Studievoortgang');

  // Bewerken persisteert naar localStorage.
  await body.click();
  await page.keyboard.type(' EXTRA');
  await expect.poll(() => page.evaluate(() => localStorage.getItem('ceda-analyse-verslag'))).toContain('EXTRA');
});
```

- [ ] **Step 2: Run test om te bevestigen dat hij faalt**

Run: `cd app && npx playwright test tests/analyse.spec.mjs --grep "verslag genereren"`
Expected: FAIL — knop doet niets (initVerslag is een stub).

- [ ] **Step 3: Vervang de stub**

In `app/analyse.html`, vervang:

```js
function initVerslag() {}
```

door:

```js
function initVerslag() {
  const body = document.getElementById('verslag-body');
  const saved = localStorage.getItem(VERSLAG_KEY);
  if (saved != null) body.textContent = saved;
  else body.innerHTML = '<span class="empty">Nog geen verslag. Klik “Verslag genereren”.</span>';
  body.addEventListener('input', () => localStorage.setItem(VERSLAG_KEY, body.innerText));
  document.getElementById('btn-verslag').addEventListener('click', generateVerslag);
  updateVerslagMeta();
}
function updateVerslagMeta() {
  const meta = document.getElementById('verslag-meta');
  if (localStorage.getItem(VERSLAG_KEY) != null) meta.textContent = 'Lokaal bewerkbaar — wijzigingen blijven in je browser bewaard.';
}
async function generateVerslag() {
  const body = document.getElementById('verslag-body');
  const meta = document.getElementById('verslag-meta');
  const existing = localStorage.getItem(VERSLAG_KEY);
  if (existing && existing.trim() && !confirm('Bestaand (bewerkt) verslag overschrijven met een verse versie?')) return;
  meta.textContent = 'Bezig met genereren…';
  try {
    const res = await fetch('/admin/verslag', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    const out = await res.json();
    if (!out.ok) throw new Error(out.error || 'mislukt');
    body.textContent = out.verslag;
    localStorage.setItem(VERSLAG_KEY, out.verslag);
    meta.textContent = out.fallback ? 'Getemplate samenvatting (geen AI-sleutel ingesteld).' : `Gegenereerd met ${out.model}.`;
  } catch (e) {
    meta.textContent = 'Genereren mislukt: ' + e.message;
  }
}
```

- [ ] **Step 4: Run test om te bevestigen dat hij slaagt**

Run: `cd app && npx playwright test tests/analyse.spec.mjs --grep "verslag genereren"`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add app/analyse.html app/tests/analyse.spec.mjs
git commit -m "feat(analyse): verslag-UI (genereren, contenteditable, localStorage)" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 14: Export/print-verificatie, volledige suite + docs

De print-CSS (`@media print`) en de "Opslaan als PDF"-knop (`window.print()`) zitten al in het skeleton. Deze taak verifieert print-gedrag, draait de volledige testsuite en werkt de docs bij.

**Files:**
- Test: `app/tests/analyse.spec.mjs`
- Modify: `CLAUDE.md`, `README.md`, `docs/sessions/2026-06-23-regio-analyse-dashboard.md` (nieuw)

- [ ] **Step 1: Schrijf de print-test**

Voeg onderaan `app/tests/analyse.spec.mjs` toe:

```js
test('print-modus verbergt bedieningselementen maar toont de visualisaties', async ({ page }) => {
  await page.goto(`${base}/admin/analyse`);
  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('.filters')).toBeHidden();
  await expect(page.locator('#btn-print')).toBeHidden();
  await expect(page.locator('#viz1')).toBeVisible();
  await expect(page.locator('#viz2')).toBeVisible();
  await expect(page.locator('#verslag')).toBeVisible();
});
```

- [ ] **Step 2: Run de print-test**

Run: `cd app && npx playwright test tests/analyse.spec.mjs --grep "print-modus"`
Expected: PASS (1 test). (De print-CSS en `.no-print`-classes bestaan al uit Task 6 — geen codewijziging nodig; faalt de test, controleer dan dat `.filters`/`#btn-print` de class `no-print` hebben.)

- [ ] **Step 3: Draai de VOLLEDIGE testsuite**

Run: `cd app && npm test`
Expected: PASS — alle tests, inclusief de bestaande `recap-save.spec.mjs` (4 tests), `analyse-lib.spec.mjs` (10 tests) en `analyse.spec.mjs` (alle bovenstaande). Geen regressies.

- [ ] **Step 4: Werk de env-var-tabel in `CLAUDE.md` bij**

In `CLAUDE.md`, in de tabel onder "### Environment variables", voeg ná de `ADMIN_PASSWORD`-rij toe:

```
| `ANTHROPIC_API_KEY` | unset → verslag valt terug op getemplate samenvatting | Claude-API-sleutel voor het AI-verslag op `/admin/analyse` |
```

Voeg in dezelfde sectie, ná het bestaande tekstblok over `/admin/recaps`, een regel toe:

```
Analyse-dashboard op `GET /admin/analyse` (zelfde basic-auth): bundelt de regio-recaps tot twee visualisaties + een 1-A4 AI-verslag (`POST /admin/verslag`, model `claude-opus-4-8`; zonder `ANTHROPIC_API_KEY` een getemplate samenvatting). Regio-map bewerkbaar via `POST /admin/regios`, opgeslagen als `<RECAP_DIR>/regios.json` (geseed met HRQT/WTEL/PUXD/MDRH). Aggregatielogica staat los in `app/analyse-lib.mjs` (unit-getest via `tests/analyse-lib.spec.mjs`).
```

- [ ] **Step 5: Werk `README.md` bij**

Zoek in `README.md` de sectie over de admin-/recap-pagina en voeg een korte alinea toe (Nederlands), bijvoorbeeld ná de beschrijving van `/admin/recaps`:

```markdown
### Analyse-dashboard

Op `https://<host>/admin/analyse` (zelfde inlog als de recaps-pagina) staan de
vier regio's gebundeld in twee overzichten — kansen & inzichten naar prioriteit,
en de use cases als kaarten om samen 2–3 co-creatie-kandidaten te kiezen — plus
een bewerkbaar 1-A4 verslag. Het verslag wordt opgesteld door Claude
(`claude-opus-4-8`) wanneer de Fly-secret `ANTHROPIC_API_KEY` is gezet; zonder
sleutel verschijnt een feitelijke samenvatting. Exporteer via "Opslaan als PDF".

Sessiecodes koppel je aan regionamen via "Regio's beheren" (opgeslagen in
`<RECAP_DIR>/regios.json`). Nieuwe sleutel zetten:
`fly secrets set ANTHROPIC_API_KEY=sk-ant-...`.
```

> Plaats dit op de plek die in `README.md` logisch aansluit op de bestaande admin-documentatie; pas de kop-niveaus aan de omliggende structuur aan.

- [ ] **Step 6: Schrijf het sessieverslag**

Create `docs/sessions/2026-06-23-regio-analyse-dashboard.md`:

```markdown
# 2026-06-23 — Regio-analyse & presentatie-dashboard

Nieuwe admin-only feature: `GET /admin/analyse` bundelt de vier regio-recaps
(HRQT/WTEL/PUXD/MDRH) tot twee visualisaties (inzichten-treemap + rol-kolommen,
en use-case-kaarten met shortlist) plus een bewerkbaar 1-A4 verslag
(`POST /admin/verslag`, `claude-opus-4-8`, met getemplate fallback zonder
`ANTHROPIC_API_KEY`). Regio-map is in-app bewerkbaar (`POST /admin/regios` →
`<RECAP_DIR>/regios.json`, geseed met de vier defaults); alleen gemapte kamers
doen mee (curatie).

## Architectuur
- `app/analyse-lib.mjs` — pure aggregatie/validatie (unit-getest).
- `app/server.js` — I/O-glue + drie routes achter `requireAdmin`.
- `app/analyse.html` — pagina met server-geïnjecteerde JSON (`window.__ANALYSE__`),
  client-side filteren/renderen, print-CSS voor PDF-export.
- Geen CSP-wijziging nodig (inline script + same-origin fetch al toegestaan).

## Ontwerp & plan
- Spec: `docs/superpowers/specs/2026-06-23-regio-analyse-dashboard-design.md`
- Plan: `docs/superpowers/plans/2026-06-23-regio-analyse-dashboard.md`

## Deploy-noot
Zet vóór gebruik in productie de secret: `fly secrets set ANTHROPIC_API_KEY=...`
(optioneel — zonder sleutel werkt het dashboard, met getemplate verslag).
```

- [ ] **Step 7: Commit**

```bash
git add app/tests/analyse.spec.mjs CLAUDE.md README.md docs/sessions/2026-06-23-regio-analyse-dashboard.md
git commit -m "test(analyse): print-verificatie + docs (env var, README, sessielog)" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Done-criteria

- [ ] `cd app && npm test` is groen (recap-regressie + `analyse-lib` + `analyse`).
- [ ] `GET /admin/analyse` toont KPI's, treemap, rol-kolommen, use-case-kaarten en het verslag-veld; filters sturen viz1 + viz2.
- [ ] Regio's beheren voegt een ongemapte kamer toe en die telt na opslaan mee.
- [ ] Verslag genereren vult een bewerkbaar veld; zonder `ANTHROPIC_API_KEY` een getemplate samenvatting.
- [ ] "Opslaan als PDF" levert een nette print zonder bedieningselementen.
- [ ] Geen CSP-/Caddyfile-wijziging nodig; basic-auth dekt alle nieuwe routes.

## Handmatige smoke-test (na deploy, buiten de geautomatiseerde tests)

1. Open `/admin/analyse` met admin-login → data van HRQT/WTEL/PUXD/MDRH verschijnt.
2. Zet `ANTHROPIC_API_KEY` als Fly-secret, klik "Verslag genereren" → AI-verslag (geen fallback-melding).
3. Bewerk het verslag, herlaad de pagina → bewerking blijft staan (localStorage).
4. "Opslaan als PDF" → controleer de PDF-opmaak.

