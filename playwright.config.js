// End-to-end tests run against the server in MOCK mode (no YouCam key, no units spent).
import { defineConfig, devices } from '@playwright/test';

const PORT = 3210;
export default defineConfig({
  testDir: 'e2e',
  timeout: 60000,
  retries: 0,
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    ...devices['Pixel 7'],
    // Uses the bundled Chromium if installed (`npx playwright install chromium`), else local Chrome.
    channel: process.env.PW_CHANNEL || undefined,
  },
  webServer: {
    command: `node server/index.js --mock`,
    url: `http://127.0.0.1:${PORT}/api/health`,
    env: { PORT: String(PORT), HOST: '127.0.0.1', YOUCAM_MOCK: '1', LLM_BASE_URL: '', DATA_DIR: 'tmp/e2e-data', PERSIST_EVENTS: '0', DEMO_CACHE: '0', RATE_LIMIT_PER_MIN: '1000' },
    reuseExistingServer: false,
  },
});
