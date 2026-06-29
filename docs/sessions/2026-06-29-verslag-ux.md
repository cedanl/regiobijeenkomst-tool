# 2026-06-29 — Verslag-UX: feedback, Markdown-rendering, langer verslag

Twee gebruikersverzoeken op het analyse-dashboard:
1. Geen feedback bij "Verslag genereren".
2. Verslag hoeft niet beperkt tot 1 A4, en de Markdown werd niet gerenderd.

## Wijzigingen
- **Knop-feedback**: `#btn-verslag` wordt disabled + label "Bezig…" tijdens de
  call; placeholder "Verslag wordt gegenereerd…" in de view; herstel via `finally`.
- **Markdown-rendering**: kleine inline renderer (`mdToHtml`/`mdInline` — koppen,
  vet, lijsten, code) i.p.v. ruwe tekst. Bewust geen CDN-library (strikte CSP +
  two-file-app). View/edit-toggle: gerenderde `#verslag-view` ↔ ruwe-markdown
  `#verslag-edit` textarea; markdown blijft bron van waarheid in localStorage.
- **1-A4 weg**: prompt mag een grondig, meerdere-pagina-verslag schrijven en
  expliciet Markdown gebruiken; label "Verslag (1 A4)" → "Verslag";
  `max_tokens` 4000 → 8000; fallback-verslag kreeg `##`/`###` koppen.

## Review-fixes (high-effort code-review vóór commit)
- **Blanco PDF bij printen-tijdens-bewerken** (hoog): print-knop roept nu
  `exitEditMode()` vóór `window.print()`; regressietest toegevoegd.
- **Dataverlies**: textarea slaat continu op via een `input`-listener (de oude
  contenteditable deed dat per toetsaanslag) — geen verlies bij tab-sluiten.
- **Bewerken-knop-lock-out**: knop is nu altijd zichtbaar (ook zonder verslag
  kun je er handmatig één schrijven).
- **Print-afkapping**: `#verslag` mag in print over pagina's breken
  (`page-break-inside:auto`), de andere secties houden `avoid`.
- **Italic-regex verminkte losse asterisken** ("2 * 3"): `*cursief*` verwijderd,
  alleen `**vet**` blijft.
- Nederlandse diakriet in de prompt hersteld ("2 à 3", "pagina's").

CSP + XSS geverifieerd veilig (esc() vóór tag-injectie; `style-src 'unsafe-inline'`
stond er al). Tests: 32/32 groen.
