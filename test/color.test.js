import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hexToLab, labToHex, deltaE2000, deltaEHex, ita, labToLch, lchToLab } from '../server/color/color.js';
import { buildToneProfile, depthFromIta, undertoneFromHue } from '../server/color/tone.js';
import { findAlternatives, scoreProduct, undertonePenalty, lipTarget } from '../server/color/match.js';
import { Catalog } from '../server/store/catalog.js';

const close = (a, b, eps = 0.01) => assert.ok(Math.abs(a - b) <= eps, `${a} ≉ ${b}`);

test('sRGB → CIELAB matches reference values (D65)', () => {
  const white = hexToLab('#FFFFFF');
  close(white.L, 100, 0.01);
  close(white.a, 0, 0.01);
  close(white.b, 0, 0.01);
  const red = hexToLab('#FF0000');
  close(red.L, 53.24, 0.05);
  close(red.a, 80.09, 0.05);
  close(red.b, 67.2, 0.05);
  const black = hexToLab('#000000');
  close(black.L, 0, 0.001);
});

test('Lab → hex round-trips', () => {
  for (const hex of ['#B9947C', '#2350A6', '#E0A526', '#5C2840']) {
    assert.equal(labToHex(hexToLab(hex)), hex);
  }
  const lch = labToLch(hexToLab('#B9947C'));
  const back = lchToLab(lch);
  close(back.a, hexToLab('#B9947C').a, 1e-9);
});

// Sharma, Wu & Dalal (2005) CIEDE2000 test data, pairs 1, 7, 15, 18, 25, 34.
test('CIEDE2000 matches published test pairs', () => {
  const pairs = [
    [{ L: 50, a: 2.6772, b: -79.7751 }, { L: 50, a: 0, b: -82.7485 }, 2.0425],
    [{ L: 50, a: 0, b: 0 }, { L: 50, a: -1, b: 2 }, 2.3669],
    [{ L: 50, a: 2.49, b: -0.001 }, { L: 50, a: -2.49, b: 0.0011 }, 7.2195],
    [{ L: 50, a: 2.5, b: 0 }, { L: 73, a: 25, b: -18 }, 27.1492],
    [{ L: 60.2574, a: -34.0099, b: 36.2677 }, { L: 60.4626, a: -34.1751, b: 39.4387 }, 1.2644],
    [{ L: 22.7233, a: 20.0904, b: -46.694 }, { L: 23.0331, a: 14.973, b: -42.5619 }, 2.0373],
  ];
  for (const [a, b, expected] of pairs) close(deltaE2000(a, b), expected, 0.0001);
  assert.equal(deltaE2000({ L: 40, a: 10, b: 10 }, { L: 40, a: 10, b: 10 }), 0);
  close(deltaEHex('#B9947C', '#BF9468'), deltaEHex('#BF9468', '#B9947C'), 1e-9);
});

test('ITA depth bands follow Chardon thresholds', () => {
  assert.equal(depthFromIta(60).id, 'fair');
  assert.equal(depthFromIta(45).id, 'light');
  assert.equal(depthFromIta(30).id, 'medium');
  assert.equal(depthFromIta(15).id, 'tan');
  assert.equal(depthFromIta(0).id, 'deep');
  assert.equal(depthFromIta(-45).id, 'rich');
  close(ita({ L: 50, b: 20 }), 0, 1e-9);
});

test('undertone from hue angle, with a depth-aware shift', () => {
  assert.equal(undertoneFromHue(48), 'cool');
  assert.equal(undertoneFromHue(56), 'neutral');
  assert.equal(undertoneFromHue(64), 'warm');
  assert.equal(undertoneFromHue(50.5, 40), 'neutral', 'deep skin: 50.5° is not cool');
  assert.equal(undertoneFromHue(58, 40), 'warm');
});

test('tone profile from a YouCam colour result', () => {
  const p = buildToneProfile({ skin_color: '#c69c80', lip_color: '#B86A5E', hair_color: '#42280E', eye_color_name: 'Brown', hair_color_name: 'Brown' });
  assert.equal(p.undertone, 'warm');
  assert.equal(p.depthGroup, 'medium');
  assert.equal(p.profileKey, 'medium-warm');
  assert.equal(p.contrast, 'high');
  assert.equal(p.skinHex, '#C69C80');
  assert.throws(() => buildToneProfile({}), /skin_color/);
});

