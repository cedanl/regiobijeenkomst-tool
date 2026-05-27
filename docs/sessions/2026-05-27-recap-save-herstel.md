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

## Middag — zekerheid-lagen + regressievangnet

Ed wilde garanderen dat de data wordt opgeslagen, niet alleen "hopelijk gaat
het goed". Drie zekerheid-lagen erbij plus een vangnet zodat dezelfde klasse
bug nooit meer onopgemerkt naar productie gaat.

### Zekerheid-lagen (PR #11 — `feat/save-status-reliability`)

1. **Header-indicator.** De consent-tekst is dynamisch: `Bezig met opslaan…` /
   `Opgeslagen Xs geleden` / `Niet opgeslagen — probeer opnieuw`. Refresht
   elke 5s. Visueel onderscheid via `.is-saving` / `.is-ok` / `.is-failed`
   (blauw / groen / rood).
2. **Retry-keten in `flushRecap`.** Bij niet-2xx of network-error volgen tot
   3 retries op 1s/3s/7s (totaal ~11s). Vangt Fly auto-stop cold-starts op
   zonder dat de host iets hoeft te doen. `flushRecap` is nu async/await en
   geeft true/false terug.
3. **Host-knop "Sla deze sessie nu op"** op de recap-pagina. Triggert
   `flushRecap()` direct en toast't het resultaat (`Sessie opgeslagen om
   HH:MM:SS` of `Opslaan mislukt — controleer netwerk`). Voor de host die
   aan het eind van een sessie 100% zeker wil weten dat alles binnen is.

Diff: +97 / -11 in `app/ceda-workshop.html`. Geen serverwijzigingen.

### Regressievangnet (PR #12 — `feat/save-regression-test`)

Playwright-test in `app/tests/recap-save.spec.mjs`: spint een verse server op
tegen een `mkdtemp` + vrije poort, joint via de UI een nieuwe sessie, kiest
een rol, wacht op een 2xx POST naar `/api/recap` (`page.waitForResponse`,
geen hardcoded sleep), leest `state.json` van disk en asserteert `roomCode`,
`userName` en `role`.

Onafhankelijk van de PR #11 status-indicator — gebruikt de network-response,
niet de UI-class, zodat hij zelfstandig op `main` werkt. Eén worker, geen
parallel, ~6s end-to-end.

`CLAUDE.md` verplicht nu `npm test` vóór elke `fly deploy`. Eerste keer:
`npx playwright install chromium`. `app/test-results/` en
`app/playwright-report/` toegevoegd aan `.gitignore`.

### Smoke + productie-verificatie

PR #11 lokaal getest, vier paden groen:

| Trigger | Pad | Resultaat |
|---|---|---|
| Rol gekozen | 5s debounce → `fetch` | `is-ok`, disk update |
| Host-knop | direct `fetch` | toast + `is-ok` in ~300ms |
| Server down | retry-keten 4×, ~11.1s | `is-failed`, toast "Opslaan mislukt" |
| Server up + host-knop | recovery | `is-ok` |

PR #12 lokaal én op de met `main` gemergde branch: groen in ~5.5s.

Na merge + deploy live getest op `ceda-regiobijeenkomst.fly.dev` met twee
isolated browser-contexten (host `LiveHost` / guest `LiveGast` in room
`ZTEZ`):

- Beide auto-saves landen in `state.json` op het Fly-volume, binnen 14ms van
  elkaar (`10:57:43.515Z` en `.529Z`). Per-room mutex deed zijn werk —
  geen corruptie.
- Beide `participants`-blokken zien elkaars `lastSeen` via WS-relay.
- Status-indicator `is-ok` op beide tabs na de debounce.
- Host-knop op host-tab → toast + `updatedAt` op disk advanceerde.
- 60s heartbeat zichtbaar als extra save 11s ná de host-click.

### Merge-volgorde + deploy

1. `gh pr merge 12 --merge --delete-branch` — regressievangnet eerst zodat
   het vanaf nu PR #11 zelf bewaakt.
2. PR #11-branch gemerged met `main` → `npm test` opnieuw groen → push.
3. `gh pr merge 11 --merge --delete-branch`.
4. `cd app && npm test` als preflight → `fly deploy` vanaf repo-root.
   Healthcheck `recapStorage:"ok"`, 19 fix-markers in live HTML
   (`host-save-now`, `is-*`, `RETRY_DELAYS_MS`, `renderSaveStatus`).

## Commits

- `4ac9158` fix(frontend): herstel periodieke recap-save + sendBeacon op pagehide *(ochtend)*
- `07579a2` test(recap): Playwright-regressie zodat een file-swap dit nooit meer kan slopen (PR #12)
- `d0a06cd` feat(frontend): zichtbare save-status + retry-keten + host-save-knop (PR #11)
- `8dd76de` Merge branch 'main' into feat/save-status-reliability *(preflight-run op de gemergde state)*
- `51def57` Merge pull request #12
- `48a8c95` Merge pull request #11

Twee deploys vandaag op `ceda-regiobijeenkomst.fly.dev`: één ná `4ac9158`,
één ná de twee middag-PR's.

## Avond — CI-vangnet (PR #13)

Het laatste handmatige stuk afgesloten: `.github/workflows/test.yml` draait
`npm test` op elke PR en push-naar-main. Checkout → setup-node@v4 (Node 20
+ npm-cache) → `npm ci` → `npx playwright install chromium` → `npm test`,
met `working-directory: app`. Eigen PR-run als live-test: groen in 29s.
CLAUDE.md noemt zowel het CI-vangnet als de lokale preflight (Fly deploy
gaat buiten GH om, dus handmatig `npm test` vóór `fly deploy` blijft de
aanrader).

Niet-blokkerende deprecation-waarschuwing van GH: Node 20-actions worden
in september 2026 vervangen door Node 24. Werkt tot dan onveranderd door,
later upgraden naar `@v5`-tags zodra die uit zijn.

Commit: `002d02b` ci: draai Playwright-regressie automatisch op elke PR + push naar main (PR #13, `e5c37ac` merge).

## Open einde dag

- **~~Regressie-vangnet ontbreekt nog~~** — opgelost in PR #12.
- **~~Geen CI-workflow~~** — opgelost in PR #13.
- **Auto-stop window.** Fly `auto_stop_machines = "stop"` + cold-start kan
  een POST kortstondig laten falen. Goed deels afgedekt door de retry-keten
  (1s/3s/7s) uit PR #11. Bij tab-close in die race kan een beacon nog steeds
  wegvallen — acceptabel risico, niet opgelost.
- **PR #11-retry-keten heeft geen eigen regressietest.** De Playwright-test
  uit PR #12 dekt het happy-path. Een aparte test die de server tijdens een
  save dropt en de retry/`is-failed`-status verifieert zou de zekerheid op
  exact die laag in stand houden. Voor nu via handmatige browser-test
  bewaakt (vandaag groen gedraaid).
