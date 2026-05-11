// CEDA Regiobijeenkomst — Node.js server
// Serveert de workshop-app + WebSocket relay voor live samenwerking.

import express from 'express';
import { WebSocketServer } from 'ws';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const RECAP_DIR = process.env.RECAP_DIR || path.join(__dirname, 'recaps');
const ROOM_CODE_RE = /^[A-Z0-9]{3,16}$/;

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

// Health check
app.get('/healthz', (req, res) => res.json({ ok: true, rooms: rooms.size }));

// Stats endpoint (read-only — only counts, no content)
app.get('/api/stats', (req, res) => {
  const stats = [...rooms.entries()].map(([code, peers]) => ({
    room: code,
    peers: peers.size
  }));
  res.json({ rooms: stats, total: rooms.size });
});

// Opt-in central harvest. Each participant POSTs their own state from the
// recap stage. Files land in RECAP_DIR/<roomCode>/<userId>.json — re-saves
// from the same participant overwrite their previous file (latest wins).
app.post('/api/recap', express.json({ limit: '512kb' }), async (req, res) => {
  const body = req.body;
  if (!body || typeof body !== 'object') {
    return res.status(400).json({ ok: false, error: 'invalid body' });
  }
  const room = String(body.roomCode || '').trim().toUpperCase();
  const userId = String(body.userId || '').trim();
  if (!ROOM_CODE_RE.test(room)) {
    return res.status(400).json({ ok: false, error: 'invalid roomCode' });
  }
  if (!/^[a-z0-9_]{3,40}$/.test(userId)) {
    return res.status(400).json({ ok: false, error: 'invalid userId' });
  }
  const dir = path.join(RECAP_DIR, room);
  const file = path.join(dir, `${userId}.json`);
  const record = {
    savedAt: new Date().toISOString(),
    state: body
  };
  try {
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(file, JSON.stringify(record, null, 2), 'utf8');
    res.json({ ok: true, savedAt: record.savedAt });
  } catch (err) {
    console.error('recap save failed', err);
    res.status(500).json({ ok: false, error: 'storage failure' });
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
