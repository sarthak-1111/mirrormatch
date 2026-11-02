// Hour-1 live verification of the YouCam endpoints MirrorMatch uses.
// Usage: node scripts/verify-api.mjs --face <selfie.jpg> [--body <chest-up.jpg>] [--garment <garment.png>]
//        [--noface <image-without-face.jpg>] [--skip-tone] [--only credit,costs,templates]
// Prints a summary (shapes, keys, timings, units). Raw JSON goes to ./raw/ (gitignored) and is
// never committed. Spends roughly: skin-tone 20 + makeup 1 + makeup 1 + cloth 2 units.
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { basename, extname } from 'node:path';
import { config } from '../server/config.js';
import { YouCamClient, resultUrl } from '../server/youcam/client.js';
import { UnitMeter } from '../server/youcam/meter.js';

const args = process.argv.slice(2);
const arg = (k) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const flag = (k) => args.includes(`--${k}`);
const only = arg('only')?.split(',');
const want = (k) => !only || only.includes(k);

if (!config.youcam.apiKey) {
  console.error('YOUCAM_API_KEY is not set (use .env or ENV_FILE=...)');
  process.exit(1);
}
mkdirSync('raw', { recursive: true });
const saveRaw = (name, obj) => writeFileSync(`raw/${name}.json`, JSON.stringify(obj, null, 2));
const meter = new UnitMeter();
const yc = new YouCamClient({ apiKey: config.youcam.apiKey, baseUrl: config.youcam.baseUrl, meter });
const tasks = [];
const shape = (o, depth = 0) => {
  if (o === null || typeof o !== 'object') return typeof o;
  if (Array.isArray(o)) return [o.length ? shape(o[0], depth + 1) : 'empty'];
  if (depth > 3) return '{…}';
  return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, shape(v, depth + 1)]));
};
const ct = (p) => (extname(p).toLowerCase() === '.png' ? 'image/png' : 'image/jpeg');

async function step(name, fn) {
  const t0 = Date.now();
  try {
    const r = await fn();
    console.log(`\n✔ ${name} (${Date.now() - t0} ms)`);
    if (r !== undefined) console.log(typeof r === 'string' ? r : JSON.stringify(r, null, 2));
    return r;
  } catch (e) {
    console.log(`\n✘ ${name} (${Date.now() - t0} ms): status=${e.status} code=${e.code} msg=${e.message}`);
    return null;
  }
}

let before;
if (want('credit')) {
  before = await step('GET /s2s/v1.0/client/credit', async () => {
    const c = await yc.getCredit();
    return { total: c.total, items: c.items.map((i) => ({ type: i.type, amount: i.amount })) };
  });
}
if (want('costs')) {
  await step('GET /s2s/v2.0/credit/feature-cost', async () => {
    const skus = await yc.getFeatureCosts();
    saveRaw('feature-cost', skus);
    const ours = skus.filter((s) => /skin-tone|makeup-vto|cloth|look-vto|skin-analysis|file/.test(s.run_task_url));
    return ours.map((s) => `${s.amount} units / ${s.proc_unit} ${s.unit} — ${s.description} — ${s.run_task_url.replace(config.youcam.baseUrl, '')}`).join('\n');
  });
}
if (want('templates')) {
  for (const kind of ['cloth', 'look-vto']) {
    await step(`GET /s2s/v2.0/task/template/${kind}`, async () => {
      const all = [];
      let token = null;
      for (let i = 0; i < 6; i++) {
        const qs = new URLSearchParams({ page_size: '20' });
        if (token) qs.set('starting_token', token);
        const json = await yc.request('GET', `/s2s/v2.0/task/template/${kind}?${qs}`);
        all.push(...(json?.data?.templates ?? []));
        token = json?.data?.next_token;
        if (!token) break;
      }
      saveRaw(`templates-${kind}`, all);
      const cats = {};
      for (const t of all) cats[t.category_name] = (cats[t.category_name] || 0) + 1;
      return { count: all.length, categories: cats, sample: all.slice(0, 5).map((t) => ({ id: t.id, title: t.title, category: t.category_name })) };
    });
  }
}

