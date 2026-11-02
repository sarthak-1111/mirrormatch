// Turns a product x tone-profile heatmap into merchant recommendations, using the same
// deterministic matcher the shopper flow uses. For each product with enough returns, find
// the profile that returns it most, then ask the matcher what that profile should have bought.
import { lchToLab, labToHex } from '../color/color.js';
import { buildToneProfile } from '../color/tone.js';
import { findAlternatives } from '../color/match.js';

export const PROFILE_KEYS = [
  'light-cool', 'light-neutral', 'light-warm',
  'medium-cool', 'medium-neutral', 'medium-warm',
  'deep-cool', 'deep-neutral', 'deep-warm',
];

const DEPTH_L = { light: 78, medium: 62, deep: 40 };
const DEPTH_C = { light: 17, medium: 21, deep: 21 };
const TONE_H = { cool: 47, neutral: 56, warm: 65 };

/** A representative tone profile for a heatmap column (used only to generate advice). */
export function representativeProfile(profileKey) {
  const [depth, tone] = profileKey.split('-');
  const L = DEPTH_L[depth];
  const skin = labToHex(lchToLab({ L, C: DEPTH_C[depth], h: TONE_H[tone] - (depth === 'deep' ? 3 : 0) }));
  const lip = labToHex(lchToLab({ L: L - 18, C: 30, h: tone === 'cool' ? 12 : tone === 'warm' ? 30 : 22 }));
  const p = buildToneProfile({ skin_color: skin, lip_color: lip, hair_color: depth === 'light' ? '#42280E' : '#000000' });
  // The derived labels can drift at band edges, so pin them to the column being explained.
  return { ...p, depthGroup: depth, undertone: tone, profileKey };
}

export function profileLabel(key) {
  const [d, t] = key.split('-');
  return `${d[0].toUpperCase()}${d.slice(1)} · ${t}`;
}

export function buildInsights({ heat, catalog, minReturns = 3, limit = 4 }) {
  const out = [];
  for (const [productId, row] of Object.entries(heat)) {
    const product = catalog.product(productId);
    if (!product) continue;
    const total = Object.values(row).reduce((a, b) => a + b, 0);
    if (total < minReturns) continue;
    const [topKey, topCount] = Object.entries(row).sort((a, b) => b[1] - a[1])[0];
    const share = topCount / total;
    const profile = representativeProfile(topKey);
    const alt = findAlternatives({ profile, returned: product, products: catalog.products, limit: 1 });
    const best = alt.ranked[0]?.product;
    out.push({
      productId,
      productName: `${product.productLine} · ${product.shadeName}`,
      profileKey: topKey,
      profileLabel: profileLabel(topKey),
      count: topCount,
      total,
      share: Math.round(share * 100),
      recommendId: best?.id ?? null,
      recommendName: best ? best.shadeName : null,
      text: best
        ? `${product.shadeName} is returned most by ${profileLabel(topKey).toLowerCase()} profiles (${topCount} of ${total} returns). Recommend ${best.shadeName} on the product page for them.`
        : `${product.shadeName} is returned most by ${profileLabel(topKey).toLowerCase()} profiles (${topCount} of ${total} returns).`,
    });
  }
  return out.sort((a, b) => b.count - a.count || b.share - a.share).slice(0, limit);
}
