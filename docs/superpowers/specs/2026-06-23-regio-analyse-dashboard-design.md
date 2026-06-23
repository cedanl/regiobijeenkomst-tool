# Regio-analyse & presentatie-dashboard — Design

**Datum:** 2026-06-23
**Status:** Ontwerp ter review
**Appetite:** Medium (3-4 dagen)

## Doel & context

In vier regiobijeenkomsten (Arnhem, Breda, Utrecht, Zwolle) zijn tientallen
kansen en uitdagingen opgehaald rond datagedreven werken in het onderwijs, met
stemmen/prioritering, en daaruit zijn zo'n 15 use cases uitgewerkt. Die oogst
zit nu versnipperd in vier losse `state.json`-recaps. We willen die eenduidig en
overzichtelijk terugpresenteren aan onderwijsinstellingen, zodat we samen 2 à 3
use cases kunnen kiezen om in co-creatie uit te werken.

De oplossing: één analyse-/presentatiepagina met **twee datavisualisaties** plus
een **1-A4 verslag**:

1. **Kansen & inzichten** met stemmen/prioriteit — "welke behoeften leven er?"
2. **Use cases** — overzicht om in gesprek de co-creatie-kandidaten te kiezen.
3. **1-A4 verslag** — een AI-gegenereerd, bewerkbaar managementverslag (via de
   Claude API), eveneens naar PDF te exporteren.

## Gebruik

- **Live** op scherm tijdens het gesprek met een instelling (interactief: filteren).
- **Export** als PDF voor in een deck of mail — via print-stylesheet + "Opslaan als PDF".

Eén pagina dekt beide: de live filterstand "bevriest" simpelweg in de PDF.

## Databron & regio-mapping

Bron = de gemergede recap-`state.json` per kamer in `RECAP_DIR` (productie:
`/data/recaps`), dezelfde bestanden die `/admin/recaps` toont. De vier relevante
sessiecodes:

| `roomCode` | Regio |
|---|---|
| `HRQT` | Arnhem |
| `WTEL` | Breda |
| `PUXD` | Utrecht |
| `MDRH` | Zwolle |

De regio-map is **configureerbaar en bewerkbaar in de admin-UI** (zie
*Regio-beheer*), niet hardgecodeerd. De vier codes hierboven zijn de **defaults**
waarmee de config bij eerste gebruik wordt geseed. De map doet bewust dubbel
werk: hij bepaalt zowel **welke kamers** meedoen in de analyse (curatie —
`RECAP_DIR` bevat óók losse/ephemere workshopkamers die we níet willen
meetellen) als hun **regiolabel** en **weergavevolgorde**. Een kamer die niet in
de map staat, doet niet mee; je voegt 'm toe via de editor.

## Regio-beheer (configureerbaar)

De regio-map wordt opgeslagen als JSON op de recaps-volume
(`<RECAP_DIR>/regios.json`), zodat hij deploys overleeft. Gedrag:

