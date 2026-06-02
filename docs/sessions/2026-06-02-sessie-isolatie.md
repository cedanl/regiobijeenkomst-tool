# 2026-06-02 — Sessie-isolatie: nieuwe sessie begint met schone lei

## Bug

Ed meldde: bij het starten van een **nieuwe** sessie (nieuwe code) stonden
nog resultaten — inzichten, cases, stemmen — van een vorige sessie in beeld.

## Root cause

State staat in één globale `localStorage`-sleutel (`ceda-workshop-v2`), niet
per room. `joinSessionRoom()` overschreef alleen `state.roomCode` maar wiste
de oogst nooit. Erger dan een weergave-glitch: een client met oude content
**broadcast** die ook via de state-sync (`state:full` op `state:request` /
`participant:announce`) naar de andere deelnemers in de nieuwe room — dus een
data-integriteitsbug, niet alleen cosmetisch.

`joinSessionRoom()` wordt óók aangeroepen voor auto-reconnect en bij
page-reload — die mogen de oogst juist **niet** wissen.

## Fix (`app/ceda-workshop.html`)

- `joinSessionRoom(code, resetContent = false)` — nieuwe parameter.
- Reset-blok vóór `state.roomCode = code`, ná de validatie-guards (zodat een
  ongeldige code of ontbrekende naam nooit data wist zónder te verbinden):
  `if (resetContent && state.roomCode !== code)` → `state = initialState()`,
  daarna `userId` / `userName` / `role` terugzetten (identiteit blijft).
- Alleen de expliciete connect-knop geeft `true` mee; auto-reconnect (regel
  ~3755) en page-load (~3909) gebruiken de default `false`.

De gate `state.roomCode !== code` dekt zowel "nieuwe sessie aanmaken" als
"naar een andere bestaande sessie verbinden", en laat reconnect/reload met
dezelfde code met rust.

### Bekende, geaccepteerde edge

`leaveSessionRoom()` zet `roomCode` op `null`. Daardoor wist *sessie ABC
verlaten → opnieuw ABC joinen* de lokale content (null ≠ ABC). Acceptabel:
peers re-syncen en de centrale save heeft de oogst al bewaard. Niet "netjes"
opgelost (aparte leave-flag) omdat dat de scope onnodig vergroot.

## Verificatie

Twee regressietests toegevoegd in `app/tests/recap-save.spec.mjs` (browser-
driven, chromium):
1. *nieuwe sessie wist resultaten van een vorige sessie* — bug-repro.
2. *herverbinden met dezelfde sessiecode behoudt de oogst* — de keerzijde van
   de gate; breekt als de reset-conditie te ruim is.

`cd app && npm test` → 3 passed (incl. bestaande recap-test, geen regressie).

Nog niet gecommit/gedeployed — wacht op akkoord van Ed.
