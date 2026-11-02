// Hair-colour ranking: transparent colourist rules on top of YouCam's tone analysis.
// Inputs: skin undertone and depth (tone.js) and the natural hair colour YouCam reports
// (one of seven fixed colours with a name). Every score is "lower is better".
//
//   tone    warm undertone: golden, copper, caramel 0 · natural 1.5 · ash, burgundy 5
//           cool undertone: ash, burgundy 0 · natural 1.5 · golden, copper, caramel 5
//           neutral undertone: natural 0 · everything else 1.5
//   level   d = |shade level − natural level| (1 = black … 10 = lightest blonde)
//           d ≤ 2 → 0.6·d · d > 2 → 1.2 + 2.2·(d − 2)   ("stay within a couple of levels")
//   depth   very light shades (level ≥ 9) on deep skin +2 · very dark shades (level ≤ 2) on light skin +1.5
import { hexToLab, round1 } from './color.js';

export const HAIR_TONE_TEMPERATURE = {
  golden: 'warm',
  copper: 'warm',
  caramel: 'warm',
  ash: 'cool',
  burgundy: 'cool',
  natural: 'neutral',
};

// YouCam's skin-tone analysis names the natural hair colour from a fixed list.
export const NATURAL_HAIR_LEVEL = { Black: 2, Brown: 4, Auburn: 5, Red: 6, Blonde: 8, 'Grey/White': 9 };

const LEVEL_WORDS = { 1: 'black', 2: 'darkest brown', 3: 'dark brown', 4: 'medium brown', 5: 'light brown', 6: 'dark blonde', 7: 'medium blonde', 8: 'light blonde', 9: 'very light blonde', 10: 'lightest blonde' };

/** Natural hair level (1 to 10) from YouCam's hair_color_name, or from lightness as a fallback. */
export function naturalHairLevel(profile) {
  const byName = NATURAL_HAIR_LEVEL[profile?.hairName];
  if (byName) return byName;
  if (profile?.hairHex) {
    const L = hexToLab(profile.hairHex).L;
    return Math.max(1, Math.min(10, Math.round((L - 10) / 8.5)));
  }
  return 4;
}

export function hairTonePenalty(tone, undertone) {
  const t = HAIR_TONE_TEMPERATURE[tone] ?? 'neutral';
  if (undertone === 'neutral') return t === 'neutral' ? 0 : 1.5;
  if (t === 'neutral') return 1.5;
  return t === undertone ? 0 : 5;
}

export function hairLevelPenalty(level, natural) {
  const d = Math.abs(level - natural);
  return d <= 2 ? 0.6 * d : 1.2 + 2.2 * (d - 2);
}

export function hairDepthPenalty(level, depthGroup) {
  if (depthGroup === 'deep' && level >= 9) return 2;
  if (depthGroup === 'light' && level <= 2) return 1.5;
  return 0;
}

const TONE_WHY = {
  warm: 'golden, copper and caramel tones flatter a warm undertone',
  cool: 'ash and burgundy tones flatter a cool undertone',
  neutral: 'natural tones keep a neutral undertone balanced',
};

function levelPhrase(level, natural, naturalName) {
  const d = level - natural;
  const hair = naturalName ? `your natural ${naturalName.toLowerCase()} hair` : 'your natural colour';
  if (d === 0) return `the same depth as ${hair}`;
  const n = Math.abs(d);
  return `${n} level${n === 1 ? '' : 's'} ${d > 0 ? 'lighter' : 'deeper'} than ${hair}`;
}

/** Score one hair-colour shade for a tone profile. */
export function scoreHair(product, profile) {
  const natural = naturalHairLevel(profile);
  const level = product.hairLevel ?? 5;
  const tone = hairTonePenalty(product.hairTone, profile.undertone);
  const lvl = hairLevelPenalty(level, natural);
  const depth = hairDepthPenalty(level, profile.depthGroup);
  const score = tone + lvl + depth;
  const temp = HAIR_TONE_TEMPERATURE[product.hairTone] ?? 'neutral';
  const what = `A ${temp === 'neutral' ? 'natural' : product.hairTone} ${LEVEL_WORDS[level] ?? 'shade'}`;
  const rel = levelPhrase(level, natural, profile.hairName);
  let why;
  if (tone === 0) why = TONE_WHY[profile.undertone] ?? TONE_WHY.neutral;
  else if (tone === 1.5) why = `soft enough for a ${profile.undertone} undertone`;
  else why = `its ${temp} tone can look flat against a ${profile.undertone} undertone`;
  const d = Math.abs(level - natural);
  const cautions = [];
  if (tone === 5) cautions.push(`${cap(product.hairTone)} tones can mute a ${profile.undertone} undertone`);
  if (d > 2) cautions.push(`it's ${rel}, a big jump in one step`);
  return {
    score,
    components: { tone, level: round1(lvl), depth, naturalLevel: natural },
    deltaE: null,
    reason: `${what}, ${rel}: ${why}.`,
    caution: cautions.length ? `${cap(cautions.join(', and '))}.` : null,
  };
}

const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
