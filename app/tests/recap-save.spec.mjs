// Regressie-test voor het scenario waar dit hele drama mee begon:
// een frontend-wijziging die de `/api/recap`-aanroep onbedoeld dropt.
//
// Start een verse server tegen een tmpdir, joint via de UI een nieuwe
// sessie en kiest een rol. Controleert daarna dat de server het bestand
// state.json daadwerkelijk heeft geschreven met de deelnemer-state erin.
//
// Loopt vóór elke `fly deploy` (en in toekomstige CI). Als deze test
// rood is komt er niets in productie waar de save kapot zit.

import { test, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_DIR = path.resolve(__dirname, '..');

let server;
let recapDir;
let port;

function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, () => {
      const p = srv.address().port;
      srv.close(() => resolve(p));
    });
  });
}

function waitForBoot(child) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('server boot timeout')), 10000);
    const onData = (chunk) => {
      if (chunk.toString().includes('workshop-server gestart')) {
        clearTimeout(timer);
        child.stdout.off('data', onData);
        resolve();
      }
    };
    child.stdout.on('data', onData);
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error('server exited prematurely, code=' + code));
    });
  });
}

test.beforeAll(async () => {
  recapDir = await mkdtemp(path.join(tmpdir(), 'recap-regression-'));
  port = await getFreePort();
  server = spawn('node', ['server.js'], {
    cwd: APP_DIR,
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', RECAP_DIR: recapDir },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  await waitForBoot(server);
});

test.afterAll(async () => {
  if (server && server.exitCode === null) {
    server.kill('SIGTERM');
    await new Promise(r => server.once('exit', r));
  }
  if (recapDir) {
    await rm(recapDir, { recursive: true, force: true });
  }
});

test('rol kiezen schrijft state.json met deelnemer-state naar de server', async ({ page }) => {
  await page.goto(`http://localhost:${port}/`);

  await page.locator('#user-name').fill('RegressionTester');
  await page.getByRole('button', { name: /Start een nieuwe sessie/ }).click();
  await page.getByRole('button', { name: /Maak sessie/ }).click();

  // Wacht tot de topbar de gegenereerde sessiecode toont (auto-retry).
  const roomCodeLocator = page.locator('#topbar-room-code');
  await expect(roomCodeLocator).toHaveText(/^[A-Z0-9]{3,16}$/);
  const roomCode = (await roomCodeLocator.textContent()).trim();

  // Listener vooraf opzetten — POST /api/recap is event-driven, niet
  // gekoppeld aan een specifieke klik. We wachten op de eerste 2xx-response
  // ná de rol-pick (debounce 5s + roundtrip).
  const recapPostOk = page.waitForResponse(
    r => r.url().includes('/api/recap') && r.request().method() === 'POST' && r.ok(),
    { timeout: 15000 }
  );
  await page.getByRole('button', { name: /Onderwijspraktijk/ }).click();
  await recapPostOk;

  // Server moet state.json op disk hebben geschreven met onze state erin.
  const statePath = path.join(recapDir, roomCode, 'state.json');
  const data = JSON.parse(await readFile(statePath, 'utf8'));

  expect(data.roomCode).toBe(roomCode);
  const participants = Object.values(data.participants);
  expect(participants).toHaveLength(1);
  expect(participants[0].state.userName).toBe('RegressionTester');
  expect(participants[0].state.role).toBe('praktijk');
  expect(participants[0].state.roomCode).toBe(roomCode);
});
