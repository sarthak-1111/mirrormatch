// Merchant agent suggestions (gap → target colour, fit notes, decisions), the sample-model
// route and the workspace endpoints. Deterministic, mock mode, no units.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, copyFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { Catalog } from '../server/store/catalog.js';
import { hexToLab, labToHex, deltaE2000 } from '../server/color/color.js';
import { lipTarget, scoreProduct, fitConfidence } from '../server/color/match.js';
import { representativeProfile } from '../server/store/insights.js';
import { fitMatrix } from '../server/store/fit.js';
import {
  gapTarget, proposeShade, buildSuggestions, fitNotes, runsWords, decisionsFrom, liveChoices,
  createSampleStore, previewBody, temperatureOf, SYNTHETIC_LABEL,
} from '../server/store/suggestions.js';
import { mockApp, runToMatches, settle } from './helpers.js';

const FIXTURE = fileURLToPath(new URL('./fixtures/synthetic-face.jpg', import.meta.url));
const synthetic = JSON.parse(readFileSync(new URL('../data/synthetic-history.json', import.meta.url)));

test('gap target (lipstick) is exactly the matcher\'s own lipTarget for the profile', () => {
  for (const key of ['light-cool', 'medium-cool', 'deep-warm']) {
    const t = gapTarget('lipstick', key);
    const expected = labToHex(lipTarget(representativeProfile(key))).toUpperCase();
    assert.equal(t.hex, expected);
    // hex and Lab agree (Lab is of the hex, rounded to 0.1)
    const lab = hexToLab(t.hex);
    assert.ok(Math.abs(lab.L - t.lab.L) < 0.06 && Math.abs(lab.a - t.lab.a) < 0.06 && Math.abs(lab.b - t.lab.b) < 0.06);
    // The proposal scores as a great fit for the profile it is meant to serve.
    const r = scoreProduct(t.product, t.profile, null);
    assert.equal(fitConfidence('lipstick', r), 'high');
  }
});

test('gap target (foundation) is the profile skin colour; (dress) scores at least as well as every catalogue colourway', () => {
  const f = gapTarget('foundation', 'deep-neutral');
  assert.ok(deltaE2000(hexToLab(f.hex), representativeProfile('deep-neutral').skinLab) < 1);
  const catalog = new Catalog();
  const d = gapTarget('dress', 'medium-warm');
  const own = scoreProduct(d.product, d.profile, null).score;
  for (const p of catalog.products.filter((x) => x.category === 'dress')) {
    assert.ok(own <= scoreProduct(p, d.profile, null).score + 1e-9, `${p.shadeName} beat the proposed colourway`);
  }
  assert.equal(temperatureOf({ L: 50, C: 40, h: 60 }), 'warm');
  assert.equal(temperatureOf({ L: 50, C: 40, h: 240 }), 'cool');
  assert.equal(temperatureOf({ L: 50, C: 8, h: 240 }), 'neutral');
  assert.throws(() => gapTarget('lipstick', 'nope'));
});