- **Seeden:** ontbreekt het bestand, dan gebruikt de server de vier ingebakken
  defaults én schrijft die als startpunt weg. Daarna is dat bestand de bron van
  waarheid (ook als het minder dan vier regio's bevat).
- **Lezen:** per request, zodat wijzigingen meteen doorwerken zonder herstart.
- **Bewerken (admin-UI):** een "Regio's beheren"-paneel op de analyse-pagina
  toont de huidige map (code → label, op volgorde) met toevoegen / hernoemen /
  verwijderen. Opslaan gaat via `POST /admin/regios` (zelfde basic-auth); de
  pagina herlaadt daarna de data.
- **Validatie:** code moet voldoen aan `ROOM_CODE_RE` (`[A-Z0-9]{3,16}`), label
  niet-leeg. Dubbele code = label overschrijven (upsert). De server schrijft
  **atomisch** (temp-bestand + rename) zodat een halve schrijfactie het bestand
  niet corrumpeert.
- **Ontdekken:** het paneel toont óók de kamercodes die wél recap-data op schijf
  hebben maar (nog) niet in de map staan, als suggesties om toe te voegen — zo
  vind je nieuwe sessies zonder de codes uit het hoofd te kennen.

> Dit is de zwaarste van de overwogen opties; het past in de timebox maar zit aan
> de bovenkant. Wordt het krap, dan is de *Ontdekken*-suggestielijst het eerste
> dat kan vervallen (codes handmatig intikken blijft mogelijk).

## Datapijplijn

**Per kamer → canonieke staat.** `state.json` bevat `participants{userId:
{savedAt, state}}`. Omdat de sync convergeert zijn de snapshots grotendeels
gelijk, maar we mergen defensief zodat een gedeeltelijke save niets sloopt:
- `insights[]`: union op `id` over alle deelnemers; per inzicht de `votes{}`
  samenvoegen (per `userId` de hoogste count).
- `cases{}`: union op `insightId`; bij conflict de meest recente (`_ts`).
- De **regio** van álle items uit een kamer = de regio van die kamer (niet
  afgeleid uit het inzicht zelf).

**Over regio's heen → twee datasets.** "Samenvoegen" = **poolen** van alle
regio's in één overzicht; géén tekst-dedup. Identieke behoeften in andere
woorden blijven dus aparte items, elk met hun eigen regio-label. (Semantisch
clusteren is bewust buiten scope — zie *Buiten scope*.)

- **Viz 1 (inzichten):** lijst van inzichten met
  `{ id, type, rol, tekst, regio, totaalStemmen, aantalStemmers }`.
  `totaalStemmen` = som van `votes{}`-waarden; `aantalStemmers` = aantal
  `userId`'s in `votes{}`.
- **Viz 2 (use cases):** lijst van `cases` gekoppeld aan hun inzicht →
  `{ insightId, doel, actoren, resultaat, ai_data, type, rol, regio, totaalStemmen }`.
  Een use case erft type/rol/stemmen van het bijbehorende inzicht; de regio komt
  van de kamer.

## Route & beveiliging

- Nieuwe route `GET /admin/analyse`, achter de bestaande `requireAdmin`
  basic-auth (503 als `ADMIN_PASSWORD` ontbreekt) — consistent met `/admin/recaps`.
- Nieuwe route `POST /admin/verslag` (zelfde basic-auth) die het AI-verslag
  genereert via de Claude API en de tekst teruggeeft als JSON.
- Nieuwe route `POST /admin/regios` (zelfde basic-auth) die de bewerkte regio-map
  valideert en atomisch wegschrijft naar `<RECAP_DIR>/regios.json`.
- Linkje vanaf `/admin/recaps` naar het dashboard.
- Server leest + aggregeert, serveert dan een **aparte pagina** `app/analyse.html`
  met de data inline ingespoten als JSON (zelfde patroon als de hoofdpagina:
  inline `<script>`/`<style>`). Houdt `server.js` slank en de pagina onderhoudbaar.
- CSP moet de inline JS/CSS van deze pagina toestaan (hergebruik het beleid van de
  hoofdpagina). CSP staat in **zowel** `server.js` als `docker/Caddyfile` — beide
  bijwerken indien nodig.

## Visualisatie 1 — Kansen & inzichten (treemap + rol-kolommen)

Eén pagina-sectie, twee onderdelen op dezelfde filters:

- **Overzicht (treemap-achtig):** alle inzichten als blokken, **grootte ∝
  stemmen**, **kleur = type** (kans = blauw, uitdaging = oranje), met regio- en
  rol-label per blok. In pure HTML/CSS wordt dit een **flex-grid van blokken met
  grootte naar stemmen** (geen echte squarified treemap — geen lib, blijft binnen
  de timebox; vlakverhoudingen zijn benaderend).
- **Uitsplitsing per rol:** drie kolommen (praktijk / aansturing / ondersteuning),
  elk gerangschikt op stemmen, met staafjes.
- **KPI-koptekst:** #regio's, #inzichten, #stemmen, #deelnemers.

## Visualisatie 2 — Use cases (kaartraster + shortlist)

- **Kaartraster:** één kaart per use case met doel / actoren / resultaat /
  AI&data, plus regio-label, rol-tag en prioriteit (stemmen) als badge.
- **Sortering:** op prioriteit (stemmen) aflopend.
- **Shortlist-markering (★):** klik markeert een kaart als co-creatie-kandidaat,
  handig om live samen 2-3 te kiezen. Opgeslagen in **localStorage** van de
  admin-pagina (blijft lokaal in de browser; raakt de gedeelde recap-data niet).

## Visualisatie 3 — 1-A4 verslag (AI-gegenereerd, bewerkbaar)

Een bondig managementverslag op één A4, bedoeld om naast de visualisaties mee te
sturen of in een deck te plakken.

- **Generatie (server-side):** een "Genereer verslag"-actie roept een nieuwe
  admin-route aan; de server bouwt dezelfde geaggregeerde dataset (KPI's +
  top-behoeften + use cases) en stuurt die in **één** `messages.create`-call naar
  de Claude API met een Nederlandse instructie ("schrijf een bondig 1-A4
  managementverslag: inleiding, belangrijkste behoeften, advies over
  kandidaat-use-cases"). De API-key blijft server-side (Fly-secret
  `ANTHROPIC_API_KEY`) — komt nooit in de browser.
- **Model & call:** `claude-opus-4-8`, adaptive thinking aan, `max_tokens` ruim
  genoeg voor één A4 (~4000). Officiële SDK `@anthropic-ai/sdk`. Niet-streaming
  (korte output). Lage volumes (admin-only), dus geen caching nodig.
- **Bewerkbaar vóór export:** het gegenereerde verslag verschijnt in
  `contenteditable`-velden; wijzigingen worden in **localStorage** bewaard zodat
  je het kunt bijschaven vóór de PDF-export. Een "opnieuw genereren"-knop haalt
  een verse versie op (overschrijft na bevestiging).
- **Graceful fallback:** is `ANTHROPIC_API_KEY` niet gezet, dan toont de pagina
  in plaats van het AI-verslag een **getemplate feitelijke samenvatting** (KPI's
  + top-lijsten zonder narratief). Het dashboard blijft dus altijd werken.

## Filters

Eén filterbalk bovenaan stuurt **beide** visualisaties: **regio** (incl. "alle"),
**type** (kans/uitdaging), **rol** (praktijk/aansturing/ondersteuning). Use cases
erven type/rol van hun inzicht, dus dezelfde filters werken daar ook.

## Export (print → PDF)

Knop "Opslaan als PDF" roept `window.print()` aan. Een print-stylesheet verbergt
de filterbalk/knoppen en zet beide visualisaties netjes onder elkaar op de
pagina. De op dat moment actieve filterstand bepaalt wat geëxporteerd wordt.

## Randgevallen

- **Geen/lege data of geen recap-storage:** nette lege staat ("nog geen recaps").
- **Inzicht met 0 stemmen:** wordt getoond (kleinste blok / onderaan kolom).
- **Verweesde use case** (inzicht verwijderd): tonen onder "onbekend inzicht";
  regio/inhoud komen van de kamer, type/rol/stemmen tonen "—".
- **Gedeeltelijke deelnemer-saves:** opgevangen door de union-merge.
- **Kamer niet in de map:** doet niet mee in de analyse (curatie); verschijnt wel
  als toevoeg-suggestie in het regio-beheer-paneel.
- **Regio verwijderd terwijl er nog recaps zijn:** die kamer valt simpelweg uit de
  analyse; de recap-bestanden op schijf blijven onaangeroerd.
- **`regios.json` ontbreekt of is corrupt:** val terug op de vier defaults (en
  seed het bestand opnieuw bij ontbreken).

## Testen

Playwright-test (in lijn met de bestaande preflight): vul een tijdelijke
`RECAP_DIR` met 2-3 nep-kamers (geldige `ROOM_CODE_RE`) met bekende
inzichten/stemmen/cases, start de server met `ADMIN_PASSWORD` gezet, doe
`GET /admin/analyse` met basic-auth en controleer de aggregaten: aantal
inzichten, totaal stemmen, top-inzicht, en het aantal use-case-kaarten. Voeg een
kamer toe die níet in de regio-map staat en bevestig dat die wordt uitgesloten
(curatie); optioneel: `POST /admin/regios` om 'm toe te voegen en bevestig dat hij
dan wél meetelt.

## Buiten scope (YAGNI)

- Semantisch/AI-clusteren van vergelijkbare inzichten (de gekozen aanpak is
  "groeperen op bestaande velden").
- Handmatige redactie/samenvoegen van inzichten in de tool.
- Prioriteringsmatrix met haalbaarheid-as (vereist handmatig scoren — niet in data).
- Echte squarified treemap / charting-library (CSP + build-stap).
- Persistente shortlist gedeeld tussen gebruikers (blijft localStorage).

## Bestanden die raken

- `app/server.js` — nieuwe routes `/admin/analyse` + `POST /admin/verslag` +
  `POST /admin/regios`, helpers (kamers lezen, canoniek maken, aggregeren,
  regio-map lezen/seeden/atomisch schrijven), Claude-API-call, link vanaf
  `/admin/recaps`.
- `app/analyse.html` — nieuwe pagina (filters, beide visualisaties, 1-A4 verslag,
  regio-beheer-paneel, print-CSS).
- `app/package.json` — nieuwe dependency `@anthropic-ai/sdk`.
- `docker/Caddyfile` — CSP gelijktrekken indien nodig.
- `tests/` — Playwright-test voor `/admin/analyse` (+ regio-map-curatie).

**Nieuw configbestand:** `<RECAP_DIR>/regios.json` — bewerkbaar via de admin-UI;
geseed met de vier defaults bij ontbreken.

**Nieuwe env var:** `ANTHROPIC_API_KEY` (Fly-secret) — optioneel; zonder de key
valt het verslag terug op de getemplate samenvatting.
