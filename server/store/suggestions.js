// Merchant agent suggestions, drafted by deterministic code from the shade-fit gaps and the
// return heatmaps. Nothing here calls an LLM or an external system:
//   (a) "Fill the gap": a proposed new shade for an under-served tone profile, with a target
//       colour from the shopper matcher's own target logic (lipTarget / measured skin / scoreDress);
//   (b) "Product-page fit note": a draft for products returned most by one tone profile;
//   (c) Approve / Dismiss only log an event (see decisionsFrom).
// Also here: the YouCam sample-model store (canonical bytes for the "Use a sample photo" button)
// and the sample-model preview renderer for a proposed shade (makeup-vto, cached).
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { hexToLab, labToHex, labToLch, lchToLab, deltaE2000, round1 } from '../color/color.js';
import { lipTarget, scoreProduct, fitConfidence } from '../color/match.js';
import { fitMatrix, FIT_CATEGORIES } from './fit.js';
import { buildInsights, representativeProfile, profileLabel, PROFILE_KEYS } from './insights.js';
import { aggregate, recordsFromEvents } from './events.js';
import { resultUrl } from '../youcam/client.js';

const LEVEL = { high: 'great', medium: 'good', low: 'poor' };
const NOUN = { lipstick: 'lipstick shade', foundation: 'foundation shade', dress: 'dress colourway' };
export const SYNTHETIC_LABEL = 'Synthetic demo data';
export const PREVIEW_LABEL = 'Visual preview, not a guarantee';

const wrapHue = (h) => ((h % 360) + 360) % 360;
const hueDiff = (a, b) => {
  let d = a - b;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return d;
};
const lab1 = (lab) => ({ L: round1(lab.L), a: round1(lab.a), b: round1(lab.b) });
/** "Medium · cool" → "medium, cool" (for running text). */
const profileWords = (key) => {
  const [d, t] = key.split('-');
  return `${d}, ${t}`;
};

/** Dress temperature from hue, as documented in the README (warm 25–110°, cool 150–330°, C* ≥ 15). */
export function temperatureOf(lch) {
  if (lch.C < 15) return 'neutral';
  if (lch.h >= 25 && lch.h <= 110) return 'warm';
  if (lch.h >= 150 && lch.h <= 330) return 'cool';
  return 'neutral';
}

/** A plain-words family for a proposed lipstick colour (descriptive only, never used for scoring). */
export function lipFamilyOf(lch) {
  if (lch.C < 22) return 'nude';
  if (lch.h < 26 || lch.h >= 350) return lch.L >= 60 ? 'pink' : lch.h < 12 || lch.h >= 350 ? 'berry' : 'rose';
  if (lch.h < 40) return lch.C > 33 ? 'coral' : 'nude';
  return lch.L < 45 ? 'brown' : 'nude';
}

/** The best dress colour for a profile under the matcher's own scoreDress: a coarse LCh search. */
function dressTarget(profile) {
  let best = null;
  for (let L = 20; L <= 85; L += 5) {
    for (let C = 10; C <= 70; C += 5) {
      for (let h = 0; h < 360; h += 10) {
        const lab = lchToLab({ L, C, h });
        const hex = labToHex(lab);
        const real = hexToLab(hex); // the colour actually displayable as #RRGGBB
        const temperature = temperatureOf(labToLch(real));
        const r = scoreProduct({ category: 'dress', hex, temperature, shadeName: 'Proposed' }, profile, null);
        // Lowest score wins; ties go to the clearer contrast with skin, then to the lower hue (stable).
        const sep = Math.abs(real.L - profile.skinLab.L);
        if (!best || r.score < best.score - 1e-9 || (Math.abs(r.score - best.score) < 1e-9 && sep > best.sep)) {
          best = { lab: real, hex, temperature, score: r.score, sep };
        }
      }
    }
  }
  return { lab: best.lab, hex: best.hex, temperature: best.temperature };
}

/**
 * Target colour for an under-served profile, using the shopper matcher's own target logic:
 *   lipstick   → lipTarget(profile) (natural lip, deeper, richer, nudged to the undertone)
 *   foundation → the profile's skin colour itself (ΔE00 0 is the matcher's ideal)
 *   dress      → the lowest-scoring colour under scoreDress (coarse LCh search)
 * Returns hex plus the Lab of that hex (so the two always agree), and a synthetic product
 * that the matcher can score.
 */
