// Agent decision paths, run end-to-end against the mock YouCam transport.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mockApp, runToMatches, settle, FAKE_IMAGE, GOOD_STATS } from './helpers.js';

test('happy path: lipstick return → matches → 3 renders → exchange, photo deleted', async () => {
  const { agent, events } = await mockApp();
  let v = await runToMatches(agent);
  assert.equal(v.step, 'matches');
  assert.ok(v.profile.summary.includes(v.profile.undertone));
  assert.equal(v.picks.length, 2);
  assert.ok(v.picks.every((p) => p.product.id !== 'lip-l01'), 'returned item is excluded');
  assert.ok(v.picks.every((p) => p.product.inStock));
  v = await agent.handle(v.id, 'render');
  assert.equal(v.step, 'tryon');
  await settle(agent, v.id);
  v = agent.view(agent.sessions.get(v.id));
  assert.deepEqual(v.renders.map((r) => r.status), ['done', 'done', 'done']);
  assert.equal(v.renders[0].role, 'returned');
  assert.equal(v.rendersUsed, 3);
  v = await agent.handle(v.id, 'exchange', { productId: v.picks[0].product.id });
  assert.equal(v.step, 'exchanged');
  assert.match(v.exchange.id, /^HH-X\d+/);
  await settle(agent, v.id);
  assert.equal(agent.sessions.get(v.id).photo, null, 'photo wiped');
  assert.ok(agent.sessions.get(v.id).renders.every((r) => r.buffer === null), 'renders wiped');
  const types = events.events.map((e) => e.type);
  for (const t of ['return_started', 'mirrormatch_offered', 'mirrormatch_accepted', 'tone_analyzed', 'exchange_created']) assert.ok(types.includes(t), t);
});

