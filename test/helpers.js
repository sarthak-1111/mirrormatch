import { createApp } from '../server/app.js';
import { config as baseConfig } from '../server/config.js';

export function mockConfig(overrides = {}) {
  const c = structuredClone(baseConfig);
  c.youcam.mode = 'mock';
  c.youcam.apiKey = '';
  c.llm.baseUrl = '';
  c.llm.model = '';
  c.mockLatencyMs = 5;
  c.demoCache.enabled = false;
  c.rateLimitPerMin = 10000;
  return Object.assign(c, overrides);
}

export async function mockApp(overrides) {
  const ctx = createApp(mockConfig(overrides), { log: () => {}, persistEvents: false });
  await ctx.init();
  return ctx;
}

export const FAKE_IMAGE = 'data:image/jpeg;base64,' + Buffer.from('not-really-a-jpeg-but-fine-for-mock').toString('base64');
export const GOOD_STATS = { meanLuma: 128, clippedPct: 1, contrast: 45 };

export async function runToMatches(agent, { orderId = 'HH-10421', reason = 'wrong_shade', hint = { skinHex: '#B9947C', lipHex: '#B5636A' } } = {}) {
  let v = await agent.start({ orderId });
  v = await agent.handle(v.id, 'reason', { reason });
  v = await agent.handle(v.id, 'accept_mirrormatch');
  v = await agent.handle(v.id, 'consent', { accepted: true });
  v = await agent.handle(v.id, 'photo', { image: FAKE_IMAGE, width: 900, height: 1200, stats: GOOD_STATS, hint });
  return v;
}

export const settle = (agent, id) => agent.sessions.get(id)?.renderPromise ?? Promise.resolve();
