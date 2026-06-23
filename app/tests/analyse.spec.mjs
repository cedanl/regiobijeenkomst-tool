// Server-/browser-tests voor het analyse-dashboard. Spawnt een verse server
// tegen een tmp RECAP_DIR met vaste fixtures + ADMIN_PASSWORD, en test de
// admin-routes (basic-auth) en de pagina.
//
// LET OP testvolgorde: de curatie-test (unmapped TEST1) draait vóór de
// regio-beheer-test die TEST1 toevoegt. Workers=1 → bestandsvolgorde geldt.

import { test, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_DIR = path.resolve(__dirname, '..');
const ADMIN = { username: 'ceda', password: 'test-admin-pw' };
const authHeader = 'Basic ' + Buffer.from(`${ADMIN.username}:${ADMIN.password}`).toString('base64');

test.use({ httpCredentials: ADMIN });

let server, recapDir, port, base;

function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, () => { const p = srv.address().port; srv.close(() => resolve(p)); });
  });
}
function waitForBoot(child) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('server boot timeout')), 10000);
    const onData = (chunk) => {
      if (chunk.toString().includes('workshop-server gestart')) { clearTimeout(timer); child.stdout.off('data', onData); resolve(); }
    };
    child.stdout.on('data', onData);
    child.once('exit', (code) => { clearTimeout(timer); reject(new Error('server exited prematurely, code=' + code)); });
  });
}
async function writeRoom(code, participants) {
  const dir = path.join(recapDir, code);
  await mkdir(dir, { recursive: true });
  const state = { roomCode: code, createdAt: '2026-06-01T10:00:00+02:00', updatedAt: '2026-06-01T11:00:00+02:00', participants: {} };
  for (const [uid, cs] of Object.entries(participants)) state.participants[uid] = { savedAt: '2026-06-01T11:00:00+02:00', state: cs };
  await writeFile(path.join(dir, 'state.json'), JSON.stringify(state, null, 2));
}

test.beforeAll(async () => {
  recapDir = await mkdtemp(path.join(tmpdir(), 'analyse-test-'));
  await writeRoom('HRQT', {
    u1: { insights: [{ id: 'i1', type: 'kans', text: 'Studievoortgang', role: 'praktijk', votes: { u1: 3 } }], cases: { i1: { doel: 'Eerder ingrijpen', actoren: 'SLB', resultaat: 'minder uitval', ai_data: 'LMS', _ts_doel: 100 } } },
    u2: { insights: [{ id: 'i1', type: 'kans', text: 'Studievoortgang', role: 'praktijk', votes: { u1: 2, u2: 4 } }, { id: 'i2', type: 'uitdaging', text: 'AVG-drempels', role: 'aansturing', votes: { u2: 1 } }], cases: {} },
  });
  await writeRoom('WTEL', {
    u3: { insights: [{ id: 'i3', type: 'kans', text: 'Datageletterdheid', role: 'praktijk', votes: { u3: 5 } }], cases: { i3: { doel: 'Docenten data laten duiden', ai_data: 'training', _ts_doel: 50 } } },
  });
  await writeRoom('TEST1', { u9: { insights: [{ id: 'x1', type: 'kans', text: 'NIET MEETELLEN', role: 'praktijk', votes: { u9: 9 } }], cases: {} } });

  port = await getFreePort();
  base = `http://localhost:${port}`;
  server = spawn('node', ['server.js'], {
    cwd: APP_DIR,
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', RECAP_DIR: recapDir, ADMIN_USER: ADMIN.username, ADMIN_PASSWORD: ADMIN.password },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await waitForBoot(server);
});

test.afterAll(async () => {
  if (server && server.exitCode === null) { server.kill('SIGTERM'); await new Promise(r => server.once('exit', r)); }
  if (recapDir) await rm(recapDir, { recursive: true, force: true });
});

test('GET /admin/analyse vereist auth', async () => {
  const res = await fetch(`${base}/admin/analyse`);            // geen header
  expect(res.status).toBe(401);
});

test('GET /admin/analyse aggregeert en sluit ongemapte kamers uit (curatie)', async ({ page }) => {
  await page.goto(`${base}/admin/analyse`);
  const data = await page.evaluate(() => window.__ANALYSE__);
  expect(data.kpis).toEqual({ regios: 2, inzichten: 3, stemmen: 13, deelnemers: 3 });
  expect(data.insights.map(i => i.id)).toEqual(['i1', 'i3', 'i2']);
  expect(data.insights.find(i => i.tekst === 'NIET MEETELLEN')).toBeUndefined();
  expect(data.unmappedRooms).toEqual(['TEST1']);
  expect(data.regios.map(r => r.code)).toEqual(['HRQT', 'WTEL', 'PUXD', 'MDRH']);
});

test('GET /admin/recaps linkt naar het dashboard', async () => {
  const res = await fetch(`${base}/admin/recaps`, { headers: { authorization: authHeader } });
  const html = await res.text();
  expect(html).toContain('/admin/analyse');
});
