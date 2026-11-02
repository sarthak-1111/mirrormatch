// Live checks for the "complete the look", hair-colour and skin-analysis features.
// Each call goes through the same MCP transport (with REST fallback) the agent uses.
// Prints latency, units, transport and the result's shape: never URLs or raw scores.
// Raw outputs go to ./raw (gitignored). Photos must be your own or YouCam official samples.
//
//   node scripts/verify-new-apis.mjs --skin  <selfie.jpg>        skin-analysis SD, 4 concerns (9 units)
//   node scripts/verify-new-apis.mjs --hair  <selfie.jpg>        hair-color, full pattern (1 unit)
//   node scripts/verify-new-apis.mjs --blush <selfie.jpg>        makeup-vto lip_color + blush in one call (1 unit)
//   node scripts/verify-new-apis.mjs --lips  <render.jpg>        makeup-vto lip_color on a clothes try-on render (1 unit)
//   node scripts/verify-new-apis.mjs --patterns                  blush / eye-shadow pattern names over MCP (0 units)
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { config } from '../server/config.js';
import { UnitMeter } from '../server/youcam/meter.js';
import { McpYouCamClient, McpSession } from '../server/youcam/mcp.js';
import { resultUrl } from '../server/youcam/client.js';
import { SKIN_ACTIONS } from '../server/color/skin.js';

const args = process.argv.slice(2);
const arg = (k) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 ? args[i + 1] : null;
};
if (!config.youcam.apiKey) {
  console.error('YOUCAM_API_KEY not set');
  process.exit(1);
}
const meter = new UnitMeter();
const yc = new McpYouCamClient({ apiKey: config.youcam.apiKey, baseUrl: config.youcam.baseUrl, meter, log: (m) => console.log(m) });
mkdirSync('raw', { recursive: true });
const shape = (o, depth = 0) =>
  Array.isArray(o) ? `[${o.length}× ${shape(o[0], depth + 1)}]` : o && typeof o === 'object' && depth < 3 ? `{${Object.keys(o).map((k) => `${k}:${shape(o[k], depth + 1)}`).join(', ')}}` : typeof o;

async function upload(path) {
  const buf = readFileSync(path);
  const png = /\.png$/i.test(path);
  return yc.uploadImage(buf, { contentType: png ? 'image/png' : 'image/jpeg', fileName: png ? 'v.png' : 'v.jpg' });
}

async function run(name, feature, body) {
  const t0 = Date.now();
  try {
    const r = await yc.runAndWait(feature, body);
    console.log(`${name}: ${feature} ok in ${Date.now() - t0} ms via ${r.via ?? 'rest'}, ${r.units} unit(s)`);
    console.log('  results shape:', shape(r.data.results));
    writeFileSync(`raw/verify-${name}.json`, JSON.stringify(r.data, null, 2));
    const url = resultUrl(r.data);
    if (url) {
      const dl = await yc.download(url);
      writeFileSync(`raw/verify-${name}.img`, dl.buffer);
      console.log(`  image downloaded (${dl.contentType}, ${dl.buffer.length} bytes)`);
    }
    if (r.taskId) console.log('  task delete:', await yc.deleteTask(r.taskId));
    return r;
  } catch (e) {
    console.log(`${name}: ${feature} FAILED in ${Date.now() - t0} ms: ${e.code} ${e.message}`);
    if (e.taskId) await yc.deleteTask(e.taskId);
    return null;
  }
}

if (args.includes('--patterns')) {
  const s = new McpSession('https://mcp-api-01.makeupar.com/mcp/beauty', config.youcam.apiKey);
  const res = await s.callTool('AI-Makeup-Virtual-Try-On-Pattern-Name', { categories: ['blush', 'eyeshadow'] });
  const text = JSON.stringify(res);
  for (const cat of ['blush', 'eyeshadow']) console.log(cat, 'has 1color1:', text.includes('1color1'));
  writeFileSync('raw/verify-patterns.json', JSON.stringify(res, null, 2));
}

if (arg('skin')) {
  const src = await upload(arg('skin'));
  await run('skin', 'skin-analysis', { src_file_id: src, dst_actions: SKIN_ACTIONS, format: 'json', miniserver_args: { enable_mask_overlay: false } });
}

if (arg('hair')) {
  const src = await upload(arg('hair'));
  await run('hair', 'hair-color', { src_file_id: src, pattern: { name: 'full' }, palettes: [{ color: '#7A5230', color_intensity: 70, shine_intensity: 40 }] });
}

const lip = { category: 'lip_color', shape: { name: 'original' }, style: { type: 'full' }, palettes: [{ color: '#A5585E', texture: 'matte', colorIntensity: 75 }] };
const noSmooth = { category: 'skin_smooth', skinSmoothStrength: 0, skinSmoothColorIntensity: 0 };

if (arg('blush')) {
  const src = await upload(arg('blush'));
  await run('blush', 'makeup-vto', {
    src_file_id: src,
    version: '1.0',
    effects: [noSmooth, lip, { category: 'blush', pattern: { name: '1color1' }, palettes: [{ color: '#D98A85', texture: 'matte', colorIntensity: 45 }] }],
  });
}

if (arg('lips')) {
  const src = await upload(arg('lips'));
  await run('lips', 'makeup-vto', { src_file_id: src, version: '1.0', effects: [noSmooth, lip] });
}

console.log('units this run:', meter.snapshot().spentThisRun);
