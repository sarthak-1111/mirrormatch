// Express app factory. Kept separate from index.js so tests can build an app in mock mode.
import express from 'express';
import { resolve } from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
import { ROOT, llmEnabled } from './config.js';
import { YouCamClient } from './youcam/client.js';
import { MockYouCamClient } from './youcam/mock.js';
import { UnitMeter } from './youcam/meter.js';
import { Catalog, publicProduct } from './store/catalog.js';
import { SessionStore } from './store/sessions.js';
import { EventLog, aggregate, recordsFromEvents } from './store/events.js';
import { buildInsights, PROFILE_KEYS, profileLabel } from './store/insights.js';
import { createDemoCache } from './store/demoCache.js';
import { createGarmentFiles } from './store/garmentFiles.js';
import { createTools, ToolError } from './agent/tools.js';
import { Agent } from './agent/agent.js';
import { REASONS, POLICY } from './policy/policy.js';

export function createApp(config, { log = console.log, persistEvents = true } = {}) {
  const meter = new UnitMeter();
  const youcam =
    config.youcam.mode === 'live'
      ? new YouCamClient({
          apiKey: config.youcam.apiKey,
          baseUrl: config.youcam.baseUrl,
          meter,
          pollIntervalMs: config.youcam.pollIntervalMs,
          pollTimeoutMs: config.youcam.pollTimeoutMs,
          log,
        })
      : new MockYouCamClient({ meter, latencyMs: config.mockLatencyMs ?? 250 });
  const catalog = new Catalog();
  const events = new EventLog({ path: resolve(config.dataDir, 'events.jsonl'), persist: persistEvents });
  const demoCache = createDemoCache(config.demoCache);
  const garmentFiles = createGarmentFiles({ youcam, publicDir: resolve(ROOT, 'public'), cachePath: resolve(ROOT, '.cache/garment-files.json') });
  const sessions = new SessionStore({
    ttlMin: config.sessionTtlMin,
    onExpire: (s) => agent.deleteRemoteTasks(s),
  });
  const tools = createTools({ youcam, meter, catalog, events, config, demoCache, garmentFiles });
  const agent = new Agent({ tools, sessions, catalog, events, youcam, meter, config, log });
  const syntheticPath = resolve(ROOT, 'data/synthetic-history.json');
  const synthetic = existsSync(syntheticPath) ? JSON.parse(readFileSync(syntheticPath, 'utf8')) : { records: [] };

  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '12mb' }));
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', 'camera=(self)');
    next();
  });

  // Simple per-IP rate limit for the API (protects units on a hosted demo).
  const hits = new Map();
  app.use('/api', (req, res, next) => {
    if (req.method === 'GET' && !req.path.startsWith('/session')) return next();
    const ip = req.ip || 'local';
    const now = Date.now();
    const h = hits.get(ip) ?? { start: now, n: 0 };
    if (now - h.start > 60000) Object.assign(h, { start: now, n: 0 });
    h.n += 1;
    hits.set(ip, h);
    if (h.n > config.rateLimitPerMin) return res.status(429).json({ error: 'Too many requests, please slow down.' });
    next();
  });

  const asyncRoute = (fn) => (req, res) =>
    fn(req, res).catch((e) => {
      if (e instanceof ToolError) return res.status(400).json({ error: e.message, code: e.code, guidance: e.guidance ?? null });
      log(`error: ${e.stack || e}`);
      res.status(500).json({ error: 'Something went wrong. Please try again.' });
    });

  app.get('/api/health', (req, res) => {
    res.json({
      ok: true,
      mode: youcam.mode,
      llm: { enabled: llmEnabled(), model: llmEnabled() ? config.llm.model : null },
      units: meter.snapshot(),
      limits: { maxRendersPerReturn: config.budget.maxRendersPerReturn, unitFloor: config.budget.unitFloor, dailyUnitCap: config.budget.dailyUnitCap },
      demoCache: config.demoCache.enabled,
    });
  });

  app.get('/api/orders', (req, res) => {
    res.json({ store: catalog.store, orders: catalog.ordersView(), reasons: REASONS, policy: { returnWindowDays: POLICY.returnWindowDays } });
  });

  app.get('/api/products/:id', (req, res) => {
    const p = publicProduct(catalog.product(req.params.id));
    if (!p) return res.status(404).json({ error: 'not found' });
    res.json(p);
  });

  app.post('/api/returns', asyncRoute(async (req, res) => {
    res.json(await agent.start({ orderId: req.body.orderId, lineId: req.body.lineId }));
  }));

  app.post('/api/session/:id/event', asyncRoute(async (req, res) => {
    const { type, ...payload } = req.body ?? {};
    res.json(await agent.handle(req.params.id, type, payload));
  }));

  app.get('/api/session/:id', asyncRoute(async (req, res) => {
    const s = sessions.get(req.params.id);
    if (!s) return res.status(404).json({ error: 'Session not found or expired', code: 'session_not_found' });
    res.json(agent.view(s));
  }));

  app.get('/api/session/:id/render/:rid', (req, res) => {
    const s = sessions.get(req.params.id);
    const r = s?.renders.find((x) => x.id === req.params.rid);
    if (!r?.buffer) return res.status(404).end();
    res.setHeader('Content-Type', r.contentType || 'image/jpeg');
    res.setHeader('Cache-Control', 'private, no-store');
    res.end(r.buffer);
  });

  app.delete('/api/session/:id', asyncRoute(async (req, res) => {
    res.json(await agent.handle(req.params.id, 'delete_photo'));
  }));

  // ---------- merchant ----------
  function merchantSummary() {
    const liveRecords = recordsFromEvents(events.events);
    const live = aggregate(liveRecords);
    const synth = aggregate(synthetic.records.map((r) => ({ ...r, secondTry: false })));
    const productsInHeat = (heat) =>
      Object.keys(heat)
        .map((id) => catalog.product(id))
        .filter(Boolean)
        .map((p) => ({ id: p.id, name: `${p.productLine} · ${p.shadeName}`, shadeName: p.shadeName, hex: p.hex, category: p.category }));
    return {
      generatedAt: new Date().toISOString(),
      profileKeys: PROFILE_KEYS.map((k) => ({ key: k, label: profileLabel(k) })),
      live: {
        kpis: live.kpis,
        heat: live.heat,
        products: productsInHeat(live.heat),
        insights: buildInsights({ heat: live.heat, catalog, minReturns: 2 }),
        recent: events.events.slice(-40).reverse(),
      },
      synthetic: {
        label: synthetic.label ?? 'Synthetic demo data',
        disclaimer: synthetic.disclaimer ?? '',
        returns: synthetic.records.length,
        heat: synth.heat,
        products: productsInHeat(synth.heat),
        insights: buildInsights({ heat: synth.heat, catalog }),
      },
      units: meter.snapshot(),
      mode: youcam.mode,
    };
  }

  app.get('/api/merchant/summary', (req, res) => res.json(merchantSummary()));

  app.get('/api/merchant/traces', (req, res) => {
    res.json(
      sessions.recent(15).map((s) => ({
        id: s.id.slice(0, 8),
        createdAt: new Date(s.createdAt).toISOString(),
        returnedId: s.returnedId,
        step: s.step,
        status: s.status,
        outcome: s.outcome,
        unitsUsed: s.unitsUsed,
        profileKey: s.profile?.profileKey ?? null,
        trace: s.trace,
      })),
    );
  });

  app.get('/api/merchant/stream', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();
    res.write('retry: 3000\n\n');
    const unsub = events.subscribe((ev) => res.write(`data: ${JSON.stringify(ev)}\n\n`));
    const ping = setInterval(() => res.write(': ping\n\n'), 25000);
    req.on('close', () => {
      clearInterval(ping);
      unsub();
    });
  });

  app.use(express.static(resolve(ROOT, 'public'), { extensions: ['html'] }));

  async function init() {
    try {
      const c = await youcam.getCredit();
      meter.setBalance(c.total);
      log(`[youcam] mode=${youcam.mode} balance=${c.total} units`);
    } catch (e) {
      log(`[youcam] credit check failed: ${e.code} ${e.message}`);
    }
    if (youcam.mode === 'live') {
      try {
        const n = meter.setCostsFromSkus(await youcam.getFeatureCosts());
        log(`[youcam] feature costs loaded (${n} skus): skin-tone=${meter.costOf('skin-tone-analysis')}, makeup-vto=${meter.costOf('makeup-vto')}, ${config.youcam.clothFeature}=${meter.costOf(config.youcam.clothFeature)}`);
      } catch (e) {
        log(`[youcam] feature-cost lookup failed (${e.code}); using documented costs`);
      }
    }
  }

  return { app, init, agent, sessions, events, meter, catalog, youcam };
}