test('undertone penalty is symmetric and graded', () => {
  assert.equal(undertonePenalty('warm', 'warm'), 0);
  assert.equal(undertonePenalty('neutral', 'warm'), 1.5);
  assert.equal(undertonePenalty('cool', 'warm'), 5);
  assert.equal(undertonePenalty('warm', 'cool'), 5);
});

test('lip target is deeper and richer than the natural lip, nudged by undertone', () => {
  const warm = buildToneProfile({ skin_color: '#c69c80', lip_color: '#B86A5E' });
  const t = labToLch(lipTarget(warm));
  const lip = labToLch(hexToLab('#B86A5E'));
  assert.ok(t.L < lip.L);
  assert.ok(t.C > lip.C);
  assert.ok(t.h > lip.h, 'warm shifts hue toward orange');
});

const catalog = new Catalog();
const P = (id) => catalog.product(id);

test('foundation: best match is the nearest shade by ΔE2000, returned shade excluded', () => {
  const profile = buildToneProfile({ skin_color: P('fdn-5w').hex, lip_color: '#9A5A4E' });
  const r = findAlternatives({ profile, returned: P('fdn-3w'), products: catalog.products });
  assert.equal(r.ranked[0].product.id, 'fdn-5w');
  assert.ok(r.ranked[0].deltaE < 0.5);
  assert.ok(r.ranked.every((x) => x.product.id !== 'fdn-3w'));
  assert.equal(r.confidence, 'high');
});

test('alternatives stay in category and price band and are in stock', () => {
  const profile = buildToneProfile({ skin_color: '#8D5B42', lip_color: '#8A4A45', hair_color: '#000000' });
  for (const id of ['lip-l01', 'fdn-3w', 'dress-wrap-camel']) {
    const returned = P(id);
    const r = findAlternatives({ profile, returned, products: catalog.products });
    for (const x of r.ranked) {
      assert.equal(x.product.category, returned.category);
      assert.ok(x.product.stock > 0);
      assert.ok(Math.abs(x.product.price - returned.price) / returned.price <= 0.25);
      assert.ok(x.reason.length > 10, 'every pick has a reason');
    }
    // ranking is sorted by score
    for (let i = 1; i < r.ranked.length; i++) assert.ok(r.ranked[i - 1].score <= r.ranked[i].score);
  }
});

test('out-of-stock shades are excluded and listed with a reason', () => {
  const profile = buildToneProfile({ skin_color: '#c69c80', lip_color: '#B5162F' });
  const r = findAlternatives({ profile, returned: P('lip-l04'), products: catalog.products, limit: 20 });
  assert.ok(!r.ranked.some((x) => x.product.id === 'lip-l08'), 'Classic Red has stock 0');
  assert.ok(r.excluded.some((e) => e.id === 'lip-l08' && e.why === 'out of stock'));
});

test('lipstick: a pale nude on deeper skin gets the "chalky" caution', () => {
  const deep = buildToneProfile({ skin_color: '#7A4E38', lip_color: '#7E4238', hair_color: '#000000' });
  const s = scoreProduct(P('lip-l01'), deep, null);
  assert.ok(s.components.chalk > 0);
  assert.match(s.caution, /chalky/);
});

test('dress: colours close to the skin tone are penalised; contrast wins', () => {
  const medium = buildToneProfile({ skin_color: '#BF9468', lip_color: '#A85A4A', hair_color: '#000000' });
  const camel = scoreProduct(P('dress-wrap-camel'), medium, null);
  const cobalt = scoreProduct(P('dress-wrap-cobalt'), medium, null);
  assert.ok(camel.score > cobalt.score);
  assert.match(camel.reason, /washed out/);
});

test('matching is deterministic', () => {
  const profile = buildToneProfile({ skin_color: '#b9947c', lip_color: '#B5636A', hair_color: '#FAF0BE' });
  const a = findAlternatives({ profile, returned: P('lip-l01'), products: catalog.products });
  const b = findAlternatives({ profile, returned: P('lip-l01'), products: catalog.products });
  assert.deepEqual(a.ranked.map((x) => [x.product.id, x.score]), b.ranked.map((x) => [x.product.id, x.score]));
});