const face = arg('face');
let faceId;
if (face) {
  faceId = await step(`File API register + PUT upload (${basename(face)})`, async () => yc.uploadImage(readFileSync(face), { contentType: ct(face), fileName: basename(face) }));
}
if (faceId && !flag('skip-tone')) {
  await step('skin-tone-analysis (task + poll)', async () => {
    const r = await yc.runAndWait('skin-tone-analysis', { src_file_id: faceId, face_angle_strictness_level: config.youcam.faceAngleStrictness });
    tasks.push(r.taskId);
    saveRaw('skin-tone-analysis', r.data);
    return { ms: r.ms, units: r.units, resultShape: shape(r.data.results), colorKeys: Object.keys(r.data.results?.color ?? {}), faceQuality: r.data.results?.face_quality };
  });
}
if (faceId) {
  await step('makeup-vto lip_color (task + poll)', async () => {
    const r = await yc.runAndWait('makeup-vto', {
      src_file_id: faceId,
      version: '1.0',
      effects: [
        { category: 'skin_smooth', skinSmoothStrength: 0, skinSmoothColorIntensity: 0 },
        { category: 'lip_color', shape: { name: 'original' }, style: { type: 'full' }, palettes: [{ color: '#A5585E', texture: 'matte', colorIntensity: 70 }] },
      ],
    });
    tasks.push(r.taskId);
    saveRaw('makeup-vto-lip', r.data);
    return { ms: r.ms, units: r.units, resultShape: shape(r.data), hasUrl: Boolean(resultUrl(r.data)) };
  });
  await step('makeup-vto foundation (task + poll)', async () => {
    const r = await yc.runAndWait('makeup-vto', {
      src_file_id: faceId,
      version: '1.0',
      effects: [
        { category: 'skin_smooth', skinSmoothStrength: 0, skinSmoothColorIntensity: 0 },
        { category: 'foundation', palettes: [{ color: '#C9996C', colorIntensity: 60, glowIntensity: 10, coverageIntensity: 55 }] },
      ],
    });
    tasks.push(r.taskId);
    const url = resultUrl(r.data);
    if (url) {
      const dl = await yc.download(url);
      writeFileSync('raw/makeup-foundation.jpg', dl.buffer);
    }
    return { ms: r.ms, units: r.units };
  });
}
const body = arg('body');
const garment = arg('garment');
if (body && garment) {
  const bodyId = await step(`upload body (${basename(body)})`, async () => yc.uploadImage(readFileSync(body), { contentType: ct(body), fileName: basename(body) }));
  const garmentId = await step(`upload garment (${basename(garment)})`, async () => yc.uploadImage(readFileSync(garment), { contentType: ct(garment), fileName: basename(garment) }));
  if (bodyId && garmentId) {
    const feature = config.youcam.clothFeature;
    await step(`${feature} (task + poll), garment_category=${config.youcam.garmentCategory}`, async () => {
      const r = await yc.runAndWait(feature, { src_file_id: bodyId, ref_file_id: garmentId, garment_category: config.youcam.garmentCategory });
      tasks.push(r.taskId);
      saveRaw(`${feature}`, r.data);
      const url = resultUrl(r.data);
      if (url) writeFileSync(`raw/${feature}.jpg`, (await yc.download(url)).buffer);
      return { ms: r.ms, units: r.units, resultShape: shape(r.data) };
    });
  }
}
const noface = arg('noface');
if (noface) {
  const nfId = await step('upload no-face image', async () => yc.uploadImage(readFileSync(noface), { contentType: ct(noface), fileName: basename(noface) }));
  if (nfId) {
    await step(`skin-tone-analysis on ${basename(noface)} (strictness ${arg('strict') || 'high'})`, async () => {
      const r = await yc.runAndWait('skin-tone-analysis', { src_file_id: nfId, face_angle_strictness_level: arg('strict') || 'high' });
      tasks.push(r.taskId);
      saveRaw(`skin-tone-${basename(noface)}`, r.data);
      return { ms: r.ms, units: r.units, faceQuality: r.data.results?.face_quality, skin: Boolean(r.data.results?.color?.skin_color) };
    });
  }
}

for (const t of tasks) await step(`POST /s2s/v2.0/task/delete`, async () => ((await yc.deleteTask(t)) ? 'deleted' : 'not deleted'));

if (want('credit')) {
  await step('credit after', async () => {
    const c = await yc.getCredit();
    return { before: before?.total, after: c.total, spent: before ? Math.round((before.total - c.total) * 100) / 100 : null, ledger: meter.ledger };
  });
}
