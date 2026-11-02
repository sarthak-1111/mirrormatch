// YouCam API V2 server-to-server client.
// Flow (verified against https://docs.perfectcorp.com, v1.17):
//   1. POST /s2s/v2.0/file              register a file -> file_id + pre-signed upload URL
//   2. PUT  <pre-signed URL>            upload the bytes with the returned headers
//   3. POST /s2s/v2.0/task/<feature>    create a task -> task_id
//   4. GET  /s2s/v2.0/task/<feature>/<task_id>   poll until task_status is success | error
//   5. POST /s2s/v2.0/task/delete       delete the task with its input and output files
// Auth: "Authorization: Bearer <YOUCAM_API_KEY>". Result URLs are valid for 2 hours.
import { YouCamError } from './errors.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class YouCamClient {
  constructor({ apiKey, baseUrl, meter, pollIntervalMs = 1500, pollTimeoutMs = 120000, log = () => {} }) {
    if (!apiKey) throw new Error('YouCamClient needs an API key');
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
    this.meter = meter;
    this.pollIntervalMs = pollIntervalMs;
    this.pollTimeoutMs = pollTimeoutMs;
    this.log = log;
    this.mode = 'live';
  }

  async request(method, path, body, { retries = 2, timeoutMs = 30000 } = {}) {
    const url = `${this.baseUrl}${path}`;
    for (let attempt = 0; ; attempt++) {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), timeoutMs);
      let res;
      try {
        res = await fetch(url, {
          method,
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: ctrl.signal,
        });
      } catch (e) {
        clearTimeout(t);
        if (attempt < retries) {
          await sleep(800 * (attempt + 1));
          continue;
        }
        throw new YouCamError(`Network error calling ${path}: ${e.message}`, { code: 'network', retryable: true });
      }
      clearTimeout(t);
      let json = null;
      const text = await res.text();
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = null;
      }
      if ((res.status === 429 || res.status >= 500) && attempt < retries) {
        await sleep(1200 * (attempt + 1));
        continue;
      }
      if (!res.ok) {
        const code = json?.error_code || json?.data?.error || `http_${res.status}`;
        throw new YouCamError(json?.error || `YouCam ${method} ${path} failed (${res.status})`, {
          status: res.status,
          code,
          retryable: res.status === 429 || res.status >= 500,
        });
      }
      return json;
    }
  }

  async getCredit() {
    const json = await this.request('GET', '/s2s/v1.0/client/credit');
    const items = json?.results ?? json?.data?.results ?? [];
    const total = items.reduce((s, it) => s + (typeof it.amount_dec === 'number' ? it.amount_dec : it.amount || 0), 0);
    return { total: Math.round(total * 100) / 100, items: items.map((i) => ({ type: i.type, amount: i.amount_dec ?? i.amount, expiry: i.expiry })) };
  }

  async getFeatureCosts() {
    const skus = [];
    let token = null;
    for (let page = 0; page < 10; page++) {
      const qs = new URLSearchParams({ page_size: '20' });
      if (token) qs.set('starting_token', token);
      const json = await this.request('GET', `/s2s/v2.0/credit/feature-cost?${qs}`);
      const r = json?.result ?? json?.data ?? {};
      skus.push(...(r.skus ?? []));
      token = r.next_token;
      if (!token) break;
    }
    return skus;
  }

  async listTemplates(kind, pageSize = 20) {
    const json = await this.request('GET', `/s2s/v2.0/task/template/${kind}?page_size=${pageSize}`);
    return json?.data?.templates ?? json?.templates ?? [];
  }

  /** Register + upload an image. Returns file_id. */
  async uploadImage(buffer, { contentType = 'image/jpeg', fileName = 'photo.jpg' } = {}) {
    const json = await this.request('POST', '/s2s/v2.0/file', {
      files: [{ content_type: contentType, file_name: fileName, file_size: buffer.length }],
    });
    const file = (json?.data?.files ?? json?.files ?? [])[0];
    const req = file?.requests?.[0];
    if (!file?.file_id || !req?.url) throw new YouCamError('File API returned no upload URL', { code: 'file_api' });
    const headers = {};
    for (const [k, v] of Object.entries(req.headers ?? {})) headers[k] = String(v);
    const put = await fetch(req.url, { method: req.method || 'PUT', headers, body: buffer });
    if (!put.ok) throw new YouCamError(`Upload to pre-signed URL failed (${put.status})`, { code: 'upload', status: put.status });
    return file.file_id;
  }

  async runTask(feature, body) {
    const json = await this.request('POST', `/s2s/v2.0/task/${feature}`, body, { retries: 1 });
    const taskId = json?.data?.task_id ?? json?.task_id;
    if (!taskId) throw new YouCamError('Task API returned no task_id', { code: 'task_api', feature });
    return taskId;
  }

  async pollTask(feature, taskId) {
    const start = Date.now();
    let interval = this.pollIntervalMs;
    for (;;) {
      const json = await this.request('GET', `/s2s/v2.0/task/${feature}/${encodeURIComponent(taskId)}`);
      const data = json?.data ?? json ?? {};
      const status = data.task_status;
      if (status === 'success') return data;
      if (status === 'error') {
        throw new YouCamError(data.error_message || data.error || 'Task failed', {
          code: data.error || 'task_error',
          feature,
        });
      }
      if (Date.now() - start > this.pollTimeoutMs) {
        throw new YouCamError('Task polling timed out', { code: 'poll_timeout', feature, retryable: true });
      }
      await sleep(interval);
      interval = Math.min(interval * 1.25, 4000);
    }
  }

  /** create task + poll; meters units on success. Returns { data, taskId, ms }. */
  async runAndWait(feature, body, { sessionId } = {}) {
    const t0 = Date.now();
    let taskId;
    try {
      taskId = await this.runTask(feature, body);
      const data = await this.pollTask(feature, taskId);
      const ms = Date.now() - t0;
      const entry = this.meter.record({ feature, ok: true, ms, sessionId });
      return { data, taskId, ms, units: entry.units };
    } catch (e) {
      const ms = Date.now() - t0;
      this.meter.record({ feature, ok: false, ms, sessionId });
      e.taskId = taskId;
      e.ms = ms;
      throw e;
    }
  }

  async deleteTask(taskId) {
    try {
      await this.request('POST', '/s2s/v2.0/task/delete', { task_id: taskId }, { retries: 0 });
      return true;
    } catch (e) {
      this.log(`task delete failed: ${e.code}`);
      return false;
    }
  }

  async download(url) {
    const res = await fetch(url);
    if (!res.ok) throw new YouCamError(`Result download failed (${res.status})`, { code: 'download', status: res.status });
    return {
      buffer: Buffer.from(await res.arrayBuffer()),
      contentType: res.headers.get('content-type') || 'image/jpeg',
    };
  }
}

/** Result URL for render tasks (shape differs slightly between features). */
export function resultUrl(data) {
  return data?.results?.url ?? data?.url ?? data?.results?.[0]?.url ?? null;
}
