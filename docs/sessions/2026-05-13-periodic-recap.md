# 2026-05-13 — Periodieke recap-save

## Wat
Auto-save tijdens de bijeenkomst in plaats van alleen een eindknop. Alle deelnemers komen samen in één `<RECAP_DIR>/<ROOM>/state.json` op Fly. Eindknop *"Oogst opslaan voor analyse"* + uitlegkader verdwenen; korte consent-regel ("Opslag voor analyse" + cloud-icoon) in de topbar zodra een sessie actief is.

## Waarom
Deelnemers die halverwege afhaakten lieten niets achter. Voor analyse op kamerniveau was joinen op `roomCode` over losse user-files onhandig. Eén bestand per kamer is ook prettiger voor downstream bulk-export.

## Hoe

**Frontend (`app/ceda-workshop.html`)**
- `scheduleAutoSave()` debounce 5s na elke `saveState()` + `startAutoSaveHeartbeat()` setInterval 60s vanaf `joinSessionRoom`.
- `flushRecap()` POST de hele state naar `/api/recap`; netwerkfouten stil — volgende tick probeert opnieuw.
- Eindknop, click-handler en consent-kader uit `renderRecap` verwijderd. Privacy-intro op join-pagina herschreven naar "sessie wordt voor analyse opgeslagen".
- Topbar consent-zin in `participants-cluster`, `white-space: nowrap`, verbergt onder 1100px.

**Server (`app/server.js`)**
- `withRoomLock(room, fn)` Promise-chain mutex per room — serialiseert writes binnen een kamer, parallel tussen kamers.
- `/api/recap` doet read-modify-write op `<RECAP_DIR>/<ROOM>/state.json`: lees → merge `participants[userId] = { savedAt, state }` → atomair `*.tmp` + `rename`. ENOENT / parse-error / missende `participants` → start fresh; andere errors bubbelen.
- Tmp-bestand wordt na een mislukte `rename` best-effort opgeruimd (`fs.unlink(tmp).catch(()=>{})`), zodat flaky-storage geen leak op het volume oplevert.
- `/admin/recaps` toont per kamer één primair regel met `updatedAt` + deelnemer-aantal + downloadlink naar `state.json`, met daaronder eventuele legacy per-user-files onder *"Legacy per-deelnemer-saves"*. Kamers zonder `state.json` (alleen legacy) blijven zichtbaar.

## Verificatie
- Curl: twee opeenvolgende POSTs → één state.json met beide participants.
- Curl: 5 parallelle POSTs naar dezelfde kamer → mutex serialiseert, alle 5 (+2 eerdere) aanwezig.
- Curl: invalid roomCode → 400; ongeauthenticeerde admin → 401; geen `ADMIN_PASSWORD` → 503.
- Browser via chrome-devtools-mcp: naam + sessiecode invullen → join → state.json met de eigen state binnen ~6s op disk. Topbar consent-regel zichtbaar op één lijn met room-pill.
- Admin-UI smoke-test in browser: ADMINT1 (primary + legacy in dezelfde kamer) en LEGACY1 (alleen legacy) tonen beide groepen correct; downloads werken.

## Niet aangeraakt
- WS-relay (blijft dom, geen kennis van state).
- Bestaande legacy per-user-files (blijven op disk, blijven downloadbaar).
- CSP, healthz, stats, security-headers, fly.toml, Dockerfile.

## Spec & plan
- `docs/superpowers/specs/2026-05-13-periodic-recap-design.md`
- `docs/superpowers/plans/2026-05-13-periodic-recap.md`

## Commits (branch `feat/periodic-recap`)
- `8ddd16e` per-room mutex helper
- `86956f0` /api/recap merge naar state.json
- `0b7c3b3` admin/recaps state.json + legacy groep
- `a248402` tmp-cleanup bij rename-failure (quality-review follow-up)
- `fc3bad9` frontend auto-save debounce + heartbeat
- `623a90e` eindknop + uitlegkader weg
- `1753106` consent-regel in header
- `c3655e6` consent-regel styling (nowrap + cloud-icoon)
- `71b22ee` README + CLAUDE.md update

## Bekende beperkingen
- Bij hard sluiten van de tab binnen 5s na een edit kan die ene mutatie verloren gaan (debounce nog niet gefired, geen `pagehide`-fallback). De voorlaatste state blijft wel in `state.json`. Heartbeat 60s vangt geen edits op die voor de eerste interval gemaakt zijn op een andere deelnemer's connectie.