export function gapTarget(category, profileKey) {
  if (!FIT_CATEGORIES.includes(category)) throw new Error(`unknown category ${category}`);
  if (!PROFILE_KEYS.includes(profileKey)) throw new Error(`unknown profile ${profileKey}`);
  const profile = representativeProfile(profileKey);
  let hex;
  let product;
  if (category === 'lipstick') {
    hex = labToHex(lipTarget(profile));
    const lch = labToLch(hexToLab(hex));
    product = { category, hex, undertone: profile.undertone, family: lipFamilyOf(lch), shadeName: 'Proposed shade' };
  } else if (category === 'foundation') {
    hex = labToHex(profile.skinLab);
    product = { category, hex, undertone: profile.undertone, shadeName: 'Proposed shade' };
  } else {
    const t = dressTarget(profile);
    hex = t.hex;
    product = { category, hex, temperature: t.temperature, shadeName: 'Proposed colourway' };
  }
  const lab = hexToLab(hex);
  const lch = labToLch(lab);
  return { profile, hex: hex.toUpperCase(), lab: lab1(lab), lch: { L: round1(lch.L), C: round1(lch.C), h: round1(wrapHue(lch.h)) }, product };
}

/** One "Fill the gap" proposal for a gap card from fitMatrix. */
export function proposeShade({ catalog, gap }) {
  const { category, profileKey } = gap;
  const { profile, hex, lab, lch, product } = gapTarget(category, profileKey);
  const own = scoreProduct(product, profile, null);
  const level = LEVEL[fitConfidence(category, own)];
  // Which other reference profiles the proposed shade would also serve well.
  const alsoFits = PROFILE_KEYS.filter((k) => k !== profileKey).filter((k) => {
    const r = scoreProduct(product, representativeProfile(k), null);
    return fitConfidence(category, r) !== 'low';
  });
  // Nearest existing shade in the category, so the proposal is visibly new.
  const nearest = catalog.products
    .filter((p) => p.category === category)
    .map((p) => ({ p, d: deltaE2000(hexToLab(p.hex), lab) }))
    .sort((a, b) => a.d - b.d || a.p.id.localeCompare(b.p.id))[0];
  const describe =
    category === 'lipstick'
      ? `a ${product.undertone === 'neutral' ? '' : `${product.undertone} `}${product.family}`
      : category === 'foundation'
        ? `a ${profile.depthGroup} ${product.undertone} foundation`
        : `a ${product.temperature === 'neutral' ? 'neutral' : product.temperature} colourway`;
  const label = profileLabel(profileKey);
  const why =
    gap.kind === 'range'
      ? `No in-stock ${NOUN[category]} suits ${label.toLowerCase()} profiles well.`
      : gap.kind === 'thin'
        ? `Only one in-stock ${NOUN[category]}${gap.onlyName ? `, ${gap.onlyName},` : ''} suits ${label.toLowerCase()} profiles well.`
        : `${gap.liveEscalations} live ${gap.liveEscalations === 1 ? 'return was' : 'returns were'} escalated for ${label.toLowerCase()} profiles.`;
  const text =
    `${why} Proposed new ${NOUN[category]}: ${describe} at ${hex}, the matcher's own target for ${profileWords(profileKey)} skin ` +
    `(${level} fit${alsoFits.length ? `, also good for ${alsoFits.length} more ${alsoFits.length === 1 ? 'profile' : 'profiles'}` : ''}).` +
    (nearest ? ` Nearest in your range: ${nearest.p.shadeName} (ΔE00 ${round1(nearest.d)}).` : '');
  return {
    id: `shade:${category}:${profileKey}`,
    kind: 'shade',
    title: 'Fill the gap: a proposed new shade',
    category,
    profileKey,
    profileLabel: label,
    gapKind: gap.kind,
    liveEscalations: gap.liveEscalations ?? 0,
    hex,
    lab,
    lch,
    family: product.family ?? null,
    undertone: product.undertone ?? null,
    temperature: product.temperature ?? null,
    fit: { level, score: own.score },
    alsoFits: alsoFits.map((k) => ({ key: k, label: profileLabel(k) })),
    nearest: nearest ? { id: nearest.p.id, shadeName: nearest.p.shadeName, hex: nearest.p.hex, deltaE: round1(nearest.d) } : null,
    previewable: category === 'lipstick' || category === 'foundation',
    source: 'catalogue',
    synthetic: false,
    text,
  };
}

