// "Who is each shade for?": the catalogue scored against the nine coarse tone profiles with the
// same deterministic matcher the shopper flow uses (scoreProduct + fitConfidence). No customer
// data goes in, so the matrix is safe to show to anyone. Gaps = profiles that no in-stock product
// in a category fits well. Live low-confidence escalations are joined in from real events only.
import { scoreProduct, fitConfidence } from '../color/match.js';
import { hexToLab } from '../color/color.js';
import { buildToneProfile, toneSummaryText } from '../color/tone.js';
import { PROFILE_KEYS, profileLabel, representativeProfile } from './insights.js';

export const FIT_CATEGORIES = ['lipstick', 'foundation', 'dress'];
export const FIT_SOURCE = 'From your catalogue and the matcher, no customer data';
const LEVEL = { high: 'great', medium: 'good', low: 'poor' };
const NOUN = { lipstick: 'lipstick', foundation: 'foundation shade', dress: 'dress colour' };

const profiles = () => PROFILE_KEYS.map((key) => ({ key, profile: representativeProfile(key) }));

function productsOf(catalog, category) {
  return catalog.products.filter((p) => p.category === category);
}

/** Per category + profile, how many live returns were escalated because no alternative was good
 *  enough (agent code low_confidence). Joins the escalation to the session's tone_analyzed event. */
export function lowConfidenceEscalations(events) {
  const bySession = new Map();
  for (const e of events) {
    if (!e.sessionId) continue;
    const s = bySession.get(e.sessionId) ?? {};
    if (e.type === 'return_started') s.category = e.category;
    if (e.type === 'tone_analyzed') s.profileKey = e.profileKey;
    if (e.type === 'escalated' && e.code === 'low_confidence') s.lowConfidence = true;
    bySession.set(e.sessionId, s);
  }
  const out = {};
  for (const s of bySession.values()) {
    if (!s.lowConfidence || !s.category || !s.profileKey) continue;
    out[s.category] ??= {};
    out[s.category][s.profileKey] = (out[s.category][s.profileKey] ?? 0) + 1;
  }
  return out;
}

function gapText(category, key, escalations) {
  const base = `No ${NOUN[category]} in stock suits ${profileLabel(key).toLowerCase()} profiles well: a gap in your range.`;
  return escalations ? `${base} ${escalations} live ${escalations === 1 ? 'return was' : 'returns were'} escalated for this reason.` : base;
}

