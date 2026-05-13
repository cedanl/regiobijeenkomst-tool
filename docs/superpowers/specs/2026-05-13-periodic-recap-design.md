# Periodieke recap-save naar één room-bestand

**Datum:** 2026-05-13
**Status:** Concept, ter review
**Scope:** `app/server.js`, `app/ceda-workshop.html`

## Achtergrond

Op dit moment kunnen deelnemers hun workshop-state pas aan het einde centraal opslaan, via de knop *"Oogst opslaan voor analyse"* in de recap-stage. Wie eerder afhaakt — laptop dichtklapt, browser-tab sluit, verbinding wegvalt — laat niets achter op de server. Voor analyse betekent dat een blinde vlek: juist de deelnemers die afhaken zijn waarschijnlijk interessant.

Daarnaast staat de huidige opslag verdeeld over één JSON-bestand per deelnemer (`<RECAP_DIR>/<ROOM>/<userId>.json`). Voor analyse op kamerniveau is dat onhandig: je moet alle losse bestanden joinen op `roomCode`.

## Doel

Periodiek (tijdens de workshop, niet alleen aan het eind) de state van álle deelnemers in een sessie naar Fly schrijven, samengevoegd in **één bestand per kamer**.

## Niet-doelen

- Geen wijziging aan het WS-relay-gedrag. De relay blijft dom; alle aggregatie verloopt via HTTP.
- Geen versiehistorie per save-tick. Laatste write wint per deelnemer.
- Geen client-zijdige merge van peer-states. Elke client schrijft alleen zijn eigen sectie.

## Beslissingen (brainstorm-uitkomst)

| Onderwerp | Keuze |
|---|---|
| Consent | Stil meeschrijven, altijd aan. Eén korte uitleg-regel in de header naast de sessiecode. |
| Save-trigger | Debounce 5s na elke `saveState()` + verzekerings-heartbeat elke 60s. |
| Architectuur | Elke client POST't z'n eigen state; server doet read-modify-write op een room-bestand met per-room mutex. |
| Bestandslayout | `<RECAP_DIR>/<ROOM>/state.json` (subdirectory aangehouden, één live bestand erin). |
| Eindknop | Verwijderd. Auto-save dekt alle scenario's. |
| Legacy per-user-files | Blijven op disk, blijven downloadbaar, in admin-UI gegroepeerd onder "legacy". |

## Architectuur

### Dataflow per save-tick

```
client (saveState) ──debounce 5s──► POST /api/recap  ──┐
client (heartbeat)──interval 60s──►                    │
                                                       ▼
                                              per-room mutex
                                                       │
                                                       ▼
                                       read  <ROOM>/state.json
                                       merge participants[userId] = { savedAt, state }
                                       write <ROOM>/state.json.tmp  →  rename
                                                       │
                                                       ▼
                                              {ok, savedAt}
```

### Bestandsformaat

```json
{
  "roomCode": "WS2026",
  "createdAt": "2026-05-13T10:02:11.000Z",
  "updatedAt": "2026-05-13T10:47:33.412Z",
  "participants": {
    "u_abc123": {
      "savedAt": "2026-05-13T10:47:33.000Z",
      "state": { "userName": "...", "insights": [...], "votes": {...} }
    },
    "u_xyz789": { "savedAt": "...", "state": { ... } }
  }
}
```

`roomCode` en `createdAt` zijn write-once: bij eerste write ingesteld, daarna alleen `updatedAt` en de bewuste `participants`-sectie gewijzigd.

### Per-room mutex

Lichtgewicht Promise-chain als JS-niveau lock — geen externe lib nodig:

```js
const roomLocks = new Map(); // roomCode → Promise (de meest recente write)

function withRoomLock(room, fn) {
  const prev = roomLocks.get(room) || Promise.resolve();
  const next = prev.catch(() => {}).then(fn);
  roomLocks.set(room, next);
  // Opruimen als deze chain ‘rust’: zodra next afgehandeld is én niemand
  // nieuwe writes erop geketend heeft, mag de Map-entry weg.
  next.finally(() => {
    if (roomLocks.get(room) === next) roomLocks.delete(room);
  });
  return next;
}
```

Hiermee serialiseert ieder POST per kamer; verschillende kamers blijven parallel. Geen blokkade op event loop — alleen sequencing van I/O.

## Server-changes (`app/server.js`)

### `POST /api/recap`

- Body-contract ongewijzigd: client stuurt de hele eigen state (`roomCode`, `userId`, `userName`, `insights`, ...). Limiet 512 KB blijft.
- Validatie ongewijzigd: `ROOM_CODE_RE`, `USER_ID_RE`, `recapStorageOk`.
- Nieuw gedrag:
  1. `withRoomLock(room, async () => { ... })`.
  2. `dir = <RECAP_DIR>/<ROOM>`, `file = <dir>/state.json`.
  3. Lees `file` met `JSON.parse`. ENOENT → start met `{ roomCode: room, createdAt: now, participants: {} }`. Parse-error → log + 500 (we overschrijven geen onleesbaar bestand stilzwijgend).
  4. Mutate: `participants[userId] = { savedAt: now, state: body }`; `updatedAt = now`.
  5. Schrijf naar `file.<pid>.<ts>.tmp` + `fs.rename` (zelfde patroon als nu).
  6. Response: `{ ok: true, savedAt }`.
- Geen wijzigingen aan response-codes 400/503/500.

### Admin-routes

