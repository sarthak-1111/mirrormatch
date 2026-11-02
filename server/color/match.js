// Deterministic shade / colourway matching.
// Every score is "lower is better" and is built from a CIEDE2000 colour distance plus
// explicit, explainable rule penalties. No randomness and no LLM: the same tone profile
// and catalogue always produce the same ranking.
import { hexToLab, labToLch, lchToLab, deltaE2000, round1 } from './color.js';

export const PRICE_BAND_PCT = 0.25;

const LIP_FAMILY_ADJ = {
  nude: ['rose', 'brown'],
  rose: ['nude', 'berry', 'coral'],
  coral: ['rose', 'red', 'brown'],
  red: ['coral', 'berry'],
  berry: ['rose', 'red'],
  brown: ['nude', 'coral'],
};

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const wrapHue = (h) => ((h % 360) + 360) % 360;

export function undertonePenalty(productTone, profileTone, opposite = 5, adjacent = 1.5) {
  if (!productTone || !profileTone) return 0;
  if (productTone === profileTone) return 0;
  if (productTone === 'neutral' || profileTone === 'neutral') return adjacent;
  return opposite;
}

/** Personal lipstick target: the shopper's own lip colour, a little deeper and richer,
 *  nudged toward their undertone. */
export function lipTarget(profile) {
  const skin = profile.skinLab;
  const lipLab = profile.lipLab ?? { L: skin.L - 15, a: 22, b: 12 };
  const lip = labToLch(lipLab);
  const shift = profile.undertone === 'warm' ? 6 : profile.undertone === 'cool' ? -8 : 0;
  return lchToLab({
    L: clamp(lip.L - 6, 25, 70),
    C: clamp(lip.C * 1.35, 25, 60),
    h: wrapHue(lip.h + shift),
  });
}

function relativeWords(product, returned) {
  if (!returned) return '';
  const a = labToLch(hexToLab(product.hex));
  const b = labToLch(hexToLab(returned.hex));
  const words = [];
  if (a.L < b.L - 4) words.push('deeper');
  else if (a.L > b.L + 4) words.push('lighter');
  let dh = a.h - b.h;
  if (dh > 180) dh -= 360;
  if (dh < -180) dh += 360;
  if (dh > 5) words.push('warmer');
  else if (dh < -5) words.push('cooler');
  if (!words.length) {
    if (a.C > b.C + 6) words.push('richer');
    else if (a.C < b.C - 6) words.push('softer');
  }
  return words.length ? `${cap(words.join(' and '))} than ${returned.shadeName}` : '';
}

const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

function scoreLipstick(product, profile, returned) {
  const target = lipTarget(profile);
  const lab = hexToLab(product.hex);
  const lch = labToLch(lab);
  const dE = deltaE2000(lab, target);
  const tone = undertonePenalty(product.undertone, profile.undertone);
  let family = 0;
  if (returned && product.family !== returned.family) {
    family = (LIP_FAMILY_ADJ[returned.family] ?? []).includes(product.family) ? 2 : 4;
  }
  const chalk = lab.L >= profile.skinLab.L - 4 && lch.C < 32 ? 6 : 0;
  const score = dE + tone + family + chalk;

  const bits = [];
  const rel = relativeWords(product, returned);
  if (dE < 10) bits.push('close to a richer version of your natural lip tone');
  else if (tone === 0) bits.push(`a ${product.undertone} shade for your ${profile.undertone} undertone`);
  if (bits.length < 2 && tone === 0 && dE < 10) bits.push(`${product.undertone} like your undertone`);
  if (family === 0 && returned) bits.push(`same ${product.family} family you picked`);
  const reason = rel
    ? `${rel}, ${bits[0] ?? `a ${product.family} that suits a ${profile.undertone} undertone`}.`
    : `${cap(bits[0] ?? `a ${product.family} for a ${profile.undertone} undertone`)}.`;
  return {
    score,
    components: { deltaE: round1(dE), undertone: tone, family, chalk },
    deltaE: round1(dE),
    reason,
    caution: chalk ? 'May look chalky against your skin tone.' : null,
  };
}

function scoreFoundation(product, profile, returned) {
  const lab = hexToLab(product.hex);
  const dE = deltaE2000(lab, profile.skinLab);
  const tone = undertonePenalty(product.undertone, profile.undertone, 4, 1.5);
  const score = dE + tone;
  const closeness = dE < 2.5 ? 'a near-invisible match' : dE < 5 ? 'a very close match' : 'a close match';
  const rel = relativeWords(product, returned);
  const toneBit = tone === 0 ? `, ${product.undertone} undertone like yours` : '';
  const reason = `${rel ? rel + ': ' : ''}${closeness} to your skin (ΔE ${round1(dE)})${toneBit}.`;
  return {
    score,
    components: { deltaE: round1(dE), undertone: tone },
    deltaE: round1(dE),
    reason: cap(reason),
    caution: null,
  };
}

