# 2026-05-27 — Periodieke recap-save hersteld + sendBeacon-flush

## Wat
Recap-save in `app/ceda-workshop.html` teruggezet en gehard met een
`pagehide`/`visibilitychange` → `navigator.sendBeacon`-flush. Consent-indicator
("Opslag voor analyse") in de header weer toegevoegd. Plus losse doc-edits
in `CLAUDE.md` en `INSTRUCTIONS.md` (verouderde recap-layout-uitleg, README-
en `docs/superpowers/`-pointers, line-count drift).

## Waarom
Melding van de bijeenkomst-host: sessie `HRQT` ontbrak op `/admin/recaps`.
Code-analyse legde een structurele regressie bloot in commit `28ee6d5`
("vervang frontend met versie uit Downloads", 18 mei): de hele save-laag
(`scheduleAutoSave`, `flushRecap`, `startAutoSaveHeartbeat`, alle call-sites)
én de zichtbare consent-regel waren weg uit de Downloads-versie. De smoke-test
op die deploy dekte alleen WS-relay (`insight:add`), nooit `/api/recap` —
zie `2026-05-18-frontend-replace.md`, sectie "Open". Sinds 18 mei 14:05 heeft
geen enkele client meer state ge-POST'd; alle bijeenkomsten na die deploy
ontbreken op het volume.

Secundair: ook in de pre-swap versie ontbrak een unload-safe flush. De 5s
debounce + `fetch()` lopen leeg bij tab-close (timer gecanceld, in-flight
fetch door browser afgebroken). Worst-case dataverlies tot ~60s
(heartbeat-window). Dat is precies "de laatste sessie ontbreekt" — aan het
eind sluit iedereen tegelijk hun tab.

## Hoe
Vier surgical edits in `app/ceda-workshop.html`:
1. `saveState()` → roept nu `scheduleAutoSave()` aan (regel 2460).
2. Save-subsystem na `loadState()` (regels 2468–2505): debounce, heartbeat,
   `flushRecapBeacon` met `navigator.sendBeacon`, en `pagehide`+
   `visibilitychange→hidden` listeners.
3. Consent `<span class="recap-consent">` na de room-pill in `#topbar`
   (regel 1582), markup en title identiek aan pre-swap.
4. `.recap-consent` CSS naast `.room-pill` (regels 850–858), incl. de
   `@media (max-width:1100px)` hide-regel.

Geen serverwijzigingen — `POST /api/recap` was nooit kapot, alleen niet
aangeroepen. Diff: +49 / -0 in `app/ceda-workshop.html`.

## Smoke test (lokaal, `PORT=3001`, chrome-devtools-mcp, isolated context)

Twee paden expliciet uitgespeeld op room `SLPX`:

| Pad | Trigger | Verwacht | Resultaat |
|---|---|---|---|
| Debounce (5s) → `fetch` | Rol "PRAKTIJK" gekozen | POST + merge na ~5s | `state.json` @ 10:25:32, `role: praktijk` ✓ |
| `pagehide` → `sendBeacon` | Rol → "ONDERSTEUNING", tab direct dichtgeklikt (<5s) | beacon vóór unload, merge na close | `state.json` @ 10:26:07, `role: ondersteuning` ✓ |

Zonder de beacon-hardening zou pad 2 verloren zijn gegaan (debounce-timer
gecanceld bij unload). Server-side: merge onder per-room mutex correct,
één `participants[userId]`-entry, `updatedAt` synchroon met `savedAt`.

Consent-UI zichtbaar gecheckt vóór joinen (`document.querySelector('.recap-consent').textContent` → `"Opslag voor analyse"`).

JS-syntax-check vooraf: `node --check app/server.js` + een Node-parse-eval op
de extracted `<script type="module">` (1625 regels) — beide groen.

## Recovery voor HRQT
De host hield zijn tab open. Vóór deploy aangeraden om in zijn DevTools-
console eenmalig handmatig te POSTen:

```js
fetch('/api/recap', {
  method: 'POST',
  headers: {'Content-Type':'application/json'},
  body: localStorage.getItem('ceda-workshop-v2')
}).then(r => r.json()).then(console.log);
```

Andere deelnemers met nog open tabs kunnen hetzelfde doen — elke POST merget
in dezelfde `state.json` onder hun eigen `userId`. Verloren tabs: weg.

## Commits
- `fix(frontend): herstel periodieke recap-save + sendBeacon op pagehide`
- Bevat ook eerdere doc-edits in `CLAUDE.md` (line-count drift, README- en
  superpowers-pointers) en `INSTRUCTIONS.md` (recap-layout naar `state.json`).

## Open
- **Regressie-vangnet ontbreekt nog.** Dezelfde frontend-swap-categorie kan
  dit zo weer slopen. Minimale CI/preflight: een Playwright-stap die een room
  joint, één state-change maakt en `state.json` op disk verifieert. Hangt
  voor nu af van handmatige UI-smoke-tests bij frontend-wijzigingen.
- **Auto-stop window.** Fly `auto_stop_machines = "stop"` + cold-start kan
  een POST kortstondig laten falen; `flushRecap`'s `catch {}` slikt dat. De
  60s heartbeat vangt het op zolang de tab open blijft. Bij tab-close in
  die race kan een beacon nog steeds wegvallen — acceptabel risico, niet
  opgelost in deze fix.
