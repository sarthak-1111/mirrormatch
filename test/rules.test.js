// Deterministic rules behind the new features: hair-colour ranking, skin reading → advice,
// lips for a dress colourway, blush for a lipstick, and the policy additions.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildToneProfile } from '../server/color/tone.js';
import { findAlternatives } from '../server/color/match.js';
import { scoreHair, naturalHairLevel, hairTonePenalty, hairLevelPenalty } from '../server/color/hair.js';
import { readSkin, skinSignals, skinSummary, foundationAdvice, skincareVariant, SKIN_ACTIONS } from '../server/color/skin.js';
import { lipsForDress, scoreLipForDress, blushForLip } from '../server/color/pairing.js';
import { hexToLab, labToLch } from '../server/color/color.js';
import { REASONS, reasonsFor, mirrorMatchEligibility, lookBudget, addOnPrice, POLICY } from '../server/policy/policy.js';
import { Catalog } from '../server/store/catalog.js';
import { MCP_TOOLS, hasTaskResult } from '../server/youcam/mcp.js';

const catalog = new Catalog();
const product = (id) => catalog.product(id);
// face7-like measured colours (YouCam sample): medium · warm, Auburn hair.
const warm = buildToneProfile({ skin_color: '#B48F74', lip_color: '#D89790', hair_color: '#B56637', hair_color_name: 'Auburn' });
const cool = buildToneProfile({ skin_color: '#E3C2B8', lip_color: '#C98A93', hair_color: '#42280E', hair_color_name: 'Brown' });
const deep = buildToneProfile({ skin_color: '#957056', lip_color: '#C0827C', hair_color: '#000000', hair_color_name: 'Black' });

// ---------- hair ----------
test('hair: natural level comes from the YouCam hair colour name, with a lightness fallback', () => {
  assert.equal(naturalHairLevel({ hairName: 'Black' }), 2);
  assert.equal(naturalHairLevel({ hairName: 'Blonde' }), 8);
  assert.equal(naturalHairLevel({ hairName: 'Auburn' }), 5);
  assert.ok(naturalHairLevel({ hairHex: '#E8D8B0' }) >= 8, 'light hex → light level');
  assert.ok(naturalHairLevel({ hairHex: '#1A1410' }) <= 2, 'dark hex → dark level');
});

test('hair: undertone rules (warm → golden/copper/caramel, cool → ash/burgundy) and level distance', () => {
  assert.equal(hairTonePenalty('golden', 'warm'), 0);
  assert.equal(hairTonePenalty('ash', 'warm'), 5);
  assert.equal(hairTonePenalty('burgundy', 'cool'), 0);
  assert.equal(hairTonePenalty('copper', 'cool'), 5);
  assert.equal(hairTonePenalty('natural', 'warm'), 1.5);
  assert.equal(hairTonePenalty('natural', 'neutral'), 0);
  assert.equal(hairLevelPenalty(5, 5), 0);
  assert.ok(hairLevelPenalty(7, 5) < hairLevelPenalty(8, 5), 'further from natural costs more');
  assert.ok(hairLevelPenalty(8, 5) - hairLevelPenalty(7, 5) > 1.5, 'beyond two levels the penalty climbs fast');
});

test('hair: a warm, auburn-haired shopper returning Ash Blonde gets warm shades near their level', () => {
  const r = findAlternatives({ profile: warm, returned: product('hair-h01'), products: catalog.products });
  const top = r.ranked.slice(0, 2).map((x) => x.product);
  assert.ok(top.every((p) => ['golden', 'copper', 'caramel'].includes(p.hairTone)), top.map((p) => p.shadeName).join());
  assert.ok(top.every((p) => Math.abs(p.hairLevel - 5) <= 2));
  assert.equal(r.confidence, 'high');
  assert.match(r.returnedCaution, /Ash tones can mute a warm undertone/);
  assert.match(r.ranked[0].reason, /natural auburn hair/);
  assert.ok(!r.ranked.some((x) => x.product.stock <= 0), 'out-of-stock Platinum excluded');
});

test('hair: cool undertones rank ash and burgundy first; ranking is deterministic', () => {
  const a = findAlternatives({ profile: cool, returned: product('hair-h02'), products: catalog.products });
  const b = findAlternatives({ profile: cool, returned: product('hair-h02'), products: catalog.products });
  assert.deepEqual(a.ranked.map((x) => x.product.id), b.ranked.map((x) => x.product.id));
  assert.ok(['ash', 'burgundy'].includes(a.ranked[0].product.hairTone));
  const s = scoreHair(product('hair-h09'), cool);
  assert.equal(s.components.tone, 0);
});

