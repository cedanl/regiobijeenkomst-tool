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

// Regressie voor de bug waar dit alles om draait: bij het starten van een
// NIEUWE sessie (nieuwe code) mochten resultaten van een vorige sessie nog
// in beeld staan — en lekten ze zelfs via de state-sync naar de andere
// deelnemers. De fix wist de oogst zodra je naar een andere room verbindt.
test('nieuwe sessie wist resultaten van een vorige sessie', async ({ page }) => {
  await page.goto(`http://localhost:${port}/`);

  // Simuleer een vorige sessie waarvan de oogst nog in localStorage hangt
  // (roomCode null = gebruiker heeft die sessie verlaten, content blijft).
  await page.evaluate(() => {
    localStorage.setItem('ceda-workshop-user', JSON.stringify({ userId: 'u_prev', userName: 'Vorige' }));
    localStorage.setItem('ceda-workshop-v2', JSON.stringify({
      userId: 'u_prev', userName: 'Vorige', roomCode: null, role: 'praktijk',
      insights: [{ id: 'oud1', type: 'kans', text: 'inzicht uit vorige sessie', role: 'praktijk', authorId: 'u_prev', authorName: 'Vorige', ts: 1, votes: {} }],
      cases: { oud1: { doel: 'oud doel' } }, selectedCases: ['oud1'], participants: {},
      timer: { remaining: 5400, running: false, lastTick: null }
    }));
  });
  await page.reload();

  // Start een nieuwe sessie met een verse code.
  await page.getByRole('button', { name: /Start een nieuwe sessie/ }).click();
  await page.getByRole('button', { name: /Maak sessie/ }).click();
  await expect(page.locator('#topbar-room-code')).toHaveText(/^[A-Z0-9]{3,16}$/);

  // De oogst van de vorige sessie moet weg zijn; eigen identiteit blijft.
  const persisted = await page.evaluate(() => JSON.parse(localStorage.getItem('ceda-workshop-v2')));
  expect(persisted.insights).toHaveLength(0);
  expect(persisted.selectedCases).toHaveLength(0);
  expect(Object.keys(persisted.cases)).toHaveLength(0);
  expect(persisted.userName).toBe('Vorige');
  expect(persisted.role).toBe('praktijk');
});

// Keerzijde van dezelfde gate: herladen / auto-herverbinden met DEZELFDE
// sessiecode mag de oogst juist NIET wissen. Dit is wat zou breken als de
// reset-conditie te ruim is.
test('herverbinden met dezelfde sessiecode behoudt de oogst', async ({ page }) => {
  await page.goto(`http://localhost:${port}/`);

  await page.evaluate(() => {
    localStorage.setItem('ceda-workshop-user', JSON.stringify({ userId: 'u_keep', userName: 'Blijver' }));
    localStorage.setItem('ceda-workshop-v2', JSON.stringify({
      userId: 'u_keep', userName: 'Blijver', roomCode: 'KEEPME', role: 'praktijk',
      insights: [{ id: 'houd1', type: 'kans', text: 'moet blijven', role: 'praktijk', authorId: 'u_keep', authorName: 'Blijver', ts: 1, votes: {} }],
      cases: {}, selectedCases: [], participants: {},
      timer: { remaining: 5400, running: false, lastTick: null }
    }));
  });
  await page.reload(); // init() auto-herverbindt naar KEEPME met resetContent=false

  await expect(page.locator('#topbar-room-code')).toHaveText('KEEPME');
  const persisted = await page.evaluate(() => JSON.parse(localStorage.getItem('ceda-workshop-v2')));
  expect(persisted.insights).toHaveLength(1);
  expect(persisted.insights[0].id).toBe('houd1');
});

// Het tweede deel van de fix: een sessie VERLATEN en daarna met DEZELFDE code
// opnieuw joinen mag de oogst NIET wissen. Na verlaten staat roomCode op null
// maar contentRoom blijft de oude room — dus de gate herkent "zelfde sessie".
test('verlaten en opnieuw met dezelfde code joinen behoudt de oogst', async ({ page }) => {
  await page.goto(`http://localhost:${port}/`);

  // Staat zoals na een Verlaat: roomCode null, contentRoom nog gezet, oogst er.
  await page.evaluate(() => {
    localStorage.setItem('ceda-workshop-user', JSON.stringify({ userId: 'u_back', userName: 'Terugkomer' }));
    localStorage.setItem('ceda-workshop-v2', JSON.stringify({
      userId: 'u_back', userName: 'Terugkomer', roomCode: null, contentRoom: 'SAME1', role: 'praktijk',
      insights: [{ id: 'terug1', type: 'kans', text: 'mag niet verdwijnen na rejoin', role: 'praktijk', authorId: 'u_back', authorName: 'Terugkomer', ts: 1, votes: {} }],
      cases: {}, selectedCases: [], participants: {},
      timer: { remaining: 5400, running: false, lastTick: null }
    }));
  });
  await page.reload();

  // Join exact dezelfde code opnieuw (join-modus is de default).
  await page.locator('#room-code').fill('SAME1');
  await page.locator('#connect-btn').click();
  await expect(page.locator('#topbar-room-code')).toHaveText('SAME1');

  const persisted = await page.evaluate(() => JSON.parse(localStorage.getItem('ceda-workshop-v2')));
  expect(persisted.insights).toHaveLength(1);
  expect(persisted.insights[0].id).toBe('terug1');
});

// DATA MAG NOOIT VERLOREN GAAN: een inzicht dat vlak vóór het verlaten is
// toegevoegd (binnen het 5s-debouncevenster, dus nog niet auto-opgeslagen)
// moet door de flush in leaveSessionRoom alsnog centraal op disk belanden.
test('sessie verlaten schrijft een vers inzicht alsnog centraal weg', async ({ page }) => {
  await page.goto(`http://localhost:${port}/`);

  await page.locator('#user-name').fill('LeaveSaver');
  await page.getByRole('button', { name: /Start een nieuwe sessie/ }).click();
  await page.getByRole('button', { name: /Maak sessie/ }).click();
  const codeLoc = page.locator('#topbar-room-code');
  await expect(codeLoc).toHaveText(/^[A-Z0-9]{3,16}$/);
  const room = (await codeLoc.textContent()).trim();

  // Rol kiezen → naar fase 1, en daar een vers inzicht toevoegen.
  await page.getByRole('button', { name: /Onderwijspraktijk/ }).click();
  await page.getByRole('button', { name: /Naar fase 1/ }).click();
  await page.locator('textarea[data-input="kans"]').fill('VERS inzicht vlak voor verlaten');
  await page.locator('button[data-add="kans"]').click();

  // Meteen verlaten — ruim binnen de 5s-debounce, zodat alleen de leave-flush
  // dit inzicht naar de server kan brengen. We wachten op die POST.
  const recapPostOk = page.waitForResponse(
    r => r.url().includes('/api/recap') && r.request().method() === 'POST' && r.ok(),
    { timeout: 15000 }
  );
  await page.getByRole('button', { name: /Welkom/ }).click();
  await page.locator('#leave-room').click();
  await recapPostOk;

  // Het verse inzicht moet in de centrale state.json staan — niet verloren.
  const data = JSON.parse(await readFile(path.join(recapDir, room, 'state.json'), 'utf8'));
  const allInsights = Object.values(data.participants).flatMap(p => p.state.insights || []);
  expect(allInsights.some(i => i.text === 'VERS inzicht vlak voor verlaten')).toBe(true);
});
