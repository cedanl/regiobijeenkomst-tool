# 2026-05-18 — Frontend vervangen door versie uit Downloads

## Wat
`app/ceda-workshop.html` volledig vervangen door de lokale download uit `C:\Users\eddef\Downloads\ceda-workshop.html`. Bestand kromp van 3910 → 3799 regels (−111). Server (`server.js`, CSP, endpoints) ongewijzigd.

## Waarom
Gebruiker had elders een aangepaste versie van de single-page workshop staan en wilde die in productie. Geen specifiek issue — directe broncode-swap.

## Smoke test (lokaal, `PORT=3001`)
- `GET /healthz` → `{ok:true, rooms:0, recapStorage:"ok"}`.
- `/#howitworks` rendert: alle vier de fases (Verkennen / Prioriteren / Use cases / Recap) en de join-UI.
- Host startte sessie `AWNQ`; guest joinde in isolated browser context → `/api/stats` toonde `peers:2`.
- Op-sync: kans "Smoke-test inzicht van host" toegevoegd op host, verscheen in guest's `localStorage.ceda-workshop-v2.insights` via de WS-relay.
- Console: alleen `/favicon.ico` 404 (harmless), geen CSP-violations, FontAwesome + Google Fonts laden.

## Hoe
1. `cp /mnt/c/Users/eddef/Downloads/ceda-workshop.html app/ceda-workshop.html`.
2. Server-start op `:3000` faalde (port in gebruik door Open WebUI), uitgeweken naar `PORT=3001`.
3. Smoke test via `chrome-devtools-mcp` (twee tabs, isolated contexts voor host/guest).
4. `git commit` → `fly deploy`. Tijdens rolling update toonde Fly een "not listening on :3000" warning — fout-positief tijdens de oude machine-shutdown; logs daarna `[recap] storage OK` + healthcheck passing.
5. Verificatie productie: `curl https://ceda-regiobijeenkomst.fly.dev/ | wc -l` → `3799`, `/healthz` → `ok`.

## Commits
- `28ee6d5` feat(workshop): vervang frontend met versie uit Downloads

Gepusht naar `origin/main`. Deployed naar `ceda-regiobijeenkomst.fly.dev`.

## Open
- Niet alle workshop-stages handmatig doorlopen — sync getest op `insight:add` (Fase 1) maar niet op `vote:set`, `selection:set`, `text:patch`. Bij regressies in latere fases: bekende kandidaten zijn de op-handlers in `applyRemoteOp`.
