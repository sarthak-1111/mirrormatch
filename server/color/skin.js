// YouCam AI Skin Analysis (SD) → a kind "Your skin today" reading and deterministic advice.
// YouCam scores every concern 1–100 where HIGHER means healthier (less shine, more moisture,
// less redness). We use raw_score (ui_score is deliberately inflated, per the docs) against fixed,
// documented thresholds. These are heuristics for choosing a finish or a moisturiser variant,
// not a diagnosis, and no numbers are shown to the shopper.

// SD concerns only (SD and HD can't be mixed). 1–4 SD concerns cost 9 units.
export const SKIN_ACTIONS = ['oiliness', 'moisture', 'redness', 'skin_type'];

export const SKIN_THRESHOLDS = {
  shineBelow: 50, // oiliness raw_score below this → visible shine
  lowMoistureBelow: 50, // moisture raw_score below this → could use more hydration
  wellHydratedFrom: 72, // moisture raw_score from this → well hydrated
  rednessBelow: 60, // redness raw_score below this → some visible redness
};

const TYPE_WORDS = ['combination', 'normal', 'oily', 'dry'];

/** Parse a skin-type label such as "Normal", "Oily", "Combination & Redness". */
export function parseSkinType(label) {
  const words = String(label ?? '').toLowerCase().split(/[^a-z]+/);
  return { type: TYPE_WORDS.find((w) => words.includes(w)) ?? null, redness: words.includes('redness') };
}

/**
 * Normalise YouCam's `results.output[]` (format=json) into scores + skin type.
 * Verified live (SD): concern items are `{ type, raw_score, ui_score, mask_urls }`; skin type
 * comes as three items `{ type: "skin_type", region: "whole"|"t_zone"|"u_zone", skin_type: "Normal" }`;
 * there are also `all`, `skin_age` and `resize_image` items, which we ignore.
 * The score_info.json shape of format=zip (`{ oiliness: { raw_score } }`) is accepted too.
 */
export function readSkin(results) {
  const out = Array.isArray(results?.output) ? results.output : Array.isArray(results) ? results : null;
  const scores = {};
  const types = {};
  if (out) {
    for (const it of out) {
      const key = String(it?.type ?? '').replace(/^hd_/, '');
      if (key === 'skin_type') types[it.region || 'whole'] = parseSkinType(it.skin_type ?? it.label);
      else if (typeof it?.raw_score === 'number' && (!it.region || it.region === 'whole' || scores[key] === undefined)) scores[key] = it.raw_score;
    }
  } else if (results && typeof results === 'object') {
    for (const [k, v] of Object.entries(results)) {
      if (k === 'skin_type') types.whole = parseSkinType(typeof v === 'string' ? v : v?.skin_type);
      else if (typeof v?.raw_score === 'number') scores[k.replace(/^hd_/, '')] = v.raw_score;
    }
  }
  const whole = types.whole ?? { type: null, redness: false };
  // An oily T-zone with normal or dry cheeks reads as combination, whatever "whole" says.
  const combo = types.t_zone?.type === 'oily' && ['normal', 'dry'].includes(types.u_zone?.type);
  return {
    scores: {
      oiliness: round(scores.oiliness),
      moisture: round(scores.moisture),
      redness: round(scores.redness),
    },
    skinType: combo && whole.type !== 'oily' ? 'combination' : whole.type,
    typeRedness: Object.values(types).some((t) => t.redness),
  };
}

const round = (v) => (typeof v === 'number' ? Math.round(v * 10) / 10 : null);

/** Boolean signals from the scores, with the skin-type label as a tie-breaker. */
export function skinSignals(skin) {
  const s = skin?.scores ?? {};
  const T = SKIN_THRESHOLDS;
  const type = skin?.skinType;
  const shine = (s.oiliness != null && s.oiliness < T.shineBelow) || type === 'oily';
  const combination = type === 'combination';
  const thirsty = (s.moisture != null && s.moisture < T.lowMoistureBelow) || type === 'dry';
  const wellHydrated = s.moisture != null && s.moisture >= T.wellHydratedFrom && !thirsty;
  const redness = (s.redness != null && s.redness < T.rednessBelow) || Boolean(skin?.typeRedness);
  return { shine, combination, thirsty, wellHydrated, redness };
}