/** How a product "runs" on a profile relative to the matcher's target, in plain words. */
export function runsWords(product, profile) {
  const lab = hexToLab(product.hex);
  const lch = labToLch(lab);
  if (product.category === 'dress') {
    const dL = Math.abs(lab.L - profile.skinLab.L);
    if (dL < 15) return { words: 'close to', text: `sits close to ${profileWords(profile.profileKey)} skin, so it can wash out near the face` };
    const temp = product.temperature ?? temperatureOf(lch);
    if (temp !== 'neutral' && profile.undertone !== 'neutral' && temp !== profile.undertone) {
      return { words: temp, text: `runs ${temp} on ${profileWords(profile.profileKey)} skin` };
    }
    return { words: '', text: `is returned most by shoppers with ${profileWords(profile.profileKey)} skin` };
  }
  const target = product.category === 'lipstick' ? labToLch(lipTarget(profile)) : labToLch(profile.skinLab);
  const lim = product.category === 'lipstick' ? { L: 6, h: 8, C: 10 } : { L: 3, h: 4, C: 6 };
  const cands = [];
  const dL = lch.L - target.L;
  const dh = hueDiff(lch.h, target.h);
  const dC = lch.C - target.C;
  if (Math.abs(dL) > lim.L) cands.push([Math.abs(dL) / lim.L, dL > 0 ? 'light' : 'deep']);
  if (Math.abs(dh) > lim.h) cands.push([Math.abs(dh) / lim.h, dh > 0 ? 'warm' : 'cool']);
  if (Math.abs(dC) > lim.C) cands.push([Math.abs(dC) / lim.C, dC > 0 ? 'bold' : 'muted']);
  // Foundation undertone labels are authored on the catalogue, so trust them when they disagree.
  if (product.category === 'foundation' && product.undertone && product.undertone !== 'neutral' && profile.undertone !== 'neutral' && product.undertone !== profile.undertone) {
    if (!cands.some((c) => c[1] === product.undertone)) cands.push([1.01, product.undertone]);
  }
  const words = cands.sort((a, b) => b[0] - a[0]).slice(0, 2).map((c) => c[1]);
  if (!words.length) return { words: '', text: `is returned most by shoppers with ${profileWords(profile.profileKey)} skin` };
  return { words: words.join(' and '), text: `runs ${words.join(' and ')} on ${profileWords(profile.profileKey)} skin` };
}

/** Live exchanges per returned product + profile → chosen product counts. */
export function liveChoices(events) {
  const out = {};
  for (const r of recordsFromEvents(events)) {
    if (r.outcome !== 'exchange' || !r.toProductId || !r.profileKey) continue;
    out[r.productId] ??= {};
    out[r.productId][r.profileKey] ??= {};
    out[r.productId][r.profileKey][r.toProductId] = (out[r.productId][r.profileKey][r.toProductId] ?? 0) + 1;
  }
  return out;
}

/** (b) Product-page fit notes from a heatmap. Synthetic notes say so in their text. */
export function fitNotes({ catalog, heat, source, choices = {}, minReturns = 3, limit = 4 }) {
  const synthetic = source === 'synthetic';
  return buildInsights({ heat, catalog, minReturns, limit }).map((ins) => {
    const product = catalog.product(ins.productId);
    const profile = representativeProfile(ins.profileKey);
    const runs = runsWords(product, profile);
    const chosen = Object.entries(choices[ins.productId]?.[ins.profileKey] ?? {}).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
    const chosenProduct = chosen ? catalog.product(chosen[0]) : null;
    let tail;
    let basisChoice = null;
    if (chosenProduct) {
      tail = `shoppers like this often chose ${chosenProduct.shadeName}`;
      basisChoice = `${chosen[1]} live ${chosen[1] === 1 ? 'exchange' : 'exchanges'} to ${chosenProduct.shadeName}`;
    } else if (ins.recommendName) {
      tail = `for that colouring, MirrorMatch's matcher picks ${ins.recommendName}`;
    } else {
      tail = 'consider a shade-finder prompt on the product page';
    }
    const note = `${cap(runs.text)}; ${tail}.`;
    const basis = `${ins.count} of ${ins.total} ${synthetic ? 'synthetic' : 'live'} returns of ${product.shadeName} came from ${ins.profileLabel.toLowerCase()} profiles${basisChoice ? `; ${basisChoice}` : ''}.`;
    return {
      id: `note:${source}:${ins.productId}:${ins.profileKey}`,
      kind: 'note',
      title: 'Product-page fit note (draft)',
      category: product.category,
      productId: product.id,
      productName: ins.productName,
      shadeName: product.shadeName,
      hex: product.hex,
      profileKey: ins.profileKey,
      profileLabel: ins.profileLabel,
      recommendId: chosenProduct?.id ?? ins.recommendId,
      recommendName: chosenProduct?.shadeName ?? ins.recommendName,
      recommendHex: (chosenProduct ?? catalog.product(ins.recommendId))?.hex ?? null,
      recommendBasis: chosenProduct ? 'live_exchanges' : 'matcher',
      runs: runs.words,
      count: ins.count,
      total: ins.total,
      share: ins.share,
      source,
      synthetic,
      note,
      basis,
      text: synthetic ? `${SYNTHETIC_LABEL}: ${note}` : note,
    };
  });
}