// ---------- skin analysis ----------
const live = {
  // Shape verified live (SD, format=json); values illustrative.
  output: [
    { type: 'oiliness', raw_score: 94.6, ui_score: 92 },
    { type: 'redness', raw_score: 100, ui_score: 99 },
    { type: 'moisture', raw_score: 88.2, ui_score: 84 },
    { type: 'skin_type', region: 'whole', skin_type: 'Normal' },
    { type: 'skin_type', region: 't_zone', skin_type: 'Normal' },
    { type: 'skin_type', region: 'u_zone', skin_type: 'Normal' },
    { type: 'all', score: 80 },
    { type: 'skin_age', score: 30 },
  ],
};
const reading = (o, m, r, type = 'Normal', tZone = type, uZone = type) =>
  readSkin({
    output: [
      { type: 'oiliness', raw_score: o },
      { type: 'moisture', raw_score: m },
      { type: 'redness', raw_score: r },
      { type: 'skin_type', region: 'whole', skin_type: type },
      { type: 'skin_type', region: 't_zone', skin_type: tZone },
      { type: 'skin_type', region: 'u_zone', skin_type: uZone },
    ],
  });

test('skin: SD only, at most 4 concerns (9 units); live output shape parses', () => {
  assert.ok(SKIN_ACTIONS.length <= 4);
  assert.ok(SKIN_ACTIONS.every((a) => !a.startsWith('hd_')));
  const s = readSkin(live);
  assert.deepEqual(s.scores, { oiliness: 94.6, moisture: 88.2, redness: 100 });
  assert.equal(s.skinType, 'normal');
  assert.equal(s.typeRedness, false);
  assert.equal(readSkin({ output: [{ type: 'skin_type', region: 'whole', skin_type: 'Oily & Redness' }] }).typeRedness, true);
  assert.equal(reading(70, 70, 90, 'Normal', 'Oily', 'Normal').skinType, 'combination', 'oily T-zone + normal cheeks');
});

test('skin → foundation advice: shine → matte/satin, thirsty → dewy, redness → a little more coverage', () => {
  assert.equal(foundationAdvice(reading(30, 70, 90)).finish, 'soft matte');
  assert.equal(foundationAdvice(reading(30, 35, 90)).finish, 'satin');
  assert.equal(foundationAdvice(reading(80, 30, 90)).finish, 'dewy');
  assert.equal(foundationAdvice(reading(80, 70, 90)).finish, 'natural');
  assert.equal(foundationAdvice(reading(80, 70, 40)).coverage, 'medium');
  assert.equal(foundationAdvice(reading(80, 70, 90)).coverage, 'light to medium');
  assert.equal(foundationAdvice(readSkin(live)).finish, 'natural');
});

test('skin → moisturiser texture by rule', () => {
  assert.equal(skincareVariant(reading(80, 30, 90)).variant, 'rich');
  assert.equal(skincareVariant(reading(30, 70, 90)).variant, 'light');
  assert.equal(skincareVariant(reading(30, 30, 90)).variant, 'balanced');
  assert.equal(skincareVariant(reading(70, 70, 90, 'Normal', 'Oily', 'Normal')).variant, 'balanced');
  assert.equal(skincareVariant(readSkin(live)).variant, 'balanced');
});

test('skin summary is kind: no numbers, no scary words, always "not a diagnosis"', () => {
  for (const s of [reading(20, 20, 20, 'Oily & Redness'), reading(90, 90, 90), readSkin(live)]) {
    const sum = skinSummary(s);
    const text = [sum.text, sum.note, ...sum.chips.map((c) => c.label), foundationAdvice(s).reason, skincareVariant(s).reason].join(' ');
    assert.ok(!/\d/.test(text), text);
    assert.ok(!/\b(bad|poor|problem|flaw|damage|disease|severe|acne|wrinkle|aging|ageing|condition)\b/i.test(text), text);
    assert.match(sum.note, /not a diagnosis/);
  }
  assert.deepEqual(Object.keys(skinSignals(readSkin(live))).sort(), ['combination', 'redness', 'shine', 'thirsty', 'wellHydrated']);
});

// ---------- lips for a dress ----------
test('lips for a dress: in stock only, deterministic, never a cool lipstick on top for a warm dress', () => {
  const marigold = product('dress-wrap-marigold');
  const a = lipsForDress({ profile: warm, dress: marigold, products: catalog.products });
  const b = lipsForDress({ profile: warm, dress: marigold, products: catalog.products });
  assert.deepEqual(a.map((x) => x.product.id), b.map((x) => x.product.id));
  assert.ok(a.every((x) => x.product.category === 'lipstick' && x.product.stock > 0));
  assert.notEqual(a[0].product.undertone, 'cool');
  assert.match(a[0].reason, /Marigold/);
  assert.match(a[0].reason, /warm undertone/);
});

