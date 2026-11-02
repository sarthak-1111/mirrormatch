// Agent decision paths for the new orders and extras, end to end on the mock YouCam transport:
// hair-colour return, skincare return ("didn't suit my skin"), foundation skin reading,
// "complete the look" (lips on the dress render, lip + blush) and the opt-in add-on.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mockApp, runToMatches, settle, FAKE_IMAGE, GOOD_STATS } from './helpers.js';

const pending = (agent, id) => Promise.allSettled(agent.sessions.get(id).pending ?? []);
const tools = (agent, id) => agent.sessions.get(id).trace.filter((t) => t.kind === 'tool');

async function toPhoto(agent, orderId, reason) {
  let v = await agent.start({ orderId });
  v = await agent.handle(v.id, 'reason', { reason });
  if (v.step !== 'offer') return v;
  v = await agent.handle(v.id, 'accept_mirrormatch');
  return agent.handle(v.id, 'consent', { accepted: true });
}

test('hair return: tone analysis → hair ranking → 3 hair-color renders (1 unit each) → exchange', async () => {
  const { agent } = await mockApp();
  let v = await runToMatches(agent, { orderId: 'HH-10455', hint: { skinHex: '#B48F74', lipHex: '#D89790' } });
  assert.equal(v.step, 'matches');
  assert.equal(v.returned.category, 'hair');
  assert.equal(v.picks.length, 2);
  assert.ok(v.picks.every((p) => p.product.category === 'hair' && p.product.id !== 'hair-h01'));
  v = await agent.handle(v.id, 'render');
  await settle(agent, v.id);
  v = agent.view(agent.sessions.get(v.id));
  assert.deepEqual(v.renders.map((r) => r.status), ['done', 'done', 'done']);
  const renders = tools(agent, v.id).filter((t) => t.tool === 'render_tryon');
  assert.equal(renders.length, 3);
  assert.ok(renders.every((t) => /via hair-color/.test(t.summary) && t.units === 1), renders.map((t) => t.summary).join(' | '));
  v = await agent.handle(v.id, 'exchange', { productId: v.picks[0].product.id });
  assert.equal(v.step, 'exchanged');
});

test('skincare return: "didn\'t suit my skin" → skin analysis (9 units) → texture picks, no try-on', async () => {
  const { agent } = await mockApp();
  let v = await toPhoto(agent, 'HH-10462', 'didnt_suit_skin');
  assert.equal(v.step, 'capture');
  v = await agent.handle(v.id, 'photo', { image: FAKE_IMAGE, width: 900, height: 1200, stats: GOOD_STATS });
  assert.equal(v.step, 'matches');
  assert.equal(v.profile, null, 'no tone analysis for skincare');
  assert.equal(v.skin.status, 'done');
  assert.equal(v.skin.variant.variant, 'light');
  assert.equal(v.picks[0].product.id, 'care-light');
  assert.ok(v.picks.every((p) => p.score < v.matches.returnedScore), 'only textures that suit better than the returned one');
  const t = tools(agent, v.id);
  assert.ok(!t.some((x) => x.tool === 'analyze_skin_tone'));
  const skin = t.find((x) => x.tool === 'analyze_skin');
  assert.equal(skin.units, 9);
  assert.match(skin.summary, /skin-analysis SD/);
  v = await agent.handle(v.id, 'render');
  assert.equal(v.renders.length, 0, 'render is a no-op for skincare');
  v = await agent.handle(v.id, 'exchange', { productId: 'care-light' });
  assert.equal(v.step, 'exchanged');
  assert.match(v.exchange.toName, /Light gel/);
});

test('reasons by category: colour reasons do not open MirrorMatch for skincare, and vice versa', async () => {
  const { agent } = await mockApp();
  let v = await toPhoto(agent, 'HH-10462', 'wrong_shade');
  assert.equal(v.step, 'refund_review');
  assert.equal(v.notEligibleWhy, 'reason_not_for_category');
  v = await toPhoto(agent, 'HH-10421', 'didnt_suit_skin');
  assert.equal(v.step, 'refund_review');
  v = await toPhoto(agent, 'HH-10455', 'colour_didnt_suit');
  assert.equal(v.step, 'capture', 'hair colour is a colour product');
});

test('skincare: when the returned texture already suits the reading, escalate instead of guessing', async () => {
  const { agent } = await mockApp();
  let v = await toPhoto(agent, 'HH-10462', 'didnt_suit_skin');
  v = await agent.handle(v.id, 'photo', { image: FAKE_IMAGE, width: 900, height: 1200, stats: GOOD_STATS, hint: { skin: { oiliness: 85, moisture: 30, redness: 90, type: 'Dry', tZone: 'Dry', uZone: 'Dry' } } });
  assert.equal(v.step, 'escalated');
  assert.equal(v.escalation.code, 'low_confidence');
  assert.match(v.escalation.message, /skincare specialist/);
});

