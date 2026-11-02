// Configuration from environment variables (and an optional .env file).
// YOUCAM_API_KEY is read here, on the server only. It is never sent to the browser or logged.
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function loadEnvFile(path) {
  if (!path || !existsSync(path)) return false;
  const text = readFileSync(path, 'utf8');
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
  return true;
}

loadEnvFile(process.env.ENV_FILE ? resolve(process.env.ENV_FILE) : resolve(ROOT, '.env'));

const num = (v, d) => (v === undefined || v === '' || Number.isNaN(Number(v)) ? d : Number(v));
const bool = (v, d) => (v === undefined || v === '' ? d : /^(1|true|yes|on)$/i.test(String(v)));

const forceMock = process.argv.includes('--mock') || bool(process.env.YOUCAM_MOCK, false);
const apiKey = process.env.YOUCAM_API_KEY?.trim() || '';

export const config = {
  port: num(process.env.PORT, 3000),
  host: process.env.HOST || '127.0.0.1',
  youcam: {
    apiKey,
    baseUrl: (process.env.YOUCAM_BASE_URL || 'https://yce-api-01.makeupar.com').replace(/\/$/, ''),
    mode: forceMock || !apiKey ? 'mock' : 'live',
    // 'mcp' (default): the agent's YouCam tasks run through YouCam's hosted MCP servers, with
    // automatic REST fallback on transport errors. 'rest': call the REST task endpoints directly.
    transport: (process.env.YOUCAM_TRANSPORT || 'mcp').toLowerCase() === 'rest' ? 'rest' : 'mcp',
    clothFeature: process.env.YOUCAM_CLOTH_FEATURE || 'cloth-v4',
    garmentCategory: process.env.YOUCAM_GARMENT_CATEGORY || 'full_body',
    faceAngleStrictness: process.env.YOUCAM_FACE_STRICTNESS || 'medium',
    pollIntervalMs: num(process.env.YOUCAM_POLL_MS, 1500),
    pollTimeoutMs: num(process.env.YOUCAM_POLL_TIMEOUT_MS, 120000),
    deleteTasksOnEnd: bool(process.env.YOUCAM_DELETE_TASKS, true),
  },
  budget: {
    maxRendersPerReturn: num(process.env.MAX_RENDERS_PER_RETURN, 3),
    unitFloor: num(process.env.UNIT_FLOOR, 25),
    dailyUnitCap: num(process.env.DAILY_UNIT_CAP, 0), // 0 = off (set it on a hosted demo)
  },
  demoCache: {
    // Opt-in, for the demo owner's own photo only: persists tone results and renders on disk,
    // keyed by a SHA-256 of the photo, so repeated demo takes don't spend units. Off by default.
    enabled: bool(process.env.DEMO_CACHE, false),
    dir: resolve(ROOT, process.env.DEMO_CACHE_DIR || '.cache/demo'),
  },
  llm: {
    baseUrl: (process.env.LLM_BASE_URL || '').replace(/\/$/, ''),
    model: process.env.LLM_MODEL || '',
    apiKey: process.env.LLM_API_KEY || '',
    timeoutMs: num(process.env.LLM_TIMEOUT_MS, 12000),
  },
  sessionTtlMin: num(process.env.SESSION_TTL_MIN, 20),
  rateLimitPerMin: num(process.env.RATE_LIMIT_PER_MIN, 60),
  // Hosted behind a Cloudflare tunnel: rate-limit by CF-Connecting-IP (only trusted on loopback).
  trustCfIp: process.env.TRUST_CF_IP === '1',
  dataDir: resolve(ROOT, process.env.DATA_DIR || 'data'),
  // PERSIST_EVENTS=0 keeps live dashboard events in memory only (e2e runs, hosted demo).
  persistEvents: process.env.PERSIST_EVENTS !== '0',
  // Optional shared secret for the returns-portal webhook (header X-MirrorMatch-Secret).
  webhookSecret: process.env.WEBHOOK_SECRET || '',
};

export const llmEnabled = () => Boolean(config.llm.baseUrl && config.llm.model);