test('trace records every tool with timing and units, and no colours or photo data', async () => {
  const { agent } = await mockApp();
  const v = await runToMatches(agent);
  const s = agent.sessions.get(v.id);
  const tools = s.trace.filter((t) => t.kind === 'tool').map((t) => t.tool);
  for (const t of ['get_order', 'check_photo_quality', 'analyze_skin_tone', 'find_alternatives', 'check_stock_and_policy']) assert.ok(tools.includes(t), t);
  const tone = s.trace.find((t) => t.tool === 'analyze_skin_tone');
  assert.equal(tone.units, 20);
  assert.ok(typeof tone.ms === 'number');
  const blob = JSON.stringify(s.trace);
  assert.ok(!/#[0-9A-F]{6}/i.test(blob), 'no hex colours in trace');
  assert.ok(!blob.includes('base64'), 'no image data in trace');
});

test('non-colour reasons never trigger MirrorMatch', async () => {
  const { agent } = await mockApp();
  let v = await agent.start({ orderId: 'HH-10421' });
  v = await agent.handle(v.id, 'reason', { reason: 'damaged' });
  assert.equal(v.step, 'refund_review');
  v = await agent.handle(v.id, 'refund');
  assert.equal(v.step, 'refunded');
  assert.equal(v.refund.amount, 22);
});

test('refund is available at every MirrorMatch step', async () => {
  const { agent } = await mockApp();
  for (const stopAfter of ['offer', 'consent', 'capture', 'matches']) {
    let v = await agent.start({ orderId: 'HH-10421' });
    v = await agent.handle(v.id, 'reason', { reason: 'wrong_shade' });
    if (stopAfter !== 'offer') v = await agent.handle(v.id, 'accept_mirrormatch');
    if (['capture', 'matches'].includes(stopAfter)) v = await agent.handle(v.id, 'consent', { accepted: true });
    if (stopAfter === 'matches') v = await agent.handle(v.id, 'photo', { image: FAKE_IMAGE, width: 900, height: 1200, stats: GOOD_STATS });
    assert.equal(v.step, stopAfter);
    v = await agent.handle(v.id, 'refund');
    assert.equal(v.step, 'refunded', `refund from ${stopAfter}`);
  }
});

test('poor lighting → friendly retake guidance, no units spent', async () => {
  const { agent, meter } = await mockApp();
  let v = await agent.start({ orderId: 'HH-10421' });
  v = await agent.handle(v.id, 'reason', { reason: 'wrong_shade' });
  v = await agent.handle(v.id, 'accept_mirrormatch');
  v = await agent.handle(v.id, 'consent', { accepted: true });
  const before = meter.snapshot().spentThisRun;
  v = await agent.handle(v.id, 'photo', { image: FAKE_IMAGE, width: 900, height: 1200, stats: { meanLuma: 30, clippedPct: 0, contrast: 10 } });
  assert.equal(v.step, 'capture');
  assert.match(v.guidance, /light/i);
  assert.equal(meter.snapshot().spentThisRun, before);
});

test('face not found → retake; three failed attempts → human specialist offered', async () => {
  const { agent } = await mockApp();
  let v = await agent.start({ orderId: 'HH-10421' });
  v = await agent.handle(v.id, 'reason', { reason: 'wrong_shade' });
  v = await agent.handle(v.id, 'accept_mirrormatch');
  v = await agent.handle(v.id, 'consent', { accepted: true });
  for (let i = 0; i < 3; i++) {
    v = await agent.handle(v.id, 'photo', { image: FAKE_IMAGE, width: 900, height: 1200, stats: GOOD_STATS, hint: { forceError: 'error_no_face' } });
    assert.equal(v.step, 'capture');
    assert.match(v.guidance, /face/i);
  }
  assert.equal(v.canEscalate, true);
  v = await agent.handle(v.id, 'escalate');
  assert.equal(v.step, 'escalated');
  assert.match(v.escalation.ticket, /^ST-/);
});

test('analysis failing twice (non-photo error) escalates automatically', async () => {
  const { agent } = await mockApp();
  let v = await agent.start({ orderId: 'HH-10421' });
  v = await agent.handle(v.id, 'reason', { reason: 'wrong_shade' });
  v = await agent.handle(v.id, 'accept_mirrormatch');
  v = await agent.handle(v.id, 'consent', { accepted: true });
  const bad = { image: FAKE_IMAGE, width: 900, height: 1200, stats: GOOD_STATS, hint: { forceError: 'unknown_internal_error' } };
  v = await agent.handle(v.id, 'photo', bad);
  assert.equal(v.step, 'capture');
  v = await agent.handle(v.id, 'photo', bad);
  assert.equal(v.step, 'escalated');
  assert.equal(v.escalation.code, 'analysis_failed');
});

test('low match confidence escalates instead of guessing (returned shade already suits)', async () => {
  const { agent } = await mockApp();
  // Fair, neutral skin with a natural lip close to "Shell": nothing in stock is clearly better.
  const v = await runToMatches(agent, { hint: { skinHex: '#E8C4AE', lipHex: '#C98A8C' } });
  assert.equal(v.step, 'escalated');
  assert.equal(v.escalation.code, 'low_confidence');
  assert.ok(v.profile, 'tone summary still shown');
});

test('render cap: never more than 3 renders per return; repeat render request is a no-op', async () => {
  const { agent, meter } = await mockApp();
  let v = await runToMatches(agent);
  v = await agent.handle(v.id, 'render');
  await settle(agent, v.id);
  const spent = meter.snapshot().spentThisRun;
  v = await agent.handle(v.id, 'render');
  await settle(agent, v.id);
  assert.equal(agent.sessions.get(v.id).rendersUsed, 3);
  assert.equal(meter.snapshot().spentThisRun, spent);
});

test('dress return uses clothes try-on for the colourways', async () => {
  const { agent } = await mockApp();
  let v = await runToMatches(agent, { orderId: 'HH-10307', reason: 'colour_didnt_suit' });
  assert.equal(v.step, 'matches');
  assert.ok(v.picks.every((p) => p.product.category === 'dress' && p.product.id !== 'dress-wrap-camel'));
  v = await agent.handle(v.id, 'render');
  await settle(agent, v.id);
  const s = agent.sessions.get(v.id);
  const renderTools = s.trace.filter((t) => t.tool === 'render_tryon');
  assert.equal(renderTools.length, 3);
  assert.ok(renderTools.every((t) => /cloth/.test(t.summary)));
});

test('exchange is refused for a product that was not offered', async () => {
  const { agent } = await mockApp();
  const v = await runToMatches(agent);
  await assert.rejects(() => agent.handle(v.id, 'exchange', { productId: 'lip-l08' }), /not offered/);
});

test('unit floor: renders are skipped gracefully when balance is too low', async () => {
  const { agent, meter } = await mockApp();
  let v = await runToMatches(agent);
  meter.setBalance(10);
  v = await agent.handle(v.id, 'render');
  await settle(agent, v.id);
  v = agent.view(agent.sessions.get(v.id));
  assert.ok(v.renders.every((r) => r.status === 'failed'));
  assert.ok(v.renders[0].error);
  assert.equal(v.picks.length, 2, 'matches still offered without previews');
});