test('a thin-coverage gap becomes a "Fill the gap" proposal with a distinct, previewable colour', () => {
  const catalog = new Catalog();
  const gap = fitMatrix({ catalog, category: 'lipstick' }).gaps.find((g) => g.profileKey === 'medium-cool');
  assert.ok(gap, 'the demo catalogue has thin coverage for medium · cool lipstick');
  const s = proposeShade({ catalog, gap });
  assert.equal(s.id, 'shade:lipstick:medium-cool');
  assert.match(s.hex, /^#[0-9A-F]{6}$/);
  assert.equal(s.fit.level, 'great');
  assert.ok(s.nearest.deltaE > 3, 'proposal is visibly different from the nearest existing shade');
  assert.equal(s.previewable, true);
  assert.equal(s.synthetic, false);
  assert.match(s.text, /Mauve Mist/);
  assert.match(s.text, new RegExp(s.hex));
});

test('suggestions are deterministic, and every synthetic note says so', () => {
  const catalog = new Catalog();
  const a = buildSuggestions({ catalog, events: [], synthetic });
  const b = buildSuggestions({ catalog, events: [], synthetic });
  assert.deepEqual(a, b);
  assert.ok(a.some((s) => s.kind === 'shade'));
  const notes = a.filter((s) => s.kind === 'note');
  assert.ok(notes.length >= 1);
  for (const n of notes) {
    assert.equal(n.synthetic, true);
    assert.ok(n.text.startsWith(`${SYNTHETIC_LABEL}:`), n.text);
    assert.match(n.basis, /synthetic returns/);
  }
  const shell = notes.find((n) => n.productId === 'lip-l01');
  assert.match(shell.note, /^Runs .* on deep, cool skin; for that colouring, MirrorMatch's matcher picks Rosewood\.$/);
});

test('live fit notes use real live exchanges for "shoppers like this often chose"', () => {
  const catalog = new Catalog();
  const ev = [];
  for (let i = 0; i < 3; i++) {
    const sessionId = `s${i}`;
    ev.push({ type: 'return_started', sessionId, productId: 'lip-l01', category: 'lipstick', price: 22 });
    ev.push({ type: 'tone_analyzed', sessionId, productId: 'lip-l01', profileKey: 'medium-warm' });
    ev.push({ type: 'exchange_created', sessionId, productId: 'lip-l01', toProductId: i < 2 ? 'lip-l02' : 'lip-l03', value: 22 });
  }
  const choices = liveChoices(ev);
  assert.deepEqual(choices['lip-l01']['medium-warm'], { 'lip-l02': 2, 'lip-l03': 1 });
  const all = buildSuggestions({ catalog, events: ev, synthetic: { records: [] } });
  const n = all.find((s) => s.id === 'note:live:lip-l01:medium-warm');
  assert.ok(n);
  assert.equal(n.synthetic, false);
  assert.match(n.note, /shoppers like this often chose Bare Honey\.$/);
  assert.equal(n.recommendBasis, 'live_exchanges');
  assert.ok(!n.text.includes(SYNTHETIC_LABEL));
});

test('runsWords describes the direction of the miss', () => {
  const catalog = new Catalog();
  const r = runsWords(catalog.product('fdn-3w'), representativeProfile('deep-cool'));
  assert.match(r.text, /^runs (light|warm) and (light|warm) on deep, cool skin$/);
  const d = runsWords(catalog.product('dress-wrap-camel'), representativeProfile('medium-neutral'));
  assert.match(d.text, /sits close to medium, neutral skin/);
  assert.deepEqual(fitNotes({ catalog, heat: {}, source: 'live' }), []);
});

test('decisions: the latest approve/dismiss per suggestion wins', () => {
  const d = decisionsFrom([
    { type: 'suggestion_approved', suggestionId: 'a', at: '1' },
    { type: 'suggestion_dismissed', suggestionId: 'a', at: '2' },
    { type: 'suggestion_approved', suggestionId: 'b', at: '3' },
    { type: 'return_started', sessionId: 'x' },
  ]);
  assert.deepEqual(d, { a: { decision: 'dismissed', at: '2' }, b: { decision: 'approved', at: '3' } });
});

test('preview body renders the exact colour as a custom lipstick (or foundation) with makeup-vto', () => {
  const b = previewBody('lipstick', '#D37C90', 'f1');
  assert.equal(b.src_file_id, 'f1');
  assert.equal(b.effects.find((e) => e.category === 'lip_color').palettes[0].color, '#D37C90');
  assert.equal(previewBody('foundation', '#7B5644', 'f2').effects[1].palettes[0].color, '#7B5644');
  assert.throws(() => previewBody('dress', '#123456', 'f3'), /makeup try-on/);
});

test('sample store: local bytes unchanged; missing file fetched once and kept in memory', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mm-samples-'));
  copyFileSync(FIXTURE, join(dir, 'face.jpg'));
  let fetches = 0;
  const fake = async () => {
    fetches++;
    return new Response(readFileSync(FIXTURE), { status: 200 });
  };
  const store = createSampleStore({ dir, urls: { face: 'http://x/f.jpg', body: 'http://x/b.jpg' }, fetchImpl: fake });
  const face = await store.get('face');
  assert.ok(face.buffer.equals(readFileSync(FIXTURE)));
  assert.equal(face.mime, 'image/jpeg');
  assert.equal(face.source, 'local');
  assert.equal(fetches, 0);
  const body1 = await store.get('body');
  const body2 = await store.get('body');
  assert.equal(body1.source, 'official-url');
  assert.equal(body1, body2);
  assert.equal(fetches, 1);
  await assert.rejects(store.get('selfie'), /unknown sample/);
  const broken = createSampleStore({ dir, urls: {}, fetchImpl: fake });
  await assert.rejects(broken.get('body'), /not available/);
});

async function serve(overrides) {
  const ctx = await mockApp(overrides);
  const server = await new Promise((r) => {
    const s = ctx.app.listen(0, '127.0.0.1', () => r(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (path, body) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) });
  return { ...ctx, base, post, close: () => new Promise((r) => server.close(r)) };
}

test('GET /api/samples/:kind serves the canonical bytes; unknown or missing samples are 404', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mm-samples-'));
  copyFileSync(FIXTURE, join(dir, 'face.jpg'));
  const t = await serve({ samplesDir: dir, sampleUrls: {} });
  try {
    const res = await fetch(`${t.base}/api/samples/face`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'image/jpeg');
    assert.ok(Buffer.from(await res.arrayBuffer()).equals(readFileSync(FIXTURE)), 'bytes are exactly the canonical file');
    assert.equal((await fetch(`${t.base}/api/samples/body`)).status, 404);
    assert.equal((await fetch(`${t.base}/api/samples/selfie`)).status, 404);
  } finally {
    await t.close();
  }
});

test('the same sample bytes hash the same in the agent, so the demo cache can hit on repeat runs', async () => {
  const t = await serve();
  try {
    const bytes = readFileSync(FIXTURE);
    const image = `data:image/jpeg;base64,${bytes.toString('base64')}`;
    const shas = [];
    for (let i = 0; i < 2; i++) {
      let v = await t.agent.start({ orderId: 'HH-10421' });
      v = await t.agent.handle(v.id, 'reason', { reason: 'wrong_shade' });
      v = await t.agent.handle(v.id, 'accept_mirrormatch');
      v = await t.agent.handle(v.id, 'consent', { accepted: true });
      await t.agent.handle(v.id, 'photo', { image, width: 600, height: 800, stats: { meanLuma: 128, clippedPct: 1, contrast: 45 } });
      shas.push(t.sessions.get(v.id).photo.sha);
    }
    assert.equal(shas[0], createHash('sha256').update(bytes).digest('hex'));
    assert.equal(shas[0], shas[1]);
  } finally {
    await t.close();
  }
});

test('trace endpoint: PII-free agent trace for the workspace console', async () => {
  const t = await serve();
  try {
    const v = await runToMatches(t.agent);
    await t.agent.handle(v.id, 'render');
    await settle(t.agent, v.id);
    const j = await (await fetch(`${t.base}/api/trace/${v.id}`)).json();
    assert.equal(j.id, v.id);
    assert.equal(j.returned.id, 'lip-l01');
    assert.ok(j.trace.some((x) => x.tool === 'analyze_skin_tone'));
    assert.ok(j.trace.some((x) => x.tool === 'render_tryon'));
    const raw = JSON.stringify(j);
    assert.ok(!raw.includes('base64') && !raw.includes('skinHex'), 'no photo or colour values');
    assert.equal((await fetch(`${t.base}/api/trace/nope`)).status, 404);
  } finally {
    await t.close();
  }
});

test('suggestions API: list, approve (logs an event only), dismiss, and a mock preview on the sample model', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mm-samples-'));
  copyFileSync(FIXTURE, join(dir, 'face.jpg'));
  const t = await serve({ samplesDir: dir, sampleUrls: {} });
  try {
    const j = await (await fetch(`${t.base}/api/merchant/suggestions`)).json();
    assert.equal(j.llm, false);
    assert.ok(j.suggestions.every((s) => s.wording === 'template'));
    const shade = j.suggestions.find((s) => s.kind === 'shade' && s.previewable);
    assert.ok(shade);

    const ap = await (await t.post(`/api/merchant/suggestions/${encodeURIComponent(shade.id)}/decision`, { decision: 'approved' })).json();
    assert.equal(ap.ok, true);
    assert.equal(ap.external, false);
    assert.ok(t.events.events.some((e) => e.type === 'suggestion_approved' && e.suggestionId === shade.id));
    const after = await (await fetch(`${t.base}/api/merchant/suggestions`)).json();
    assert.equal(after.suggestions.find((s) => s.id === shade.id).decision.decision, 'approved');
    assert.equal((await t.post(`/api/merchant/suggestions/${encodeURIComponent(shade.id)}/decision`, { decision: 'publish' })).status, 400);
    assert.equal((await t.post('/api/merchant/suggestions/nope/decision', { decision: 'dismissed' })).status, 404);

    const before = t.meter.snapshot().calls;
    const p1 = await (await t.post(`/api/merchant/suggestions/${encodeURIComponent(shade.id)}/preview`)).json();
    assert.equal(p1.cached, false);
    assert.equal(p1.units, 1);
    assert.equal(p1.label, 'Visual preview, not a guarantee');
    const img = await fetch(t.base + p1.url);
    assert.equal(img.status, 200);
    const p2 = await (await t.post(`/api/merchant/suggestions/${encodeURIComponent(shade.id)}/preview`)).json();
    assert.equal(p2.cached, true);
    assert.equal(p2.units, 0);
    assert.equal(t.meter.snapshot().calls, before + 1, 'one makeup-vto call for two previews');
    const vto = t.youcam.tasks.size === 0 || [...t.youcam.tasks.values()].every((x) => x.feature === 'makeup-vto');
    assert.ok(vto);
  } finally {
    await t.close();
  }
});

test('workspace env lists the connections and privacy guarantees without secrets', async () => {
  const t = await serve({ webhookSecret: 'shh-secret' });
  try {
    const j = await (await fetch(`${t.base}/api/workspace/env`)).json();
    assert.equal(j.transport, 'mock');
    assert.equal(j.webhook.path, '/api/integrations/return-started');
    assert.equal(j.webhook.secretRequired, true);
    assert.equal(j.llm.optional, true);
    assert.ok(j.privacy.guarantees.length >= 3);
    assert.ok(!JSON.stringify(j).includes('shh-secret'));
  } finally {
    await t.close();
  }
});
