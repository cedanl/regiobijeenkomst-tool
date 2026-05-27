# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.


## Commands

```
cd app && npm install
cd app && npm start             # node server.js  (PORT=3000, HOST=0.0.0.0)
cd app && npm run dev           # node --watch server.js
caddy run --config docker/Caddyfile   # optional HTTPS frontend on :8443 → proxies to :3000
```

### Environment variables

| Env var | Default | Effect |
|---|---|---|
| `PORT` / `HOST` | `3000` / `0.0.0.0` | server bind |
| `RECAP_DIR` | `./data/recaps` (prod: `/data/recaps`) | recap storage root |
| `ADMIN_USER` | `ceda` | basic-auth user for `/admin/recaps` |
| `ADMIN_PASSWORD` | unset → admin route returns 503 | basic-auth password (required to enable admin UI) |

No lint, no build step. Eén Playwright-regressietest draait via `cd app && npm test` en bevestigt dat een rol-pick state.json op disk schrijft via `/api/recap`. Loopt automatisch op elke PR + push-naar-main via `.github/workflows/test.yml`, en blijft **verplichte preflight vóór `fly deploy`** (deploy gaat buiten GH om). Eerste keer lokaal: `npx playwright install chromium`. Voor alles wat die test niet dekt (multi-peer sync, andere ops) blijft de UI-smoke-test via browser nodig (host + join uit tweede tab, sync een op). Inspect a running server via `GET /healthz` and `GET /api/stats`. Periodic central harvest at `POST /api/recap`: each client POSTs its own state (debounce 5s + heartbeat 60s); the server merges per `userId` into `<RECAP_DIR>/<room>/state.json` onder een per-room mutex (default lokaal `./data/recaps/`, productie `/data/recaps`). Legacy `<room>/<userId>.json`-files van vóór deze wijziging blijven leesbaar via de admin-UI onder *"Legacy per-deelnemer-saves"*. The recap directory is created on first write — no need to pre-`mkdir`.

Admin browse-UI at `GET /admin/recaps` lists saved recaps with per-file download links. Basic-auth via `ADMIN_USER` (default `ceda`) and `ADMIN_PASSWORD`; if `ADMIN_PASSWORD` is unset the route returns 503 for every request rather than running open.

`README.md` is the canonical user-facing doc (Dutch, includes the Fly.io secrets setup and the `fly ssh console -C "tar …"` bulk-export recipe for recaps). `INSTRUCTIONS.md` is the shorter command-quickstart. `docs/sessions/<YYYY-MM-DD-topic>.md` is the running session log — read the latest before starting substantive work, and add a new entry for non-trivial changes. `docs/superpowers/{plans,specs}/` holds design docs and implementation plans from prior /superpowers workflows — useful background for re-touching features (folder structure, periodic recap), not load-bearing for new work.

Production deploy: `docker/Dockerfile` + `fly.toml` (root) target Fly.io regio `ams` with a `recaps` volume mounted at `/data`. Build vanaf repo-root: `docker build -f docker/Dockerfile .`; deploy: `fly deploy`. `fly.toml` moet in build-context root staan — Fly resolveert `dockerfile` relatief aan zijn eigen locatie.

## Architecture

A **two-file app** in `app/`: `server.js` + `ceda-workshop.html`. No framework, no bundler, no database. Most changes touch both files — treat them as a pair.

Repo-layout:
- `app/` — applicatiecode (server + frontend + npm-manifest + macOS launcher)
- `docker/` — Dockerfile, entrypoint, Caddyfile (note: `fly.toml` lives in repo-root, not here)
- `docs/` — documentatie en sessieverslagen
- `data/` — lokale recap-opslag (gitignored)

### `server.js` — Express + WebSocket relay
- Serves the single HTML page with strict CSP / security headers.
- WebSocket at `/ws?room=<CODE>` is a **pure relay**: it never inspects, persists, or logs payloads. All "server state" is `rooms: Map<roomCode, Set<WebSocket>>` in memory — a room is created on first join, deleted when empty.
- Validation is intentionally minimal: room code `[A-Z0-9]{3,16}`, payload ≤ 64 KB, binary frames dropped. Heartbeat ping every 30s terminates dead peers.
- The relay forwards each message to every *other* peer in the room — the sender never gets an echo, so it must apply its own op locally before broadcasting.

Endpoints:
- `GET /` → workshop app (`ceda-workshop.html`)
- `GET /healthz` → `{ ok: true, rooms: N }`
- `GET /api/stats` → room + peer counts (no content)
- `POST /api/recap` → merge participant state into `<RECAP_DIR>/<room>/state.json`
- `GET /admin/recaps` → admin browse UI (basic-auth; 503 if `ADMIN_PASSWORD` unset)
- `GET /admin/recaps/:room/:file` → JSON download per recap file
- `WS /ws?room=<CODE>` → relay (broadcast to other peers in the same room)

### `ceda-workshop.html` — single-file frontend
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