/** Latest Approve / Dismiss per suggestion id, from the live event log. */
export function decisionsFrom(events) {
  const out = {};
  for (const e of events) {
    if (e.type !== 'suggestion_approved' && e.type !== 'suggestion_dismissed') continue;
    out[e.suggestionId] = { decision: e.type === 'suggestion_approved' ? 'approved' : 'dismissed', at: e.at };
  }
  return out;
}

/** All suggestions for the dashboard. Deterministic for a given catalogue, events and history. */
export function buildSuggestions({ catalog, events = [], synthetic = { records: [] }, liveEscalations = {} }) {
  const shades = [];
  for (const category of FIT_CATEGORIES) {
    const m = fitMatrix({ catalog, category, liveEscalations });
    for (const gap of m.gaps) shades.push(proposeShade({ catalog, gap }));
  }
  const order = { range: 0, live: 1, thin: 2 };
  shades.sort((a, b) => order[a.gapKind] - order[b.gapKind] || b.liveEscalations - a.liveEscalations || a.id.localeCompare(b.id));
  const liveHeat = aggregate(recordsFromEvents(events)).heat;
  const live = fitNotes({ catalog, heat: liveHeat, source: 'live', choices: liveChoices(events), minReturns: 2, limit: 3 });
  const synth = fitNotes({ catalog, heat: aggregate(synthetic.records ?? []).heat, source: 'synthetic', minReturns: 3, limit: 3 });
  const decisions = decisionsFrom(events);
  return [...shades, ...live, ...synth].map((s) => ({ ...s, decision: decisions[s.id] ?? null }));
}

const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

// ---------- YouCam's official sample model ----------

/** Official sample images, as listed in ASSETS.md (used only if the local file is missing). */
export const SAMPLE_URLS = {
  face: 'https://plugins-media.makeupar.com/strapi/assets/sample_Image_7_fa28b2618a.jpg',
  body: 'https://plugins-media.makeupar.com/strapi/assets/clothes_03_cccd5d4803.jpeg',
};
export const SAMPLE_KINDS = ['face', 'body'];

const mimeOf = (buf) =>
  buf[0] === 0x89 && buf[1] === 0x50 ? 'image/png' : buf[0] === 0xff && buf[1] === 0xd8 ? 'image/jpeg' : null;

/**
 * Canonical sample bytes: <dir>/face.jpg and <dir>/body.jpg (or .jpeg / .png). If a file is
 * missing it is fetched once from the official URL and kept in memory only. The bytes are
 * served unchanged, so the demo cache (keyed by the photo's SHA-256) hits on repeat runs.
 */
export function createSampleStore({ dir, urls = SAMPLE_URLS, fetchImpl = globalThis.fetch, timeoutMs = 15000 } = {}) {
  const memo = new Map(); // kind -> Promise<{ buffer, mime, sha, source }>
  async function load(kind) {
    for (const ext of ['jpg', 'jpeg', 'png']) {
      const path = dir ? join(dir, `${kind}.${ext}`) : null;
      if (path && existsSync(path)) {
        const buffer = await readFile(path);
        const mime = mimeOf(buffer);
        if (mime) return { buffer, mime, source: 'local' };
      }
    }
    const url = urls?.[kind];
    if (!url || !fetchImpl) throw Object.assign(new Error('sample not available'), { code: 'sample_unavailable' });
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) throw Object.assign(new Error(`sample fetch failed (${res.status})`), { code: 'sample_unavailable' });
    const buffer = Buffer.from(await res.arrayBuffer());
    const mime = mimeOf(buffer);
    if (!mime) throw Object.assign(new Error('sample is not a JPEG or PNG'), { code: 'sample_unavailable' });
    return { buffer, mime, source: 'official-url' };
  }
  return {
    kinds: SAMPLE_KINDS,
    async get(kind) {
      if (!SAMPLE_KINDS.includes(kind)) throw Object.assign(new Error('unknown sample'), { code: 'bad_sample' });
      if (!memo.has(kind)) {
        const p = load(kind).then((s) => ({ ...s, sha: createHash('sha256').update(s.buffer).digest('hex') }));
        memo.set(kind, p);
        p.catch(() => memo.delete(kind)); // a failed fetch may be retried later
      }
      return memo.get(kind);
    },
    /** Whether a local file exists (no network). */
    hasLocal(kind) {
      return ['jpg', 'jpeg', 'png'].some((ext) => dir && existsSync(join(dir, `${kind}.${ext}`)));
    },
  };
}