function scoreDress(product, profile) {
  const lab = hexToLab(product.hex);
  const lch = labToLch(lab);
  const skin = profile.skinLab;
  const dL = Math.abs(lab.L - skin.L);
  const dE = deltaE2000(lab, skin);
  const contrast = Math.max(0, 22 - dL) * 0.4 + (dE < 12 ? 4 : 0);
  const temp =
    product.temperature === 'neutral'
      ? 1
      : profile.undertone === 'neutral'
        ? 1
        : product.temperature === profile.undertone
          ? 0
          : 6;
  let strength = 0;
  if (profile.contrast === 'high' && lch.C < 25 && lab.L > 30 && lab.L < 80) strength = 3;
  if (profile.contrast === 'low' && lch.C > 55) strength = 3;
  if (profile.contrast === 'low' && lab.L < 22) strength += 2;
  // Chroma fit for the shopper's personal contrast (hair vs skin lightness).
  const [cLo, cHi] = { high: [40, 80], medium: [28, 60], low: [12, 45] }[profile.contrast] ?? [28, 60];
  const chromaFit = lch.C < cLo ? (cLo - lch.C) * 0.05 : lch.C > cHi ? (lch.C - cHi) * 0.05 : 0;
  // Small continuous reward for clearer separation from skin (caps at dL 40).
  const separation = -(Math.min(dL, 40) / 40) * 0.8;
  // Stylist rule: colours that echo your own eye or lip colour tend to look intentional.
  const echoes = [];
  if (profile.eyeHex) echoes.push(['eye colour', deltaE2000(lab, hexToLab(profile.eyeHex))]);
  if (profile.lipLab) echoes.push(['natural lip colour', deltaE2000(lab, profile.lipLab)]);
  const nearest = echoes.sort((a, b) => a[1] - b[1])[0];
  const echo = nearest && nearest[1] < 18 ? -1 : 0;
  const score = Math.max(0, contrast + temp + strength + chromaFit + separation + echo + 1);

  let reason;
  if (echo && temp <= 1 && contrast < 2) {
    reason = `${product.shadeName} echoes your ${nearest[0]} and stands out clearly against your skin.`;
  } else if (temp === 0 && contrast < 2) {
    reason = `${product.shadeName}'s ${product.temperature} tone suits your ${profile.undertone} undertone and stands out clearly against your skin.`;
  } else if (temp <= 1 && contrast < 2) {
    reason = `${product.shadeName} gives clear contrast with your skin and works with a ${profile.undertone} undertone.`;
  } else if (contrast >= 4) {
    reason = `${product.shadeName} sits close to your skin tone, so it can look washed out near your face.`;
  } else if (temp === 6) {
    reason = `${product.shadeName} is ${product.temperature}-toned, which can clash with a ${profile.undertone} undertone.`;
  } else {
    reason = `${product.shadeName} is a balanced choice for your colouring.`;
  }
  return {
    score,
    components: {
      contrast: round1(contrast),
      temperature: temp,
      strength: round1(strength + chromaFit),
      separation: round1(separation),
      echo,
      deltaE: round1(dE),
    },
    deltaE: round1(dE),
    reason,
    caution: contrast >= 4 ? 'Close to your skin tone near the face.' : null,
  };
}

const SCORERS = { lipstick: scoreLipstick, foundation: scoreFoundation, dress: scoreDress };

export function scoreProduct(product, profile, returned) {
  const scorer = SCORERS[product.category];
  if (!scorer) throw new Error(`No scorer for category ${product.category}`);
  const r = scorer(product, profile, returned);
  return { ...r, score: round1(r.score) };
}

function confidenceFor(category, best, returnedScore) {
  if (!best) return 'none';
  const improvement = returnedScore == null ? Infinity : returnedScore - best.score;
  if (improvement < 1) return 'low';
  if (category === 'foundation') {
    if (best.deltaE <= 4) return 'high';
    if (best.deltaE <= 7) return 'medium';
    return 'low';
  }
  if (category === 'lipstick') {
    if (best.score <= 10) return 'high';
    if (best.score <= 16) return 'medium';
    return 'low';
  }
  // dress
  if (best.score <= 1.5) return 'high';
  if (best.score <= 4) return 'medium';
  return 'low';
}

/**
 * Rank in-stock alternatives in the same category and price band as the returned item.
 * @returns {{ ranked, excluded, returnedScore, confidence }}
 */
export function findAlternatives({ profile, returned, products, limit = 3, priceBandPct = PRICE_BAND_PCT }) {
  const excluded = [];
  const pool = [];
  for (const p of products) {
    if (p.category !== returned.category) continue;
    if (p.id === returned.id) {
      excluded.push({ id: p.id, name: p.shadeName, why: 'returned item' });
      continue;
    }
    if (Math.abs(p.price - returned.price) / returned.price > priceBandPct) {
      excluded.push({ id: p.id, name: p.shadeName, why: 'outside price band' });
      continue;
    }
    if (!(p.stock > 0)) {
      excluded.push({ id: p.id, name: p.shadeName, why: 'out of stock' });
      continue;
    }
    pool.push(p);
  }
  const returnedResult = scoreProduct(returned, profile, null);
  const ranked = pool
    .map((p) => ({ product: p, ...scoreProduct(p, profile, returned) }))
    .sort((a, b) => a.score - b.score || a.product.id.localeCompare(b.product.id));
  const top = ranked.slice(0, limit);
  return {
    ranked: top,
    consideredCount: pool.length,
    excluded,
    returnedScore: returnedResult.score,
    returnedReason: returnedResult.reason,
    returnedCaution: returnedResult.caution,
    confidence: confidenceFor(returned.category, top[0], returnedResult.score),
  };
}