test('lips for a dress: a bold dress favours a softer lip; temperature clash is penalised', () => {
  const cobalt = product('dress-wrap-cobalt'); // bold, cool
  const soft = scoreLipForDress(product('lip-l01'), warm, cobalt); // Shell, soft nude
  const bold = scoreLipForDress(product('lip-l08'), warm, cobalt); // Classic Red, bold
  assert.equal(soft.components.intensity, -1);
  assert.equal(bold.components.intensity, 1.5);
  const warmLip = scoreLipForDress(product('lip-l02'), warm, cobalt); // Bare Honey, warm
  assert.equal(warmLip.components.temperature, 3);
  const ivory = product('dress-wrap-ivory'); // quiet, neutral → bold lip can be the statement
  assert.equal(scoreLipForDress(product('lip-l08'), warm, ivory).components.intensity, -1);
});

// ---------- blush for a lipstick ----------
test('blush pairs with the lipstick hue, nudged toward the undertone, at a wearable lightness', () => {
  const lip = product('lip-l04'); // Rosewood
  const w = blushForLip({ lip, profile: warm });
  const c = blushForLip({ lip, profile: cool });
  const hw = labToLch(hexToLab(w.hex));
  const hc = labToLch(hexToLab(c.hex));
  assert.ok(hw.h > hc.h, 'warm undertone → warmer blush than cool');
  for (const x of [w, c, blushForLip({ lip, profile: deep })]) {
    const lch = labToLch(hexToLab(x.hex));
    assert.ok(lch.L >= 49 && lch.L <= 77, `L ${lch.L}`);
    assert.ok(lch.C >= 25 && lch.C <= 46, `C ${lch.C}`);
    assert.match(x.reason, /Rosewood/);
    assert.match(x.hex, /^#[0-9A-F]{6}$/);
  }
  assert.deepEqual(blushForLip({ lip, profile: warm }), w, 'deterministic');
});

// ---------- policy, transport ----------
test('policy: "didn\'t suit my skin" is for skincare only; colour reasons are not for skincare', () => {
  const order = catalog.order('HH-10462');
  assert.equal(mirrorMatchEligibility({ reason: 'didnt_suit_skin', order, category: 'skincare' }).eligible, true);
  assert.deepEqual(mirrorMatchEligibility({ reason: 'didnt_suit_skin', order, category: 'lipstick' }).why, 'reason_not_for_category');
  assert.deepEqual(mirrorMatchEligibility({ reason: 'wrong_shade', order, category: 'skincare' }).why, 'reason_not_for_category');
  assert.equal(mirrorMatchEligibility({ reason: 'wrong_shade', order, category: 'hair' }).eligible, true);
  assert.deepEqual(Object.keys(reasonsFor('skincare')), ['didnt_suit_skin', 'damaged', 'other']);
  assert.ok(!('didnt_suit_skin' in reasonsFor('dress')));
  assert.ok(REASONS.didnt_suit_skin.mirrorMatch);
});

test('policy: look previews have their own cap; the lipstick add-on is always paid in full', () => {
  assert.equal(lookBudget(0), POLICY.maxLookRendersPerReturn);
  assert.equal(lookBudget(POLICY.maxLookRendersPerReturn), 0);
  const ap = addOnPrice(product('lip-l04'));
  assert.equal(ap.allowed, true);
  assert.equal(ap.customerPays, 22);
  assert.match(ap.note, /charged separately/);
  assert.equal(addOnPrice({ ...product('lip-l04'), stock: 0 }).allowed, false);
});

test('MCP: skin analysis and hair colour map to YouCam beauty tools; results are validated', () => {
  assert.deepEqual(MCP_TOOLS['skin-analysis'], ['beauty', 'AI-Skin-Analysis']);
  assert.deepEqual(MCP_TOOLS['hair-color'], ['beauty', 'AI-Hair-Color-Virtual-Try-On']);
  assert.equal(hasTaskResult('skin-analysis', { results: { output: [] } }), true);
  assert.equal(hasTaskResult('skin-analysis', { results: {} }), false);
  assert.equal(hasTaskResult('hair-color', { results: { url: 'u' } }), true);
  assert.equal(hasTaskResult('hair-color', { error_message: 'x' }), false);
});