test('skincare: skin-analysis failures → retake guidance, then a human after two', async () => {
  const { agent } = await mockApp();
  let v = await toPhoto(agent, 'HH-10462', 'didnt_suit_skin');
  v = await agent.handle(v.id, 'photo', { image: FAKE_IMAGE, width: 900, height: 1200, stats: GOOD_STATS, hint: { forceSkinError: 'error_no_face' } });
  assert.equal(v.step, 'capture');
  assert.match(v.guidance, /face/i);
  const bad = { image: FAKE_IMAGE, width: 900, height: 1200, stats: GOOD_STATS, hint: { forceSkinError: 'error_inference' } };
  v = await agent.handle(v.id, 'photo', bad);
  v = await agent.handle(v.id, 'photo', bad);
  assert.equal(v.step, 'escalated');
  assert.equal(v.escalation.code, 'analysis_failed');
});

test('skincare: a photo too small for skin analysis fails free, before any upload', async () => {
  const { agent, meter } = await mockApp();
  let v = await toPhoto(agent, 'HH-10462', 'didnt_suit_skin');
  v = await agent.handle(v.id, 'photo', { image: FAKE_IMAGE, width: 400, height: 600, stats: GOOD_STATS });
  assert.equal(v.step, 'capture');
  assert.equal(meter.snapshot().spentThisRun, 0);
});

test('foundation: background skin reading adds finish + coverage advice without blocking matches', async () => {
  const { agent } = await mockApp();
  let v = await runToMatches(agent, { orderId: 'HH-10388' });
  assert.equal(v.step, 'matches', 'matches shown straight away');
  assert.equal(v.skin.status, 'running');
  await pending(agent, v.id);
  v = agent.view(agent.sessions.get(v.id));
  assert.equal(v.skin.status, 'done');
  assert.equal(v.skin.advice.finish, 'soft matte'); // mock reading: a little shine
  assert.equal(v.skin.advice.coverage, 'medium'); // mock reading: some redness
  assert.ok(!JSON.stringify(v.skin).match(/raw_score|ui_score/), 'no raw scores in the view');
});

