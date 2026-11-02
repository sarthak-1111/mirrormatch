// "Who is each shade for?" matrix, gap cards and the colour-passport matcher.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Catalog } from '../server/store/catalog.js';
import { fitMatrix, gapCounts, lowConfidenceEscalations, passportMatches, FIT_CATEGORIES, FIT_SOURCE } from '../server/store/fit.js';
import { PROFILE_KEYS } from '../server/store/insights.js';
import { scoreProduct, fitConfidence } from '../server/color/match.js';
import { representativeProfile } from '../server/store/insights.js';

test('fit matrix: one row per catalogue product, one column per reference profile', () => {
  const catalog = new Catalog();
  for (const category of FIT_CATEGORIES) {
    const m = fitMatrix({ catalog, category });
    const n = catalog.products.filter((p) => p.category === category).length;
    assert.equal(m.source, FIT_SOURCE);
    assert.equal(m.products.length, n);
    assert.equal(m.cells.length, n);
    assert.deepEqual(m.profiles.map((p) => p.key), PROFILE_KEYS);
    for (const row of m.cells) {
      assert.equal(row.length, PROFILE_KEYS.length);
      for (const c of row) assert.ok(['great', 'good', 'poor'].includes(c.level) && typeof c.score === 'number');
    }
  }
});

test('fit matrix cells use the same scorer and thresholds as the shopper matcher', () => {
  const catalog = new Catalog();
  const m = fitMatrix({ catalog, category: 'lipstick' });
  const i = m.products.findIndex((p) => p.id === 'lip-l02');
  const j = PROFILE_KEYS.indexOf('light-warm');
  const r = scoreProduct(catalog.product('lip-l02'), representativeProfile('light-warm'), null);
  assert.equal(m.cells[i][j].score, r.score);
  assert.equal(m.cells[i][j].level, { high: 'great', medium: 'good', low: 'poor' }[fitConfidence('lipstick', r)]);
});

test('every product fits at least one reference profile, or is called out in a note', () => {
  const catalog = new Catalog();
  for (const category of FIT_CATEGORIES) {
    const m = fitMatrix({ catalog, category });
    const noted = new Set(m.notes.flatMap((n) => n.productIds));
    m.products.forEach((p, i) => {
      const fits = m.cells[i].some((c) => c.level !== 'poor');
      assert.ok(fits || noted.has(p.id), `${p.id} neither fits nor is noted`);
    });
  }
});

test('a sold-out shade leaves deep-warm lipstick with one option: a thin-coverage card says restock it', () => {
  const catalog = new Catalog();
  const m = fitMatrix({ catalog, category: 'lipstick' });
  const thin = m.gaps.find((g) => g.kind === 'thin' && g.profileKey === 'deep-warm');
  assert.ok(thin, 'expected a thin-coverage card for deep-warm');
  assert.equal(thin.onlyName, 'Cinnamon');
  assert.deepEqual(thin.soldOutFits, ['Classic Red']);
  assert.match(thin.text, /Restocking Classic Red/);
});

test('when stock runs out, a thin profile becomes a range gap', () => {
  const catalog = new Catalog();
  catalog.product('lip-l11').stock = 0; // Cinnamon
  const m = fitMatrix({ catalog, category: 'lipstick' });
  const gap = m.gaps.find((g) => g.kind === 'range' && g.profileKey === 'deep-warm');
  assert.ok(gap);
  assert.match(gap.text, /^No lipstick in stock suits deep · warm profiles well: a gap in your range\./);
  assert.equal(gapCounts({ catalog }).lipstick >= 1, true);
});

test('live low-confidence escalations are joined to the session profile and mentioned on the card', () => {
  const events = [
    { type: 'return_started', sessionId: 's1', category: 'lipstick', productId: 'lip-l01' },
    { type: 'tone_analyzed', sessionId: 's1', profileKey: 'deep-warm' },
    { type: 'escalated', sessionId: 's1', code: 'low_confidence' },
    { type: 'return_started', sessionId: 's2', category: 'lipstick', productId: 'lip-l01' },
    { type: 'tone_analyzed', sessionId: 's2', profileKey: 'deep-warm' },
    { type: 'escalated', sessionId: 's2', code: 'customer_request' }, // not a matching failure
  ];
  const esc = lowConfidenceEscalations(events);
  assert.deepEqual(esc, { lipstick: { 'deep-warm': 1 } });
  const catalog = new Catalog();
  const m = fitMatrix({ catalog, category: 'lipstick', liveEscalations: esc });
  const card = m.gaps.find((g) => g.profileKey === 'deep-warm');
  assert.equal(card.liveEscalations, 1);
  assert.match(card.text, /1 live return was escalated/);
});

test('colour passport: top two in-stock picks per category, with reasons, and strict hex validation', () => {
  const catalog = new Catalog();
  const r = passportMatches({ catalog, skinHex: '#B9947C', lipHex: '#B5636A', hairHex: '#2A1B12' });
  assert.ok(r.profile.summary.includes(r.profile.undertone));
  for (const category of FIT_CATEGORIES) {
    assert.equal(r.picks[category].length, 2);
    for (const p of r.picks[category]) {
      assert.ok(catalog.product(p.id).stock > 0, `${p.id} in stock`);
      assert.ok(p.reason.length > 10);
    }
  }
  assert.throws(() => passportMatches({ catalog, skinHex: 'B9947C' }), /skinHex/);
  assert.throws(() => passportMatches({ catalog, skinHex: '#B9947C', lipHex: 'red' }), /lipHex/);
  assert.throws(() => passportMatches({ catalog }), /skinHex/);
});
