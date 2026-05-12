# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```
cd app && npm install
cd app && npm start             # node server.js  (PORT=3000, HOST=0.0.0.0)
cd app && npm run dev           # node --watch server.js
caddy run --config docker/Caddyfile   # optional HTTPS frontend on :8443 → proxies to :3000
```

No lint, no test, no build step — the frontend ships as-is. Inspect a running server via `GET /healthz` and `GET /api/stats`. Opt-in central harvest at `POST /api/recap` (stores `<RECAP_DIR>/<room>/<userId>.json`; default lokaal `./data/recaps/`, productie `/data/recaps`).

Admin browse-UI at `GET /admin/recaps` lists saved recaps with per-file download links. Basic-auth via `ADMIN_USER` (default `ceda`) and `ADMIN_PASSWORD`; if `ADMIN_PASSWORD` is unset the route refuses every request rather than running open.

Production deploy: `docker/Dockerfile` + `fly.toml` (root) target Fly.io regio `ams` with a `recaps` volume mounted at `/data`. Build vanaf repo-root: `docker build -f docker/Dockerfile .`; deploy: `fly deploy`. `fly.toml` moet in build-context root staan — Fly resolveert `dockerfile` relatief aan zijn eigen locatie.

## Architecture

A **two-file app** in `app/`: `server.js` + `ceda-workshop.html`. No framework, no bundler, no database. Most changes touch both files — treat them as a pair.

Repo-layout:
- `app/` — applicatiecode (server + frontend + npm-manifest + macOS launcher)
- `docker/` — Dockerfile, entrypoint, fly.toml, Caddyfile
- `docs/` — documentatie en sessieverslagen
- `data/` — lokale recap-opslag (gitignored)

### `server.js` — Express + WebSocket relay
- Serves the single HTML page with strict CSP / security headers.
- WebSocket at `/ws?room=<CODE>` is a **pure relay**: it never inspects, persists, or logs payloads. All "server state" is `rooms: Map<roomCode, Set<WebSocket>>` in memory — a room is created on first join, deleted when empty.
- Validation is intentionally minimal: room code `[A-Z0-9]{3,16}`, payload ≤ 64 KB, binary frames dropped. Heartbeat ping every 30s terminates dead peers.
- The relay forwards each message to every *other* peer in the room — the sender never gets an echo, so it must apply its own op locally before broadcasting.

### `ceda-workshop.html` — single-file frontend (~3900 lines)
- All UI, state, persistence (localStorage), and sync logic live in one embedded `<script>`.
- The `state` object is the single source of truth (`roomCode`, `userId`, `role`, `insights[]`, `selectedCases[]`, votes, …); `saveState()` / `loadState()` persist it.
- Sync is **op-based**, not state-based. `broadcast(op)` sends, `applyRemoteOp(opMsg, peerId)` receives. Current ops:
  - `insight:add`, `insight:remove`
  - `vote:set`
  - `selection:set`
  - `typing:focus`, `text:patch` (positional diff via `textDiff` / `applyTextPatch`)
  - initial state-sync handshake via `mergeRemoteState`
- `wsUrl(code)` derives `ws:` / `wss:` from page origin; `joinSessionRoom` auto-reconnects on close.
- Workshop stages are driven by `state.stage` + `goTo(stage)`, each with its own `render*` function (`renderInspire`, `renderExplore`, `renderPrioritize`, `renderCases`, `renderRecap`); `rerender()` re-runs the active one.

### Rules of thumb
- New collaborative feature → define a new `op:` type, broadcast it from the actor, handle it in `applyRemoteOp`. Do **not** add server-side handling — keep the relay dumb.
- The Node process is fungible: restarting it disconnects clients, they auto-rejoin and re-sync via the handshake.
- CSP lives in **both** `app/server.js` and `docker/Caddyfile` — change it in both, since either may serve the page.

## Conventions
- ES modules, Node ≥ 18.
- User-facing strings (UI, console banner, even most code comments) are in Dutch — keep them Dutch.
- `app/Start Workshop.command` is the macOS double-click launcher end-users actually use; edit carefully.
