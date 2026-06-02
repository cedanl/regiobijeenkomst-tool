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

Gecommit `63a38d0`, gepusht naar `origin/main`.

## Vervolg — edge dichtgezet + data-safety (verzoek Ed)

Ed wilde vóór deploy óók de "leave → rejoin zelfde code wist content"-edge
opgelost, plus een smoketest van alle opslag-mechanismen ("DATA mag nooit
verloren gaan").

**Edge-fix via `state.contentRoom`.** Nieuw lokaal veld dat bijhoudt bij welke
room de huidige oogst hoort (niet gesynct — staat niet in `serializeState`).
De reset-gate vergelijkt nu `contentRoom !== code` i.p.v. `roomCode !== code`.
`leaveSessionRoom` zet `roomCode=null` maar laat `contentRoom` staan, dus
opnieuw joinen met dezelfde code → `contentRoom === code` → géén reset. Een
écht andere code → wél reset. Migratie: `contentRoom` afgeleid uit `roomCode`,
of sentinel `'__legacy__'` bij oude saves met oogst maar zonder room (zodat de
msg-1 fix ook voor legacy-state blijft werken).

**Data-safety.** `flushRecap`/beacon POSTen de live `state` onder
`state.roomCode`; een reset vóór de centrale save = dataverlies. Daarom:
`leaveSessionRoom` doet nu `flushRecap()` (fetch, geen 64KB-cap zoals beacon)
vóór het nullen van `roomCode` — body wordt synchroon opgebouwd, dus de eerste
POST draagt nog de juiste room. Reset-blok heeft een `flushRecapBeacon()`
-backstop. Reset wist alleen lokaal; centraal blijft de oude room-file staan.

**Tests** (`app/tests/recap-save.spec.mjs`, nu 5): toegevoegd
3. *verlaten en opnieuw met dezelfde code joinen behoudt de oogst*
4. *sessie verlaten schrijft een vers inzicht alsnog centraal weg* — voegt een
   inzicht toe binnen het debounce-venster en verlaat meteen; bewijst dat de
   leave-flush het naar `state.json` brengt. → `npm test` 5 passed.

**Browser-smoketest** (chrome-devtools, echte UI): (a) debounce-autosave
schrijft `ZTGX/state.json` ✓; (b) leave-flush redt een vers inzicht dat nog
niet auto-opgeslagen was ✓; (d) rejoin `ZTGX` behoudt beide inzichten lokaal
✓; nieuwe sessie `VDDD` start leeg, oude `ZTGX`-file blijft volledig intact,
geen lek tussen rooms ✓.
