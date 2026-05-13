// CEDA Regiobijeenkomst — Node.js server
// Serveert de workshop-app + WebSocket relay voor live samenwerking.

import express from 'express';
import { WebSocketServer } from 'ws';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const RECAP_DIR = process.env.RECAP_DIR || path.join(__dirname, '..', 'data', 'recaps');
const ROOM_CODE_RE = /^[A-Z0-9]{3,16}$/;
const USER_ID_RE = /^[A-Za-z0-9_-]{3,40}$/;
const ADMIN_USER = process.env.ADMIN_USER || 'ceda';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';

// Probe at boot so a misconfigured volume fails fast instead of silently
// breaking every save during a live workshop. Result is exposed via /healthz.
let recapStorageOk = false;
let recapStorageError = null;
async function probeRecapStorage() {
  try {
    await fs.mkdir(RECAP_DIR, { recursive: true });
    const probe = path.join(RECAP_DIR, '.write-probe');
    await fs.writeFile(probe, String(Date.now()));
    await fs.unlink(probe);
    recapStorageOk = true;
    console.log(`[recap] storage OK at ${RECAP_DIR}`);
  } catch (err) {
    recapStorageOk = false;
    recapStorageError = `${err.code || 'ERR'}: ${err.message}`;
    console.error(`[recap] FATAL: ${RECAP_DIR} is not writable —`, err);
  }
}

const app = express();

// ---- Security headers ----
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdnjs.cloudflare.com",
      "font-src 'self' data: https://fonts.gstatic.com https://cdnjs.cloudflare.com",
      "connect-src 'self' ws: wss:",
      "img-src 'self' data:",
      "object-src 'none'",
      "base-uri 'self'",
      "frame-ancestors 'none'"
    ].join('; ')
  );
  next();
});

// ---- Static assets ----
app.use(
  express.static(__dirname, {
    index: 'ceda-workshop.html',
    extensions: ['html'],
    maxAge: '5m',
    setHeaders(res, filePath) {
      if (filePath.endsWith('.html')) {
        res.setHeader('Cache-Control', 'no-cache');
      }
    }
  })
);

// Health check — fails non-200 if recap storage is unavailable, so the
// orchestrator (Fly health checks) notices a broken volume mount.
app.get('/healthz', (req, res) => {
  const ok = recapStorageOk;
  res.status(ok ? 200 : 503).json({
    ok,
    rooms: rooms.size,
    recapStorage: ok ? 'ok' : recapStorageError || 'unknown'
  });
});

// Stats endpoint (read-only — only counts, no content)
app.get('/api/stats', (req, res) => {
  const stats = [...rooms.entries()].map(([code, peers]) => ({
    room: code,
    peers: peers.size
  }));
  res.json({ rooms: stats, total: rooms.size });
});

// Per-room write serialization. Each /api/recap call chains itself behind
// the previous write for the same room, so read-modify-write on
// state.json never races. Different rooms run in parallel.
const roomLocks = new Map(); // roomCode → Promise (most recent write chain)

function withRoomLock(room, fn) {
  const prev = roomLocks.get(room) || Promise.resolve();
  const next = prev.catch(() => {}).then(fn);
  roomLocks.set(room, next);
  next.finally(() => {
    if (roomLocks.get(room) === next) roomLocks.delete(room);
  });
  return next;
}

// Periodic central harvest. Each participant POSTs their full state from
// the workshop (debounced + heartbeat from the client). The server merges
// per-userId into RECAP_DIR/<room>/state.json under a per-room mutex.
// Write is staged via *.tmp + rename so a crash mid-write never replaces
// the previous good save with a truncated one.
app.post('/api/recap', express.json({ limit: '512kb' }), async (req, res) => {
  if (!recapStorageOk) {
    return res.status(503).json({ ok: false, error: 'storage unavailable' });
  }
  const body = req.body;
  if (!body || typeof body !== 'object') {
    return res.status(400).json({ ok: false, error: 'invalid body' });
  }
  const room = String(body.roomCode || '').trim().toUpperCase();
  const userId = String(body.userId || '').trim();
  if (!ROOM_CODE_RE.test(room)) {
    return res.status(400).json({ ok: false, error: 'invalid roomCode' });
  }
  if (!USER_ID_RE.test(userId)) {
    return res.status(400).json({ ok: false, error: 'invalid userId' });
  }

  try {
    const savedAt = await withRoomLock(room, async () => {
      const dir = path.join(RECAP_DIR, room);
      const file = path.join(dir, 'state.json');
      await fs.mkdir(dir, { recursive: true });

      let merged;
      try {
        const raw = await fs.readFile(file, 'utf8');
        merged = JSON.parse(raw);
        if (!merged || typeof merged !== 'object' || !merged.participants) {
          throw new Error('malformed state.json');
        }
      } catch (err) {
        if (err.code !== 'ENOENT' && !(err instanceof SyntaxError) && err.message !== 'malformed state.json') {
          throw err;
        }
        merged = {
          roomCode: room,
          createdAt: new Date().toISOString(),
          participants: {}
        };
      }

      const now = new Date().toISOString();
      merged.updatedAt = now;
      merged.participants[userId] = { savedAt: now, state: body };

      const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
      await fs.writeFile(tmp, JSON.stringify(merged, null, 2), 'utf8');
      await fs.rename(tmp, file);
      return now;
    });
    res.json({ ok: true, savedAt });
  } catch (err) {
    console.error('[recap] save failed', {
      room, userId, code: err.code, message: err.message
    });
    res.status(500).json({ ok: false, error: 'storage failure' });
  }
});