test('foundation: if the skin reading fails, the card is skipped and the exchange still works', async () => {
  const { agent } = await mockApp();
  let v = await runToMatches(agent, { orderId: 'HH-10388', hint: { skinHex: '#B9947C', lipHex: '#B5636A', forceSkinError: 'error_inference' } });
  await pending(agent, v.id);
  v = agent.view(agent.sessions.get(v.id));
  assert.equal(v.skin.status, 'failed');
  assert.match(v.skin.message, /doesn't depend on it/);
  v = await agent.handle(v.id, 'exchange', { productId: v.picks[0].product.id });
  assert.equal(v.step, 'exchanged');
});

test('complete the look: lips on the dress render (1 unit), opt-in add-on, cap and cleanup', async () => {
  const { agent, youcam } = await mockApp();
  let v = await runToMatches(agent, { orderId: 'HH-10307', reason: 'colour_didnt_suit' });
  const dress = v.picks[0].product.id;
  await assert.rejects(() => agent.handle(v.id, 'look_lips', { dressId: dress }), /not ready/);
  v = await agent.handle(v.id, 'render');
  await settle(agent, v.id);
  v = await agent.handle(v.id, 'look_lips', { dressId: dress });
  assert.equal(v.looks.length, 1);
  assert.equal(v.looks[0].status, 'rendering');
  await pending(agent, v.id);
  v = agent.view(agent.sessions.get(v.id));
  const look = v.looks[0];
  assert.equal(look.status, 'done');
  assert.ok(look.url);
  assert.equal(look.lip.category, 'lipstick');
  assert.match(look.lipReason, new RegExp(v.picks[0].product.shadeName));
  assert.equal(look.addOn.customerPays, look.lip.price);
  assert.equal(v.renders.length, 3, 'looks do not count as core renders');
  assert.equal(v.rendersUsed, 3);
  const t = tools(agent, v.id);
  assert.ok(t.some((x) => x.tool === 'pair_lip_with_dress'));
  const lr = t.find((x) => x.tool === 'render_look');
  assert.equal(lr.units, 1);
  assert.match(lr.summary, /makeup-vto/);
  // The look was rendered on the uploaded clothes try-on output, not on the original photo.
  const task = [...youcam.tasks.values()].find((x) => x.feature === 'makeup-vto');
  assert.equal(task.body.effects.find((e) => e.category === 'lip_color').palettes[0].color, look.lip.hex);
  // Idempotent per dress; once the extras cap is used up, no more look previews run.
  v = await agent.handle(v.id, 'look_lips', { dressId: dress });
  assert.equal(v.looks.length, 1);
  agent.sessions.get(v.id).looksUsed = 2;
  await assert.rejects(() => agent.handle(v.id, 'look_lips', { dressId: v.picks[1].product.id }), /limit/);
  agent.sessions.get(v.id).looksUsed = 1;
  v = await agent.handle(v.id, 'look_lips', { dressId: v.picks[1].product.id });
  await pending(agent, v.id);
  assert.equal(agent.view(agent.sessions.get(v.id)).looks.length, 2);
  // An add-on that wasn't shown is refused; the opted-in one is priced separately.
  await assert.rejects(() => agent.handle(v.id, 'exchange', { productId: dress, addOnId: 'lip-l08' }), /not offered/);
  v = await agent.handle(v.id, 'exchange', { productId: dress, addOnId: look.lipId });
  assert.equal(v.step, 'exchanged');
  assert.equal(v.exchange.price.customerPays, 0, 'the exchange itself stays free');
  assert.equal(v.exchange.addOn.id, look.lipId);
  assert.equal(v.exchange.addOn.customerPays, look.lip.price);
  await settle(agent, v.id);
  await pending(agent, v.id);
  await new Promise((r) => setTimeout(r, 20));
  const s = agent.sessions.get(v.id);
  assert.ok(s.renders.every((r) => r.buffer === null), 'look previews wiped with the photo');
  const cleanup = s.trace.find((x) => x.kind === 'cleanup');
  // tone task + 3 clothes renders + the look (the second look was a mock cache hit: same bytes).
  assert.match(cleanup.summary, /deleted 5\/5/, 'every YouCam task, looks included, deleted on YouCam');
});

test('complete the look: exchange without the add-on has no add-on (never pre-selected)', async () => {
  const { agent } = await mockApp();
  let v = await runToMatches(agent, { orderId: 'HH-10307', reason: 'colour_didnt_suit' });
  v = await agent.handle(v.id, 'render');
  await settle(agent, v.id);
  v = await agent.handle(v.id, 'look_lips', { dressId: v.picks[0].product.id });
  await pending(agent, v.id);
  v = await agent.handle(v.id, 'exchange', { productId: v.picks[0].product.id });
  assert.equal(v.step, 'exchanged');
  assert.equal(v.exchange.addOn, undefined);
});

test('lipstick: matching blush renders lip + blush in one makeup-vto call (1 unit); trace has no colours', async () => {
  const { agent, youcam } = await mockApp();
  let v = await runToMatches(agent);
  v = await agent.handle(v.id, 'render');
  await settle(agent, v.id);
  const lip = v.picks[0].product;
  v = await agent.handle(v.id, 'look_blush', { lipId: lip.id });
  await pending(agent, v.id);
  v = agent.view(agent.sessions.get(v.id));
  const look = v.looks.find((l) => l.kind === 'lip_blush');
  assert.equal(look.status, 'done');
  assert.match(look.blush.reason, new RegExp(lip.shadeName));
  const call = [...youcam.tasks.values()].filter((x) => x.feature === 'makeup-vto').pop();
  const cats = call.body.effects.map((e) => e.category);
  assert.deepEqual(cats, ['skin_smooth', 'lip_color', 'blush']);
  assert.equal(call.body.effects[2].pattern.name, '1color1');
  assert.equal(tools(agent, v.id).filter((x) => x.tool === 'render_look').reduce((n, x) => n + x.units, 0), 1);
  assert.ok(!/#[0-9A-F]{6}/i.test(JSON.stringify(agent.sessions.get(v.id).trace)), 'no hex colours in trace');
  await assert.rejects(() => agent.handle(v.id, 'look_lips', { dressId: 'dress-wrap-cobalt' }), /dress returns/);
});

test('look previews respect the unit floor: friendly failure, exchange unaffected', async () => {
  const { agent, meter } = await mockApp();
  let v = await runToMatches(agent);
  v = await agent.handle(v.id, 'render');
  await settle(agent, v.id);
  meter.setBalance(10);
  v = await agent.handle(v.id, 'look_blush', { lipId: v.picks[0].product.id });
  await pending(agent, v.id);
  v = agent.view(agent.sessions.get(v.id));
  assert.equal(v.looks[0].status, 'failed');
  assert.ok(v.looks[0].error);
  v = await agent.handle(v.id, 'exchange', { productId: v.picks[0].product.id });
  assert.equal(v.step, 'exchanged');
});