/** Kind, number-free chips and one sentence for the "Your skin today" card. */
export function skinSummary(skin) {
  const g = skinSignals(skin);
  const chips = [];
  chips.push(g.shine ? { id: 'shine', label: 'A little shine' } : g.combination ? { id: 'tzone', label: 'Some T-zone shine' } : { id: 'shine', label: 'Low shine' });
  chips.push(g.thirsty ? { id: 'moisture', label: 'Could use more hydration' } : g.wellHydrated ? { id: 'moisture', label: 'Well hydrated' } : { id: 'moisture', label: 'Comfortably hydrated' });
  chips.push(g.redness ? { id: 'redness', label: 'Some redness' } : { id: 'redness', label: 'Even tone' });
  const shineP = g.shine ? 'a little shine' : g.combination ? 'some shine on the T-zone' : 'very little shine';
  const moistP = g.thirsty ? 'could use a little more hydration' : g.wellHydrated ? 'is well hydrated' : 'is comfortably hydrated';
  const redP = g.redness ? 'shows some redness' : 'has an even tone';
  const text = `Today your skin has ${shineP}, ${moistP}, and ${redP}.`;
  return { chips, text, note: 'Skin changes day to day. This is a reading of this one photo, not a diagnosis.' };
}

/**
 * How to wear the matched foundation shade: finish and coverage, by rule.
 *   shine (and not thirsty) → soft matte · shine + thirsty or T-zone shine → satin
 *   thirsty → dewy · otherwise natural
 *   visible redness → a little more coverage (medium), else light to medium
 */
export function foundationAdvice(skin) {
  const g = skinSignals(skin);
  let finish;
  let finishWhy;
  if (g.shine && !g.thirsty) [finish, finishWhy] = ['soft matte', 'keeps shine in check through the day'];
  else if (g.shine || g.combination) [finish, finishWhy] = ['satin', 'balances shine without drying your skin'];
  else if (g.thirsty) [finish, finishWhy] = ['dewy', 'adds a fresh glow and stays comfortable'];
  else [finish, finishWhy] = ['natural', 'looks like skin, because yours is balanced today'];
  const coverage = g.redness ? 'medium' : 'light to medium';
  const coverageWhy = g.redness ? 'a little more coverage gently evens out redness' : 'light coverage lets your skin show through';
  return {
    finish,
    coverage,
    reason: `A ${finish} finish ${finishWhy}, and ${coverageWhy}.`,
  };
}

export const SKINCARE_VARIANTS = ['light', 'balanced', 'rich'];

/**
 * Moisturiser variant by rule:
 *   thirsty, no shine → rich · shine, not thirsty → light gel
 *   shine + thirsty, or combination → balanced · otherwise balanced
 */
export function skincareVariant(skin) {
  const g = skinSignals(skin);
  if (g.thirsty && !g.shine) return { variant: 'rich', reason: 'Your skin could use more hydration today, so a richer cream suits it.' };
  if (g.shine && !g.thirsty) return { variant: 'light', reason: `Your skin shows a little shine and is ${g.wellHydrated ? 'well' : 'comfortably'} hydrated, so a light gel gives moisture without heaviness.` };
  if (g.shine && g.thirsty) return { variant: 'balanced', reason: 'Your skin shows some shine but could use hydration, so a balanced lotion does both.' };
  if (g.combination) return { variant: 'balanced', reason: 'Some T-zone shine with comfortable cheeks suits a balanced lotion.' };
  return { variant: 'balanced', reason: 'Your skin is comfortably balanced today, so a balanced lotion keeps it that way.' };
}

/** Score a skincare variant for a reading: 0 recommended · 2 one step away · 5 two steps away. */
export function scoreSkincareVariant(variant, skin) {
  const rec = skincareVariant(skin);
  const d = Math.abs(SKINCARE_VARIANTS.indexOf(variant) - SKINCARE_VARIANTS.indexOf(rec.variant));
  return { score: d === 0 ? 0 : d === 1 ? 2 : 5, recommended: rec.variant, reason: rec.reason, distance: d };
}