// ---------- preview a proposed shade on the sample model ----------

/** The makeup-vto request body for a custom colour (same effects the shopper flow uses). */
export function previewBody(category, hex, fileId) {
  const noSmoothing = { category: 'skin_smooth', skinSmoothStrength: 0, skinSmoothColorIntensity: 0 };
  if (category === 'lipstick') {
    return {
      src_file_id: fileId,
      version: '1.0',
      effects: [noSmoothing, { category: 'lip_color', shape: { name: 'original' }, style: { type: 'full' }, palettes: [{ color: hex, texture: 'matte', colorIntensity: 75 }] }],
    };
  }
  if (category === 'foundation') {
    return {
      src_file_id: fileId,
      version: '1.0',
      effects: [noSmoothing, { category: 'foundation', palettes: [{ color: hex, colorIntensity: 60, glowIntensity: 10, coverageIntensity: 55 }] }],
    };
  }
  throw Object.assign(new Error('Only lipstick and foundation shades can be previewed with makeup try-on'), { code: 'not_previewable' });
}

/**
 * Renders a proposed colour on the face sample with makeup-vto (1 unit), cached in memory and
 * in the opt-in demo cache, so each colour is paid for once. The YouCam task is deleted after
 * download. Same unit floor and daily cap as the shopper flow.
 */
export function createPreviewRenderer({ youcam, meter, config, demoCache, samples, log = () => {} }) {
  const mem = new Map(); // key -> { buffer, contentType }
  const inflight = new Map();
  const keyFor = (sha, category, hex) => createHash('sha256').update(`suggest-preview:${sha}:${category}:${hex}`).digest('hex').slice(0, 24);
  function budgetCheck(feature) {
    const cost = meter.costOf(feature);
    if (meter.balance !== null && meter.balance - cost < config.budget.unitFloor) {
      throw Object.assign(new Error('Unit balance is below the safety floor'), { code: 'unit_floor' });
    }
    if (config.budget.dailyUnitCap > 0 && meter.spentToday + cost > config.budget.dailyUnitCap) {
      throw Object.assign(new Error('Daily unit cap reached'), { code: 'unit_floor' });
    }
  }
  async function render({ category, hex }) {
    if (!/^#[0-9A-F]{6}$/i.test(hex)) throw Object.assign(new Error('bad colour'), { code: 'bad_colour' });
    hex = hex.toUpperCase();
    const sample = await samples.get('face');
    const key = keyFor(sample.sha, category, hex);
    if (mem.has(key)) return { key, cached: true, units: 0 };
    const disk = await demoCache.getBinary(`suggest-preview:${sample.sha}:${category}:${hex}`);
    if (disk) {
      mem.set(key, disk);
      return { key, cached: true, units: 0 };
    }
    if (inflight.has(key)) return inflight.get(key);
    const job = (async () => {
      previewBody(category, hex, 'check'); // throws for categories makeup-vto can't show
      budgetCheck('makeup-vto');
      const fileId = await youcam.uploadImage(sample.buffer, { contentType: sample.mime, fileName: sample.mime === 'image/png' ? 'sample.png' : 'sample.jpg' });
      const r = await youcam.runAndWait('makeup-vto', previewBody(category, hex, fileId), { sessionId: 'merchant-preview' });
      try {
        const url = resultUrl(r.data);
        if (!url) throw Object.assign(new Error('Render returned no image'), { code: 'no_result' });
        const dl = await youcam.download(url);
        mem.set(key, dl);
        await demoCache.setBinary(`suggest-preview:${sample.sha}:${category}:${hex}`, dl);
        return { key, cached: false, units: r.units, via: r.via ?? youcam.transport };
      } finally {
        if (r.taskId && config.youcam?.deleteTasksOnEnd !== false) youcam.deleteTask(r.taskId).catch?.(() => log('preview task delete failed'));
      }
    })();
    inflight.set(key, job);
    try {
      return await job;
    } finally {
      inflight.delete(key);
    }
  }
  return { render, image: (key) => mem.get(key) ?? null };
}
