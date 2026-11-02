import { test } from 'node:test';
import assert from 'node:assert/strict';
import { priceDifference, mirrorMatchEligibility, checkStockAndPolicy, renderBudget, POLICY } from '../server/policy/policy.js';
import { validateRewrite } from '../server/agent/llm.js';
import { guidanceFor, qualityIssues } from '../server/youcam/errors.js';
import { UnitMeter } from '../server/youcam/meter.js';
import { aggregate, recordsFromEvents } from '../server/store/events.js';

const now = new Date('2026-11-02T12:00:00Z');
const order = { id: 'O1', deliveredOn: '2026-10-25' };
const p = (id, price, stock = 5, category = 'lipstick') => ({ id, price, stock, category, shadeName: id });

test('MirrorMatch only for colour reasons within the return window', () => {
  assert.equal(mirrorMatchEligibility({ reason: 'wrong_shade', order, now }).eligible, true);
  assert.equal(mirrorMatchEligibility({ reason: 'colour_didnt_suit', order, now }).eligible, true);
  assert.equal(mirrorMatchEligibility({ reason: 'damaged', order, now }).eligible, false);
  assert.equal(mirrorMatchEligibility({ reason: 'other', order, now }).eligible, false);
  assert.equal(mirrorMatchEligibility({ reason: 'wrong_shade', order: { deliveredOn: '2026-09-01' }, now }).why, 'outside_return_window');
  assert.equal(mirrorMatchEligibility({ reason: 'bogus', order, now }).eligible, false);
});

test('price difference rules', () => {
  assert.equal(priceDifference(p('a', 22), p('b', 22)).type, 'even');
  const absorb = priceDifference(p('a', 22), p('b', 26));
  assert.equal(absorb.type, 'merchant_absorbs');
  assert.equal(absorb.merchantAbsorbs, 4);
  assert.equal(absorb.customerPays, 0);
  const tooMuch = priceDifference(p('a', 22), p('b', 30));
  assert.equal(tooMuch.allowed, false);
  assert.equal(tooMuch.customerPays, 8);
  const cheaper = priceDifference(p('a', 68), p('b', 62));
  assert.equal(cheaper.type, 'refund_difference');
  assert.equal(cheaper.refundToCustomer, 6);
  assert.equal(priceDifference(p('a', 22), p('b', 21)).type, 'even', 'tiny differences are even');
});

test('stock and policy check', () => {
  const ok = checkStockAndPolicy({ order, returned: p('a', 22), alternative: p('b', 22), reason: 'wrong_shade', now });
  assert.equal(ok.allowed, true);
  assert.equal(ok.shipsToday, true);
  const noStock = checkStockAndPolicy({ order, returned: p('a', 22), alternative: p('b', 22, 0), reason: 'wrong_shade', now });
  assert.equal(noStock.allowed, false);
  assert.ok(noStock.checks.some((c) => c.rule === 'in stock' && !c.ok));
  const wrongCat = checkStockAndPolicy({ order, returned: p('a', 22), alternative: p('b', 22, 3, 'dress'), reason: 'wrong_shade', now });
  assert.equal(wrongCat.allowed, false);
  const damaged = checkStockAndPolicy({ order, returned: p('a', 22), alternative: p('b', 22), reason: 'damaged', now });
  assert.equal(damaged.allowed, false);
});

test('render budget caps at 3 per return', () => {
  assert.equal(POLICY.maxRendersPerReturn, 3);
  assert.equal(renderBudget(0), 3);
  assert.equal(renderBudget(2), 1);
  assert.equal(renderBudget(5), 0);
});

test('LLM rewrites are validated: no judgemental words, facts kept, length bounded', () => {
  assert.ok(validateRewrite('Your skin has a lovely warm, golden undertone at a medium depth.', { mustInclude: ['warm'] }));
  assert.ok(!validateRewrite('Your sallow skin has a warm undertone.', { mustInclude: ['warm'] }));
  assert.ok(!validateRewrite('Your skin has a golden undertone.', { mustInclude: ['warm'] }), 'must keep the fact');
  assert.ok(!validateRewrite('x'.repeat(500)));
  assert.ok(!validateRewrite('We guarantee this warm shade will match.', { mustInclude: ['warm'] }));
});

test('error codes map to kind, actionable guidance', () => {
  assert.equal(guidanceFor('error_no_face').retake, true);
  assert.match(guidanceFor('error_face_angle_leftward').message, /right/);
  assert.equal(guidanceFor('CreditInsufficiency').retake, false);
  assert.equal(guidanceFor('totally_unknown').retake, false);
  assert.deepEqual(qualityIssues({ has_face: true, area: 'good', frontal: 'good', lighting: 'good', faceangle: 'good' }), []);
  assert.ok(qualityIssues({ has_face: true, lighting: 'bad' }).includes('lighting'));
  assert.ok(qualityIssues({ has_face: false }).includes('error_no_face'));
});

test('unit meter: costs from feature-cost SKUs, charges only on success', () => {
  const m = new UnitMeter();
  m.setCostsFromSkus([
    { amount: 20, run_task_url: 'https://yce-api-01.makeupar.com/s2s/v2.0/task/skin-tone-analysis' },
    { amount: 3, run_task_url: 'https://yce-api-01.makeupar.com/s2s/v2.0/task/cloth-v4' },
  ]);
  assert.equal(m.costSource, 'api');
  assert.equal(m.costOf('cloth-v4'), 3);
  m.setBalance(100);
  m.record({ feature: 'skin-tone-analysis', ok: false, ms: 10 });
  assert.equal(m.balance, 100);
  m.record({ feature: 'skin-tone-analysis', ok: true, ms: 10 });
  m.record({ feature: 'makeup-vto', ok: true, ms: 10 });
  assert.equal(m.balance, 79);
  assert.equal(m.snapshot().spentThisRun, 21);
});

test('dashboard aggregates live events per session without double counting', () => {
  const ev = [
    { type: 'return_started', sessionId: 's1', productId: 'lip-l01', category: 'lipstick', price: 22 },
    { type: 'mirrormatch_offered', sessionId: 's1' },
    { type: 'mirrormatch_accepted', sessionId: 's1' },
    { type: 'tone_analyzed', sessionId: 's1', profileKey: 'deep-warm' },
    { type: 'exchange_created', sessionId: 's1', toProductId: 'lip-l03' },
    { type: 'return_started', sessionId: 's2', productId: 'lip-l01', category: 'lipstick', price: 22 },
    { type: 'refund_chosen', sessionId: 's2' },
  ];
  const { kpis, heat } = aggregate(recordsFromEvents(ev));
  assert.equal(kpis.returnsStarted, 2);
  assert.equal(kpis.exchanges, 1);
  assert.equal(kpis.refunds, 1);
  assert.equal(kpis.refundValueRetained, 22);
  assert.equal(kpis.exchangeRate, 0.5);
  assert.equal(heat['lip-l01']['deep-warm'], 1);
});