// Admin endpoints: list and download saved recaps. Basic auth — set
// ADMIN_PASSWORD as a Fly secret. If unset, the routes refuse every
// request rather than running open.
function requireAdmin(req, res, next) {
  if (!ADMIN_PASSWORD) {
    return res.status(503).send('Admin endpoint disabled (set ADMIN_PASSWORD).');
  }
  const auth = req.headers.authorization || '';
  const expected = 'Basic ' + Buffer.from(`${ADMIN_USER}:${ADMIN_PASSWORD}`).toString('base64');
  const a = Buffer.from(auth);
  const b = Buffer.from(expected);
  const ok = a.length === b.length && crypto.timingSafeEqual(a, b);
  if (!ok) {
    res.set('WWW-Authenticate', 'Basic realm="recaps"');
    return res.status(401).send('Authentication required');
  }
  next();
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

app.get('/admin/recaps', requireAdmin, async (req, res) => {
  let rooms = [];
  try {
    rooms = (await fs.readdir(RECAP_DIR, { withFileTypes: true }))
      .filter(d => d.isDirectory() && ROOM_CODE_RE.test(d.name))
      .map(d => d.name)
      .sort();
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  const sections = [];
  for (const room of rooms) {
    const dir = path.join(RECAP_DIR, room);
    let files;
    try {
      files = await fs.readdir(dir);
    } catch { continue; }
    const jsons = files.filter(f => f.endsWith('.json'));
    if (!jsons.length) continue;
    const items = [];
    for (const f of jsons) {
      const stat = await fs.stat(path.join(dir, f)).catch(() => null);
      if (!stat) continue;
      let saved = null;
      let userName = null;
      try {
        const parsed = JSON.parse(await fs.readFile(path.join(dir, f), 'utf8'));
        saved = parsed.savedAt;
        userName = parsed.state?.userName;
      } catch {}
      items.push({ file: f, size: stat.size, mtime: stat.mtime, saved, userName });
    }
    items.sort((a, b) => (b.mtime > a.mtime ? 1 : -1));
    sections.push({ room, items });
  }

  const html = `<!doctype html>
<html lang="nl"><head>
<meta charset="utf-8">
<title>Recaps · CEDA Regiobijeenkomst</title>
<style>
  :root { color-scheme: light; }
  body { font: 15px/1.5 -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 960px; margin: 32px auto; padding: 0 24px; color: #1a1a1a; }
  h1 { font-size: 22px; margin: 0 0 8px; }
  .lede { color: #666; margin: 0 0 32px; }
  .room { border: 1px solid #ddd; border-radius: 8px; padding: 16px 20px; margin-bottom: 16px; background: #fafafa; }
  .room h2 { margin: 0 0 12px; font-size: 16px; font-family: ui-monospace, SFMono-Regular, Meno, monospace; letter-spacing: 1px; }
  .room .meta { color: #777; font-size: 13px; margin-left: 8px; font-family: -apple-system, sans-serif; letter-spacing: 0; }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid #eee; font-size: 14px; }
  th { color: #666; font-weight: 600; font-size: 12px; text-transform: uppercase; letter-spacing: .5px; }
  a { color: #0a58ca; text-decoration: none; }
  a:hover { text-decoration: underline; }
  .empty { color: #888; font-style: italic; padding: 24px; text-align: center; background: #fafafa; border-radius: 8px; }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
</style>
</head><body>
<h1>Recaps · CEDA Regiobijeenkomst</h1>
<p class="lede">Per bijeenkomst (sessiecode) zie je hieronder welke deelnemers hun oogst centraal hebben opgeslagen. Klik op een bestand om de JSON te downloaden.</p>
${sections.length === 0
  ? `<p class="empty">Nog geen recaps opgeslagen.</p>`
  : sections.map(s => `
<section class="room">
  <h2>${escapeHtml(s.room)} <span class="meta">${s.items.length} deelnemer${s.items.length === 1 ? '' : 's'}</span></h2>
  <table>
    <thead><tr><th>Deelnemer</th><th>Opgeslagen</th><th>Grootte</th><th>Bestand</th></tr></thead>
    <tbody>
    ${s.items.map(i => `<tr>
      <td>${escapeHtml(i.userName || '—')}</td>
      <td>${escapeHtml(i.saved ? new Date(i.saved).toLocaleString('nl-NL') : '—')}</td>
      <td>${(i.size / 1024).toFixed(1)} KB</td>
      <td><a href="/admin/recaps/${encodeURIComponent(s.room)}/${encodeURIComponent(i.file)}"><code>${escapeHtml(i.file)}</code></a></td>
    </tr>`).join('')}
    </tbody>
  </table>
</section>`).join('')}
</body></html>`;
  res.set('Content-Type', 'text/html; charset=utf-8');
  res.set('Cache-Control', 'no-store');
  res.send(html);
});

app.get('/admin/recaps/:room/:file', requireAdmin, async (req, res) => {
  const room = String(req.params.room).toUpperCase();
  const file = String(req.params.file);
  if (!ROOM_CODE_RE.test(room)) return res.status(400).send('invalid room');
  if (!/^[A-Za-z0-9_-]{3,40}\.json$/.test(file)) return res.status(400).send('invalid file');
  const full = path.join(RECAP_DIR, room, file);
  // Defense-in-depth: ensure the resolved path stays under RECAP_DIR.
  const resolved = path.resolve(full);
  if (!resolved.startsWith(path.resolve(RECAP_DIR) + path.sep)) {
    return res.status(400).send('invalid path');
  }
  try {
    const data = await fs.readFile(resolved);
    res.set('Content-Type', 'application/json');
    res.set('Content-Disposition', `attachment; filename="${room}_${file}"`);
    res.send(data);
  } catch (err) {
    if (err.code === 'ENOENT') return res.status(404).send('not found');
    throw err;
  }
});

// Default → index
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'ceda-workshop.html'));
});

