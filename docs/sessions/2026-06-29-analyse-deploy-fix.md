# 2026-06-29 — Analyse-feature naar productie (+ Dockerfile-fix)

Eerste deploy van het analyse-dashboard (PR #14, gemerged 23 juni) naar Fly
(`ceda-regiobijeenkomst`). Tegelijk `ANTHROPIC_API_KEY` als Fly-secret gezet
zodat het 1-A4-verslag een echt AI-verslag is i.p.v. de getemplate fallback.

## Incident: productie crashte op de eerste deploy
De eerste `fly deploy` haalde productie onderuit (machine crash-loopte tot
max restart count, 502 op alle routes). Oorzaak:

```
Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/app/analyse-lib.mjs'
imported from /app/server.js
```

`docker/Dockerfile` kopieerde alleen `server.js` + `ceda-workshop.html`. De
analyse-feature voegde twee runtime-bestanden toe die nooit aan de COPY-regel
zijn toegevoegd:
- `app/analyse-lib.mjs` — `import` in server.js (regel 11) → crash bij start
- `app/analyse.html` — `fs.readFile` in server.js (regel 426) → zou /admin/analyse breken

Fix: beide bestanden toegevoegd aan de `COPY`-regel in `docker/Dockerfile`.
Tweede deploy was groen; `/admin/analyse` geeft nu 401 (was 404), healthz ok.

## Les
De Playwright-preflight (`npm test`) draait tegen de **bronmap**, niet tegen de
**image** — een ontbrekend `COPY`-bestand glipt er dus doorheen. Bij het
toevoegen van nieuwe runtime-bestanden (`.mjs`/`.html` die server.js importeert
of inleest): check altijd `docker/Dockerfile` regel 12.