- `GET /admin/recaps` herschrijven:
  - Itereer alle subdirectories van `RECAP_DIR` die match'en op `ROOM_CODE_RE`.
  - Per kamer:
    - Als `state.json` bestaat: lees, toon `updatedAt`, aantal `participants`, totale `size`, downloadlink → `/admin/recaps/:room/state.json`.
    - Lijst overige `.json` (legacy per-user-files) onder een subkopje *"Legacy per-deelnemer-saves"*, met dezelfde tabel als nu.
- `GET /admin/recaps/:room/:file` blijft ongewijzigd. Werkt voor `state.json` én voor legacy `u_xxx.json`. Pad-traversal-defense onveranderd.

### Niet-wijzigingen

WS-relay, CSP, `/healthz`, `/api/stats`, storage-probe, security-headers, graceful-shutdown — allemaal ongemoeid.

## Frontend-changes (`app/ceda-workshop.html`)

### Auto-save-plumbing

```js
let autoSaveTimer = null;
let autoSaveHeartbeat = null;

function scheduleAutoSave() {
  if (!state.roomCode || !state.userId) return;
  clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(flushRecap, 5000);
}

async function flushRecap() {
  if (!state.roomCode || !state.userId) return;
  try {
    await fetch('/api/recap', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(state)
    });
  } catch { /* stil — volgende tick probeert opnieuw */ }
}

function startAutoSaveHeartbeat() {
  if (autoSaveHeartbeat) return;
  autoSaveHeartbeat = setInterval(flushRecap, 60000);
}
```

- Aanroep `scheduleAutoSave()` aan het eind van `saveState()` — één plek.
- `startAutoSaveHeartbeat()` aanroepen zodra `state.roomCode` en `state.userId` voor het eerst gezet zijn (na join).
- Geen UI-feedback bij fouten. Geen retry-storms. Volgende save-tick probeert vanzelf weer.

### UI-changes

- In `renderRecap()`: knop *"Oogst opslaan voor analyse"* + omliggend uitlegkader **verwijderen**. De recap-stage toont alleen nog inhoudelijke samenvatting.
- In de header (waar nu de sessiecode-badge staat): één regel toevoegen, klein lettertype, naast/onder de code: *"Deze sessie wordt voor analyse opgeslagen."* Eén zin, geen modal.

## Edge cases

| Scenario | Gedrag |
|---|---|
| Twee clients POSTen ~tegelijk | Mutex serialiseert; tweede leest de zojuist weggeschreven file en merget eroverheen. Geen verloren writes. |
| Crash midden in write | `.tmp` blijft achter (op volgende write of restart op te ruimen indirect); `state.json` zelf blijft de laatst-geldige versie. |
| `state.json` corrupt (handmatig of disk) | Parse-error → 500, geen overschrijving. Operator moet handmatig ingrijpen. |
| Storage onbeschikbaar (`recapStorageOk = false`) | `/api/recap` → 503; client logt niets, volgende tick probeert opnieuw. `/healthz` is al 503. |
| Client offline | `fetch` faalt, stil geslikt; volgende debounce/heartbeat re-tryt. |
| Body > 512 KB | Bestaande limiet trekt; afgewezen met 413/400. Eén deelnemer-state past hier ruim binnen. |
| Deelnemer verlaat halverwege | Z'n laatste state staat al in `participants[userId]`. Geen verlies bij refresh of disconnect. |
| Server-restart | `roomLocks`-Map herstart leeg. File-state op disk overleeft. Eerstvolgende POST'jes vullen aan. |
| Migratie van bestaande bijeenkomsten | Oude `<ROOM>/<userId>.json` blijven liggen; nieuwe writes maken `<ROOM>/state.json` ernaast. Admin-UI toont beide. |

## Beveiliging & privacy

- Consent-model wijzigt van expliciet (opt-in via knop) naar impliciet (deelname = opslag). Vereist dat de header-zin *vóór* de eerste write zichtbaar is. Daarom: header-zin is altijd zichtbaar zodra `state.roomCode` gezet is, en de eerste auto-save volgt pas 5s na de eerste state-mutatie — nooit op het pure invullen van naam/code.
- Server-side validatie van `roomCode`/`userId` blijft regex-gated.
- Admin-route blijft fail-closed (503 zonder `ADMIN_PASSWORD`).
- Pad-traversal-defense in `/admin/recaps/:room/:file` blijft.
- Geen nieuwe afhankelijkheden, geen nieuwe poorten.

## Documentatie-updates

- `README.md` — sectie *"Beveiliging & privacy"* + *"Centrale oogst voor analyse"*: model en bestandslayout bijwerken; uitleg over expliciete eindknop weghalen.
- `CLAUDE.md` — `<RECAP_DIR>/<room>/<userId>.json` regel updaten naar `<RECAP_DIR>/<room>/state.json` (+ vermelding legacy fallback).
- `docs/sessions/2026-05-13-periodic-recap.md` — nieuw sessieverslag bij implementatie.

## Open vragen

Geen op moment van schrijven.

## Acceptatiecriteria

1. Twee browser-tabs joinen dezelfde sessiecode, beide bewerken state. Na 5s staat in `data/recaps/<ROOM>/state.json` één bestand met beide deelnemers in `participants`.
2. Eén tab refresh't midden in de workshop: vorige state van die deelnemer in `state.json` is onveranderd, na ~5s overschreven met de huidige (post-refresh) state.
3. Eén tab sluit halverwege zonder eindknop te klikken: z'n laatste state staat in `participants[userId]`.
4. Admin-UI toont per kamer één regel met `updatedAt` + aantal deelnemers + download. Oude bijeenkomsten met legacy per-user-files blijven zichtbaar onder een aparte groep en blijven downloadbaar.
5. `/healthz` reageert ongewijzigd; `/api/stats` ongewijzigd; WS-relay ongewijzigd.
