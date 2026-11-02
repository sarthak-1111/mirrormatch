// Live check of the MCP transport: uploads an image via REST, then runs makeup-vto (1 unit)
// through YouCam's hosted MCP server. Usage: node scripts/check-mcp-call.mjs <selfie.jpg> [--tone]
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { config } from '../server/config.js';
import { UnitMeter } from '../server/youcam/meter.js';
import { McpYouCamClient, McpSession } from '../server/youcam/mcp.js';
import { resultUrl } from '../server/youcam/client.js';

const photo = process.argv[2];
const meter = new UnitMeter();
const yc = new McpYouCamClient({ apiKey: config.youcam.apiKey, baseUrl: config.youcam.baseUrl, meter });
mkdirSync('raw', { recursive: true });

if (process.argv.includes('--schema')) {
  const s = new McpSession('https://mcp-api-01.makeupar.com/mcp/fashion', config.youcam.apiKey);
  await s.init();
  const list = await s.post({ jsonrpc: '2.0', id: 99, method: 'tools/list', params: {} });
  const t = list.result.tools.find((x) => x.name === 'AI-Clothes-Virtual-Try-On');
  console.log(JSON.stringify(t.inputSchema).slice(0, 3000));
  process.exit(0);
}

if (process.argv.includes('--cloth')) {
  const garment = process.argv[process.argv.indexOf('--cloth') + 1];
  const src = await yc.uploadImage(readFileSync(photo), { contentType: 'image/jpeg', fileName: 'body.jpg' });
  const ref = await yc.uploadImage(readFileSync(garment), { contentType: 'image/png', fileName: 'garment.png' });
  const s = new McpSession('https://mcp-api-01.makeupar.com/mcp/fashion', config.youcam.apiKey);
  const t0 = Date.now();
  const res = await s.callTool('AI-Clothes-Virtual-Try-On', { request: { src_file_id: src, ref_file_id: ref, garment_category: 'full_body' }, polling: true });
  const redact = (o) => JSON.stringify(o, (k, v) => (typeof v === 'string' && v.startsWith('http') ? '<url>' : v));
  console.log(`${Date.now() - t0} ms`, redact(res).slice(0, 1500));
  process.exit(0);
}

const fileId = await yc.uploadImage(readFileSync(photo), { contentType: 'image/jpeg', fileName: 'mcp-check.jpg' });
console.log('uploaded via REST');
const t0 = Date.now();
const r = await yc.runAndWait('makeup-vto', {
  src_file_id: fileId,
  version: '1.0',
  effects: [
    { category: 'skin_smooth', skinSmoothStrength: 0, skinSmoothColorIntensity: 0 },
    { category: 'lip_color', shape: { name: 'original' }, style: { type: 'full' }, palettes: [{ color: '#B97A5E', texture: 'matte', colorIntensity: 75 }] },
  ],
});
console.log(`makeup-vto via MCP: ${Date.now() - t0} ms, units ${r.units}, task_id ${r.taskId ? 'yes' : 'no'}, keys`, Object.keys(r.data));
writeFileSync('raw/mcp-makeup.json', JSON.stringify(r.data, null, 2));
const url = resultUrl(r.data);
if (url) {
  writeFileSync('raw/mcp-makeup.jpg', (await yc.download(url)).buffer);
  console.log('result image downloaded');
}
if (r.taskId) console.log('task delete:', await yc.deleteTask(r.taskId));
