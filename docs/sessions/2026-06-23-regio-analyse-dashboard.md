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