const server = http.createServer(app);

// ---- WebSocket relay ----
const wss = new WebSocketServer({ server, path: '/ws' });
const rooms = new Map(); // roomCode → Set<WebSocket>

function broadcastToRoom(room, sender, data) {
  const peers = rooms.get(room);
  if (!peers) return;
  // Force a text frame: clients parse e.data as a string. Without this, ws
  // sends a Buffer as a binary frame and the browser receives a Blob.
  for (const peer of peers) {
    if (peer !== sender && peer.readyState === peer.OPEN) {
      try { peer.send(data, { binary: false }); } catch {}
    }
  }
}

wss.on('connection', (ws, req) => {
  let room = null;
  try {
    const url = new URL(req.url, 'http://localhost');
    room = (url.searchParams.get('room') || '').trim().toUpperCase();
  } catch {}
  if (!ROOM_CODE_RE.test(room)) {
    ws.close(1008, 'Invalid room code');
    return;
  }

  if (!rooms.has(room)) rooms.set(room, new Set());
  const peers = rooms.get(room);
  peers.add(ws);

  ws.on('message', (data, isBinary) => {
    if (isBinary) return; // we expect JSON
    if (data.length > 64 * 1024) return; // 64KB per message max
    broadcastToRoom(room, ws, data);
  });

  // Heartbeat: server pings every 30s, client must pong
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('close', () => {
    peers.delete(ws);
    if (peers.size === 0) rooms.delete(room);
  });
  ws.on('error', () => { /* swallow — connection will close */ });
});

// Heartbeat ticker
const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.isAlive === false) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    try { ws.ping(); } catch {}
  }
}, 30000);

wss.on('close', () => clearInterval(heartbeat));

// ---- Start ----
await probeRecapStorage();
server.listen(PORT, HOST, () => {
  const url = `http://localhost:${PORT}`;
  console.log('');
  console.log('  ╔══════════════════════════════════════════════════════════╗');
  console.log('  ║   CEDA Regiobijeenkomst — workshop-server gestart        ║');
  console.log('  ╚══════════════════════════════════════════════════════════╝');
  console.log('');
  console.log(`    URL:  ${url}`);
  console.log(`    WS:   ws://localhost:${PORT}/ws?room=<CODE>`);
  console.log('');
  console.log('    Stop met Ctrl+C.');
  console.log('');
});

// Graceful shutdown
function shutdown() {
  console.log('\n  Server stoppen...');
  clearInterval(heartbeat);
  for (const ws of wss.clients) ws.close(1001, 'Server shutting down');
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
