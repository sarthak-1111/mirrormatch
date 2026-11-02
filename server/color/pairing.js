// "Complete the look" pairings. Deterministic rules, no LLM, every score "lower is better".
//
// Lips for a new dress colourway:
//   score = personal fit (the lipstick matcher's own score for this shopper, no "returned" item)
//         + temperature   warm dress: cool lipstick +3 · cool dress: warm lipstick +3 · neutral dress 0
//         + intensity     bold dress (C* ≥ 45): bold lipstick (C* ≥ 50) +1.5, softer lipstick (C* < 40) −1
//                         quiet dress (C* < 20): bold lipstick −1 (the lips can be the statement)
//         + reds          red/pink/coral dress (h < 50° or ≥ 330°, C* ≥ 30): echo (ΔE00 < 15) −1,
//                         near-miss red (15 ≤ ΔE00 < 28) +2 ("competing reds")
//
// Blush for a lipstick: start from the lipstick's own hue, nudge it toward the undertone
// (+8° warm, −8° cool), keep lightness near the skin's (lighter than the lips) and chroma moderate, so blush and lips read
// as one family. Rendered with makeup-vto `blush` (pattern 1color1, matte) next to the lip colour.
import { hexToLab, labToLch, lchToLab, labToHex, deltaE2000, round1 } from './color.js';
import { scoreProduct } from './match.js';

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const wrap = (h) => ((h % 360) + 360) % 360;

function dressTraits(dress) {
  const lab = hexToLab(dress.hex);
  const lch = labToLch(lab);
  const reddish = lch.C >= 30 && (lch.h < 50 || lch.h >= 330);
  const intensity = lch.C >= 45 ? 'bold' : lch.C < 20 ? 'quiet' : 'medium';
  return { lab, lch, reddish, intensity, temperature: dress.temperature ?? 'neutral' };
}

/** Score one in-stock lipstick against the shopper and the chosen dress colourway. */
export function scoreLipForDress(lip, profile, dress) {
  const personal = scoreProduct(lip, profile, null);
  const d = dressTraits(dress);
  const lab = hexToLab(lip.hex);
  const lch = labToLch(lab);
  let temperature = 0;
  if (d.temperature === 'warm' && lip.undertone === 'cool') temperature = 3;
  if (d.temperature === 'cool' && lip.undertone === 'warm') temperature = 3;
  let intensity = 0;
  if (d.intensity === 'bold') intensity = lch.C >= 50 ? 1.5 : lch.C < 40 ? -1 : 0;
  if (d.intensity === 'quiet' && lch.C >= 45) intensity = -1;
  let reds = 0;
  const dE = deltaE2000(lab, d.lab);
  if (d.reddish) {
    if (dE < 15) reds = -1;
    else if (dE < 28) reds = 2;
  }
  const score = round1(personal.score + temperature + intensity + reds);

  let harmony;
  if (reds < 0) harmony = `echoes the ${dress.shadeName} dress`;
  else if (d.intensity === 'bold' && intensity < 0) harmony = `stays soft next to the bold ${dress.shadeName}`;
  else if (d.intensity === 'quiet' && intensity < 0) harmony = `adds a confident pop to the soft ${dress.shadeName}`;
  else if (temperature === 0 && d.temperature !== 'neutral') harmony = `shares the ${dress.shadeName} dress's ${d.temperature} tone`;
  else harmony = `sits easily with ${dress.shadeName}`;
  const tone = lip.undertone === 'neutral' ? '' : `${lip.undertone} `;
  const suits = personal.components.undertone === 0 ? `suits your ${profile.undertone} undertone` : `works with your ${profile.undertone} undertone`;
  return {
    product: lip,
    score,
    components: { personal: personal.score, temperature, intensity, reds, deltaEDress: round1(dE) },
    reason: `${lip.shadeName}, a ${tone}${lip.family}, ${suits} and ${harmony}.`,
  };
}

/** Rank in-stock lipsticks for the shopper wearing the chosen dress colourway. */
export function lipsForDress({ profile, dress, products, limit = 3 }) {
  return products
    .filter((p) => p.category === 'lipstick' && p.stock > 0)
    .map((p) => scoreLipForDress(p, profile, dress))
    .sort((a, b) => a.score - b.score || a.product.id.localeCompare(b.product.id))
    .slice(0, limit);
}

function blushName(h, C, L) {
  const light = L >= 66 ? 'soft ' : L < 52 ? 'deep ' : '';
  if (h < 12 || h >= 345) return `${light}berry pink`;
  if (h < 24) return `${light}rose`;
  if (h < 36) return `${light}rosy peach`;
  if (h < 50) return `${light}peach`;
  return C < 26 ? `${light}warm nude` : `${light}apricot`;
}

/** A blush colour that pairs with the lipstick and suits the undertone and skin depth. */
export function blushForLip({ lip, profile }) {
  const lipLch = labToLch(hexToLab(lip.hex));
  const skinL = profile.skinLab?.L ?? 62;
  const nudge = profile.undertone === 'warm' ? 8 : profile.undertone === 'cool' ? -8 : 0;
  // Blush sits near the skin's lightness (lighter than the lips, so it stays soft) with enough
  // colour to show at a gentle intensity.
  const L = clamp(Math.max(skinL, lipLch.L + 14), 50, 76);
  const C = clamp(lipLch.C * 0.9, 30, 45);
  const h = wrap(clamp(lipLch.h, 0, 70) + nudge);
  const hex = labToHex(lchToLab({ L, C, h })).toUpperCase();
  const name = blushName(h, C, L);
  const toneWhy = profile.undertone === 'neutral' ? 'stays balanced on a neutral undertone' : `leans ${profile.undertone} to suit your undertone`;
  return {
    hex,
    name,
    intensity: 45,
    reason: `A ${name} blush picks up ${lip.shadeName}'s colour, softer and lighter, and ${toneWhy}.`,
  };
}
