# 2026-05-11 — MVP launch

Werksessie waarin de bestaande Node.js workshop-tool een werkende eerste publieke versie kreeg, inclusief centrale oogst-opslag en een Fly.io-deployment.

## Wat er stond toen we begonnen

- Lokale Node-server (`server.js`) + single-file frontend (`ceda-workshop.html`)
- WebSocket-relay voor live sync tussen deelnemers in dezelfde sessiecode
- Geen versiebeheer, geen tests, geen documentatie buiten de bestaande `README.md`
- Geen centrale opslag — JSON-download was de enige manier om iets uit een bijeenkomst mee te nemen

## Wat er nu staat

- Repo: [`cedanl/regiobijeenkomst-tool`](https://github.com/cedanl/regiobijeenkomst-tool)
- Live URL: <https://ceda-regiobijeenkomst.fly.dev/>
- Fly.io app `ceda-regiobijeenkomst` in regio `ams`, met persistent volume `recaps` (1 GB) op `/data`
- `CLAUDE.md` voor toekomstige Claude-sessies
- Repo-admins: `EdF2021`, `EdwinLieftink`, `CorneeldH`

## Belangrijkste beslissingen

### Format voor centrale oogst: JSON, niet CSV

De workshop-state is hiërarchisch (votes-per-user als map, cases met 4 velden, participants-map). CSV zou flattening forceren in meerdere bestanden. JSON matcht de bestaande frontend-serializer en behoudt de structuur. Een `recaps_to_csv.py`-conversie is gepland als follow-up (#5) voor analyse in Excel/Power BI.

### Hosting: Fly.io, niet Netlify

Netlify is statisch + serverless functions; deze tool heeft een **long-running Node-proces met WebSocket-state in memory** nodig. Fly.io ondersteunt dat natively, heeft een gratis hobby-tier, persistent volumes (nodig voor recaps), en regio `ams` voor lage latency in NL. SURF Research Cloud is genoteerd als AVG-bewust alternatief (#6).

### Consent: opt-in save met inline kader

Geen autosave; elke deelnemer klikt zelf op *Oogst opslaan voor analyse* in de recap-stage. Direct boven de knop staat een tekstkader dat in twee zinnen uitlegt wat de actie doet en dat het vrijwillig is. De download-opties blijven werken voor wie z'n oogst lokaal wil houden.

## Bugs gevonden en gefixt

### WebSocket-relay stuurde berichten als binary frame

In `broadcastToRoom` werd het ontvangen `Buffer` rechtstreeks doorgestuurd via `peer.send(data)`. `ws` interpreteert een Buffer standaard als binary, dus browsers ontvingen een `Blob` i.p.v. een string. De client probeerde te `JSON.parse('')` (de fallback voor non-string) en gooide dat resultaat geruisloos weg in een `try/catch`. Effect: **álle live-sync ops verdwenen stil** — kaarten verschenen niet bij de andere deelnemer, stemmen werden niet geaggregeerd.

Fix: `peer.send(data, { binary: false })` forceert een text frame. Eén regel; pre-existente bug die nooit in productie was opgemerkt omdat er nog geen productie was.

### Storage probe gemist op startup

Eerste versie van `POST /api/recap` deed `mkdir` lazy in de request handler. Bij een stukke volume mount zou élke save in productie geruisloos falen met alleen een toast — niemand zou het merken tot na de bijeenkomst, en dan zouden de oogsten weg zijn. Toegevoegd: probe op boot die een test-write doet en `recapStorageOk` zet; `/healthz` flipt naar 503 als de probe faalt zodat Fly's healthcheck het oppakt.

### Niet-atomic write zou bij crash de vorige goede save corrumperen

`fs.writeFile` naar het definitieve pad opent met `O_TRUNC`. Een crash, SIGTERM of OOM mid-write zou een geldig recap-bestand kunnen vervangen door een truncated bestand. Fix: schrijf naar `<file>.<pid>.<ts>.tmp` en `fs.rename` aan het eind — rename is atomic op POSIX.

## Open follow-ups

| # | Titel |
|---|---|
| #2 | Rate-limit + per-room file cap op `/api/recap` |
| #3 | Reproduceerbare end-to-end smoke test in de repo |
| #5 | `recaps_to_csv` conversiescript |
| #6 | SURF Research Cloud deployment als AVG-bewust alternatief |
| #8 | Fly.io-toegang delen met Edwin en Corneel (verhuizen naar CEDA Fly-org, of co-admins op personal) |

## Recap-bestanden ophalen na een bijeenkomst

```bash
flyctl ssh console -a ceda-regiobijeenkomst -C "tar -C /data/recaps -czf - ." > recaps-$(date +%F).tgz
```

Bestand-layout op het volume:

```
/data/recaps/
  <ROOMCODE>/
    u_<id>.json   # ← deelnemer 1, laatste save
    u_<id>.json   # ← deelnemer 2, laatste save
```

Per deelnemer één bestand; herhaald opslaan overschrijft (latest wins).

## Verifiëring

Twee-deelnemer-doorloop via Puppeteer tegen de live URL bevestigde dat over de hele keten:

- Sessie hosten + joinen ✓
- Insight-sync over twee browsers ✓
- Vote-aggregatie correct over beide budgets (10 stemmen totaal) ✓
- Tekst-patch sync op case-velden (Bob's typen verschijnt bij Alice) ✓
- Save-flow: beide klikken, beide krijgen toast, beide files landen op het Fly volume met `node:node`-eigenaarschap (entrypoint chowning werkt)
- Atomic-rename liet geen `.tmp` leftovers achter

Smoke-script niet in de repo bewaard — staat in issue #3.