/** Score one category: matrix cells [productIndex][profileIndex] plus gap cards. */
export function fitMatrix({ catalog, category, liveEscalations = {} }) {
  if (!FIT_CATEGORIES.includes(category)) throw new Error(`unknown category ${category}`);
  const prods = productsOf(catalog, category);
  const profs = profiles();
  const cells = prods.map((p) =>
    profs.map(({ profile }) => {
      const r = scoreProduct(p, profile, null);
      return { level: LEVEL[fitConfidence(category, r)], score: r.score };
    }),
  );
  const esc = liveEscalations[category] ?? {};
  const gaps = [];
  profs.forEach(({ key }, j) => {
    const all = prods.map((p, i) => ({ p, cell: cells[i][j] }));
    const inStock = all.filter((x) => x.p.stock > 0);
    const fitting = inStock.filter((x) => x.cell.level !== 'poor');
    const soldOutFits = all.filter((x) => !(x.p.stock > 0) && x.cell.level !== 'poor').map((x) => x.p.shadeName);
    const n = esc[key] ?? 0;
    const label = profileLabel(key).toLowerCase();
    if (!fitting.length) {
      const closest = inStock.sort((a, b) => a.cell.score - b.cell.score)[0];
      gaps.push({
        kind: 'range',
        category,
        profileKey: key,
        profileLabel: profileLabel(key),
        liveEscalations: n,
        closestId: closest?.p.id ?? null,
        closestName: closest?.p.shadeName ?? null,
        soldOutFits,
        text: gapText(category, key, n) + (soldOutFits.length ? ` Restocking ${listText(soldOutFits)} would cover it.` : ''),
      });
    } else if (fitting.length === 1) {
      // One good option left: a single stock-out away from a gap.
      const only = fitting[0].p.shadeName;
      gaps.push({
        kind: 'thin',
        category,
        profileKey: key,
        profileLabel: profileLabel(key),
        liveEscalations: n,
        onlyName: only,
        soldOutFits,
        text:
          `Only one ${NOUN[category]} in stock, ${only}, suits ${label} profiles well.` +
          (soldOutFits.length ? ` Restocking ${listText(soldOutFits)} would give them a second option.` : ' One stock-out away from a gap.') +
          (n ? ` ${n} live ${n === 1 ? 'return was' : 'returns were'} escalated here.` : ''),
      });
    } else if (n) {
      // The range covers this profile in principle, but real returns still found nothing better
      // in the price band and stock at the time: worth a look, and labelled as live.
      gaps.push({
        kind: 'live',
        category,
        profileKey: key,
        profileLabel: profileLabel(key),
        liveEscalations: n,
        text: `${n} live ${n === 1 ? 'return' : 'returns'} from ${profileLabel(key).toLowerCase()} profiles ${n === 1 ? 'was' : 'were'} escalated: no in-stock ${NOUN[category]} in the price band clearly beat the returned one.`,
      });
    }
  });
  // Products no reference profile fits well: either beyond the grid (a very light or very deep
  // foundation) or a hard colour to wear. Informational, not counted as a gap.
  const noFit = prods.filter((p, i) => cells[i].every((c) => c.level === 'poor'));
  const notes = [];
  if (noFit.length) {
    const names = listText(noFit.map((p) => p.shadeName));
    const refL = profs.map(({ profile }) => profile.skinLab.L);
    const allDeeper = category === 'foundation' && noFit.every((p) => hexToLab(p.hex).L < Math.min(...refL) - 4);
    const allLighter = category === 'foundation' && noFit.every((p) => hexToLab(p.hex).L > Math.max(...refL) + 4);
    notes.push({
      kind: 'nofit',
      category,
      productIds: noFit.map((p) => p.id),
      text: allDeeper
        ? `${names} ${noFit.length === 1 ? 'is' : 'are'} deeper than all nine reference profiles, so this grid can't place ${noFit.length === 1 ? 'it' : 'them'}: ${noFit.length === 1 ? 'it serves' : 'they serve'} the deepest skin tones.`
        : allLighter
          ? `${names} ${noFit.length === 1 ? 'is' : 'are'} lighter than all nine reference profiles: ${noFit.length === 1 ? 'it serves' : 'they serve'} the fairest skin tones.`
          : `No reference profile scores ${names} well. ${noFit.length === 1 ? 'It is a harder colour' : 'They are harder colours'} to wear: watch ${noFit.length === 1 ? 'its' : 'their'} returns.`,
    });
  }
  return {
    category,
    source: FIT_SOURCE,
    profiles: profs.map(({ key }) => ({ key, label: profileLabel(key) })),
    products: prods.map((p) => ({ id: p.id, name: `${p.productLine} · ${p.shadeName}`, shadeName: p.shadeName, hex: p.hex, inStock: p.stock > 0, price: p.price })),
    cells,
    gaps,
    notes,
  };
}

function listText(names) {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** Gap counts for every category (for the tab labels). */
export function gapCounts({ catalog, liveEscalations = {} }) {
  return Object.fromEntries(FIT_CATEGORIES.map((c) => [c, fitMatrix({ catalog, category: c, liveEscalations }).gaps.length]));
}

const HEX = /^#[0-9A-Fa-f]{6}$/;

/** Colour passport: a saved tone profile (hex colours only, no photo) → top in-stock picks per
 *  category, scored by the same matcher. Nothing is stored server-side. */
export function passportMatches({ catalog, skinHex, lipHex, hairHex, perCategory = 2 }) {
  for (const [name, v, required] of [['skinHex', skinHex, true], ['lipHex', lipHex, false], ['hairHex', hairHex, false]]) {
    if (v == null && !required) continue;
    if (typeof v !== 'string' || !HEX.test(v)) {
      const err = new Error(`${name} must be a #RRGGBB colour`);
      err.code = 'bad_colour';
      throw err;
    }
  }
  const profile = buildToneProfile({ skin_color: skinHex, lip_color: lipHex ?? undefined, hair_color: hairHex ?? undefined });
  const picks = {};
  for (const category of FIT_CATEGORIES) {
    picks[category] = productsOf(catalog, category)
      .filter((p) => p.stock > 0)
      .map((p) => ({ p, r: scoreProduct(p, profile, null) }))
      .sort((a, b) => a.r.score - b.r.score || a.p.id.localeCompare(b.p.id))
      .slice(0, perCategory)
      .map(({ p, r }) => ({
        id: p.id,
        shadeName: p.shadeName,
        productLine: p.productLine,
        hex: p.hex,
        price: p.price,
        image: p.image,
        reason: r.reason,
        level: LEVEL[fitConfidence(category, r)],
      }));
  }
  return {
    profile: {
      depthLabel: profile.depthLabel,
      undertone: profile.undertone,
      profileKey: profile.profileKey,
      profileLabel: profile.profileLabel,
      summary: toneSummaryText(profile),
    },
    picks,
  };
}
