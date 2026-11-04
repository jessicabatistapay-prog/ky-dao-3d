import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;
export const BASE = `http://127.0.0.1:${PORT}`;
// Trình kết xuất phần mềm rất chậm: chạy kiểm thử ở chất lượng thấp.
export const LOW_QUALITY = {
  cookies: [],
  origins: [{
    origin: BASE,
    localStorage: [{ name: 'kydao.settings.v1', value: JSON.stringify({ quality: 'low' }) }],
  }],
};
export default defineConfig({
  testDir: 'e2e',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: BASE,
    storageState: LOW_QUALITY,
    launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', '--disable-background-timer-throttling'] },
  },
  webServer: {
    command: 'npm run build && node apps/server/dist/index.js',
    url: `http://127.0.0.1:${PORT}/healthz`,
    reuseExistingServer: true,
    timeout: 120_000,
    env: {
      PORT: String(PORT), HOST: '127.0.0.1', STATIC_DIR: 'apps/web/dist', DB_PATH: ':memory:', NODE_ENV: 'production',
      RECONNECT_GRACE_MS: '6000', RATE_CREATE_PER_MIN: '1000', RATE_JOIN_PER_MIN: '1000',
    },
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 760 } } },
  ],
});
