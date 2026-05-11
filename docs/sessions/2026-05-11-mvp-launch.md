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
- Admin-UI voor opgeslagen recaps: <https://ceda-regiobijeenkomst.fly.dev/admin/recaps> (basic-auth, wachtwoord buiten dit logboek gedeeld)
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

## Vervolg later op dezelfde dag

Na de eerste MVP-launch zijn er nog twee features ingevlogen en zijn de team-permissies geregeld.

### PR #7 — Consent-kader bij de save-knop (closes #4)

Inline tekstkader boven de actions-bar in de recap-stage, twee zinnen die uitleggen wat *Oogst opslaan voor analyse* doet en dat het vrijwillig is. Vervangt de eerdere tooltip-only aanpak. Ook de welkomstpagina-privacy-callout bijgewerkt: die zei nog "niets wordt bewaard, gelogd of opgeslagen" en somde alleen de download-opties op; nu noemt-ie *Oogst opslaan voor analyse* expliciet als vierde exportoptie.

### Repo-admins toegevoegd

`EdwinLieftink` (Edwin Lieftink, SURF) en `CorneeldH` (Corneel den Hartogh, CEDA) kregen `admin` op de repo via `gh api PUT repos/.../collaborators/<user>`. Beiden waren al cedanl-org-leden, dus geen org-invite nodig. Fly-toegang volgt los — gevangen in issue #8.

### PR #9 — Admin browse-UI voor opgeslagen recaps

`GET /admin/recaps` toont een HTML-overzicht van alle bijeenkomsten met per sessie de deelnemers die hun oogst hebben opgeslagen. Klik op een bestand → JSON-download via `GET /admin/recaps/:room/:file`. Basic-auth via `ADMIN_USER` (default `ceda`) en `ADMIN_PASSWORD`. Zonder password staat de hele admin-route uit (HTTP 503) zodat een verkeerd geconfigureerde deploy nooit per ongeluk open kan staan. Timing-safe vergelijking via `crypto.timingSafeEqual`; defense-in-depth in de download-handler (regex op room+file, `path.resolve` + `startsWith(RECAP_DIR)`).

`ADMIN_PASSWORD` gegenereerd via `openssl rand -base64 24`, gezet via `flyctl secrets set`, niet in het logboek bewaard.

### Waarom geen GitHub als opslag-laag

Eddef vroeg of de recaps niet beter naar een GitHub-repo konden zodat Edwin/Corneel direct in de browser zouden kunnen kijken. Drie redenen om dat niet te doen:

1. **AVG**: recaps bevatten deelnemer-namen + rollen + open-tekst antwoorden. Publieke GitHub-repo niet geschikt; private repo wel, maar dan is GitHub een verwerker en zit je nog met de vraag of dat past binnen jullie AVG-afspraken.
2. **Token-beheer**: Fly-server zou een GitHub-token met schrijfrechten nodig hebben — leverbaar maar een credential die je dan moet roteren.
3. **Schrijfconflicten**: gelijktijdige saves van twee deelnemers = parallelle `git push`'es met fast-forward errors. Op te lossen met retry-logic, maar plotseling veel meer code dan een `fs.writeFile`.

De admin browse-UI lost het onderliggende doel (Edwin/Corneel zonder CLI bij de data) op zonder al deze trade-offs.

## Open follow-ups

| # | Titel |
|---|---|
| #2 | Rate-limit + per-room file cap op `/api/recap` |
| #3 | Reproduceerbare end-to-end smoke test in de repo |
| #5 | `recaps_to_csv` conversiescript |
| #6 | SURF Research Cloud deployment als AVG-bewust alternatief |
| #8 | Fly.io-toegang delen met Edwin en Corneel |
| ✓ | ~~#4 Consent-kader~~ — gesloten via PR #7 |

## Recap-bestanden ophalen na een bijeenkomst

**Via de browser** — `https://ceda-regiobijeenkomst.fly.dev/admin/recaps` (basic-auth). Lijst van alle bijeenkomsten met per sessie deelnemer, save-tijd, en download-link per file.

**Via CLI** — voor bulk-export naar een tarball:

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
