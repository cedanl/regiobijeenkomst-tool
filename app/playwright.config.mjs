// Playwright-config — minimaal voor de smoke/regressie-tests.
// Eén worker zodat de tests om dezelfde poort en RECAP_DIR niet racen.
export default {
  testDir: './tests',
  timeout: 30000,
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: { headless: true }
};
