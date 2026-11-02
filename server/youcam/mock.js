// Mock transport with the same interface as YouCamClient. Used when no YOUCAM_API_KEY is
// set (or with --mock), so the flow, tests and CI run without spending units.
// Everything it returns is flagged mock:true and the UI shows a "Mock mode" badge, so mock
// output can never be mistaken for a real YouCam result.
import { createHash } from 'node:crypto';
import { YouCamError } from './errors.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class MockYouCamClient {
  constructor({ meter, latencyMs = 250 } = {}) {
    this.meter = meter;
    this.latencyMs = latencyMs;
    this.mode = 'mock';
    this.files = new Map();
    this.tasks = new Map();
    this.balance = 1000;
  }

  async getCredit() {
    return { total: this.balance, items: [{ type: 'MockUnits', amount: this.balance }], mock: true };
  }

  async getFeatureCosts() {
    return [];
  }

  async listTemplates() {
    return [];
  }

  async uploadImage(buffer) {
    const id = `mockfile_${createHash('sha256').update(buffer).digest('hex').slice(0, 16)}`;
    this.files.set(id, buffer);
    return id;
  }

  async runAndWait(feature, body, { sessionId, hint } = {}) {
    const t0 = Date.now();
    await sleep(this.latencyMs);
    const taskId = `mocktask_${this.tasks.size + 1}`;
    let data;
    if (feature === 'skin-tone-analysis') {
      if (hint?.forceError) {
        this.meter.record({ feature, ok: false, ms: Date.now() - t0, sessionId });
        const e = new YouCamError('Mock analysis error', { code: hint.forceError, feature });
        e.taskId = taskId;
        throw e;
      }
      data = {
        task_status: 'success',
        mock: true,
        results: {
          face_quality: { has_face: true, area: 'good', frontal: 'good', lighting: 'good', faceangle: 'good' },
          color: {
            skin_color: hint?.skinHex || '#C69C80',
            lip_color: hint?.lipHex || '#B86A5E',
            eye_color: '#5B3A1F',
            eye_color_name: 'Brown',
            eyebrow_color: '#4A3020',
            hair_color: '#42280E',
            hair_color_name: 'Brown',
          },
        },
      };
    } else if (feature === 'skin-analysis') {
      // Same shape as the live SD JSON result (verified 2026-11-02). Default reading: a little
      // shine, comfortable hydration, some redness. Tests can pass hint.skin to change it.
      if (hint?.forceSkinError) {
        this.meter.record({ feature, ok: false, ms: Date.now() - t0, sessionId });
        const e = new YouCamError('Mock skin analysis error', { code: hint.forceSkinError, feature });
        e.taskId = taskId;
        throw e;
      }
      const s = { oiliness: 42, moisture: 64, redness: 55, type: 'Oily', tZone: 'Oily', uZone: 'Normal', ...(hint?.skin ?? {}) };
      const score = (type, raw) => ({ type, raw_score: raw, ui_score: Math.min(99, Math.round(raw * 0.6 + 40)), mask_urls: [] });
      data = {
        task_status: 'success',
        mock: true,
        results: {
          output: [
            ...(body.dst_actions ?? []).filter((a) => a !== 'skin_type' && s[a] != null).map((a) => score(a, s[a])),
            { type: 'skin_type', region: 'whole', skin_type: s.type, mask_urls: [] },
            { type: 'skin_type', region: 't_zone', skin_type: s.tZone, mask_urls: [] },
            { type: 'skin_type', region: 'u_zone', skin_type: s.uZone, mask_urls: [] },
            { type: 'all', score: 80 },
          ],
        },
      };
    } else {
      // makeup-vto, cloth-v4 and hair-color: the "render" is the source image itself.
      data = { task_status: 'success', mock: true, results: { url: `mock://${taskId}` }, src: body.src_file_id };
    }
    this.tasks.set(taskId, { feature, body });
    const ms = Date.now() - t0;
    const entry = this.meter.record({ feature, ok: true, ms, sessionId });
    this.balance -= entry.units;
    return { data, taskId, ms, units: entry.units };
  }

  async deleteTask(taskId) {
    this.tasks.delete(taskId);
    return true;
  }

  async download(url) {
    const taskId = url.replace('mock://', '');
    const task = this.tasks.get(taskId);
    const buffer = task ? this.files.get(task.body.src_file_id) : null;
    if (!buffer) throw new YouCamError('Mock result missing', { code: 'download' });
    return { buffer, contentType: 'image/jpeg' };
  }
}
