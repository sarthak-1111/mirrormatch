// HTTP endpoints added for real-store integration: the returns-portal webhook, the colour
// passport and the merchant fit matrix. Runs the app on an ephemeral port in mock mode.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mockApp } from './helpers.js';

async function serve(overrides) {
  const ctx = await mockApp(overrides);
  const server = await new Promise((resolve) => {
    const s = ctx.app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (path, body, headers = {}) =>
    fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  return { ...ctx, base, post, close: () => new Promise((r) => server.close(r)) };
}

test('webhook: a colour reason opens a session on the offer step and returns the shopper link', async () => {
  const t = await serve();
  try {
    const res = await t.post('/api/integrations/return-started', { orderId: 'HH-10421', lineId: 'HH-10421-1', reason: 'wrong_shade' });
    assert.equal(res.status, 200);
    const j = await res.json();
    assert.equal(j.eligible, true);
    assert.equal(j.step, 'offer');
    assert.equal(j.url, `${t.base}/#/return/${j.sessionId}`);
    const s = await (await fetch(`${t.base}/api/session/${j.sessionId}`)).json();
    assert.equal(s.step, 'offer');
    assert.ok(t.events.events.some((e) => e.type === 'mirrormatch_offered' && e.sessionId === j.sessionId));
  } finally {
    await t.close();
  }
});

test('webhook: non-colour reasons and unknown orders are not eligible', async () => {
  const t = await serve();
  try {
    let j = await (await t.post('/api/integrations/return-started', { orderId: 'HH-10421', reason: 'damaged' })).json();
    assert.deepEqual(j, { eligible: false, why: 'reason_not_colour_related' });
    j = await (await t.post('/api/integrations/return-started', { orderId: 'NOPE', reason: 'wrong_shade' })).json();
    assert.deepEqual(j, { eligible: false, why: 'order_not_found' });
    j = await (await t.post('/api/integrations/return-started', { orderId: 'HH-10421', lineId: 'nope', reason: 'wrong_shade' })).json();
    assert.deepEqual(j, { eligible: false, why: 'order_line_not_found' });
    j = await (await t.post('/api/integrations/return-started', { orderId: 'HH-10421', reason: 'bogus' })).json();
    assert.deepEqual(j, { eligible: false, why: 'unknown_reason' });
    assert.ok(!t.events.events.some((e) => e.type === 'return_started'), 'no session opened');
  } finally {
    await t.close();
  }
});

test('webhook: with WEBHOOK_SECRET set, the header is required', async () => {
  const t = await serve({ webhookSecret: 'test-shared-secret' });
  try {
    const body = { orderId: 'HH-10307', reason: 'colour_didnt_suit' };
    assert.equal((await t.post('/api/integrations/return-started', body)).status, 401);
    assert.equal((await t.post('/api/integrations/return-started', body, { 'X-MirrorMatch-Secret': 'wrong' })).status, 401);
    const ok = await t.post('/api/integrations/return-started', body, { 'X-MirrorMatch-Secret': 'test-shared-secret' });
    assert.equal(ok.status, 200);
    assert.equal((await ok.json()).eligible, true);
  } finally {
    await t.close();
  }
});

test('colour passport endpoint: validates hex and returns picks per category', async () => {
  const t = await serve();
  try {
    const bad = await t.post('/api/profile/matches', { skinHex: 'tan' });
    assert.equal(bad.status, 400);
    assert.equal((await bad.json()).code, 'bad_colour');
    const res = await t.post('/api/profile/matches', { skinHex: '#8D5A3B', lipHex: '#7A3B3A', hairHex: '#000000' });
    assert.equal(res.status, 200);
    const j = await res.json();
    assert.equal(j.profile.depthLabel.includes('deep') || j.profile.depthLabel === 'tan', true);
    for (const c of ['lipstick', 'foundation', 'dress']) assert.equal(j.picks[c].length, 2);
  } finally {
    await t.close();
  }
});

test('merchant fit endpoint: matrix, gap counts, and a 400 for unknown categories', async () => {
  const t = await serve();
  try {
    const j = await (await fetch(`${t.base}/api/merchant/fit?category=dress`)).json();
    assert.equal(j.category, 'dress');
    assert.equal(j.cells.length, j.products.length);
    assert.deepEqual(Object.keys(j.gapCounts).sort(), ['dress', 'foundation', 'lipstick']);
    assert.match(j.source, /no customer data/);
    assert.equal((await fetch(`${t.base}/api/merchant/fit?category=shoes`)).status, 400);
  } finally {
    await t.close();
  }
});
