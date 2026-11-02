// Optional MCP transport (YOUCAM_TRANSPORT=mcp): runs the agent's YouCam tasks through
// YouCam's hosted MCP servers (streamable HTTP, JSON-RPC) instead of the REST task endpoints.
// File upload, credit, download and task delete still use REST, so metering, privacy cleanup
// and caching behave exactly the same. Verified live: see API_NOTES.md.
import { YouCamClient } from './client.js';
import { YouCamError } from './errors.js';

const SERVERS = {
  beauty: 'https://mcp-api-01.makeupar.com/mcp/beauty',
  fashion: 'https://mcp-api-01.makeupar.com/mcp/fashion',
};

// REST feature -> [MCP server, tool name]
export const MCP_TOOLS = {
  'skin-tone-analysis': ['beauty', 'AI-Facial-Color-Tones-Analyzer'],
  'makeup-vto': ['beauty', 'AI-Makeup-Virtual-Try-On'],
  'cloth-v4': ['fashion', 'AI-Clothes-Virtual-Try-On'],
  cloth: ['fashion', 'AI-Clothes-Virtual-Try-On'],
};

export class McpSession {
  constructor(url, apiKey) {
    this.url = url;
    this.apiKey = apiKey;
    this.sessionId = null;
    this.ready = null;
    this.nextId = 1;
  }

  async post(payload, timeoutMs = 180000) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const headers = {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      };
      if (this.sessionId) headers['Mcp-Session-Id'] = this.sessionId;
      const res = await fetch(this.url, { method: 'POST', headers, body: JSON.stringify(payload), signal: ctrl.signal });
      this.sessionId = res.headers.get('mcp-session-id') || this.sessionId;
      const text = await res.text();
      if (!res.ok) throw new YouCamError(`MCP HTTP ${res.status}`, { status: res.status, code: `mcp_http_${res.status}` });
      if (!text) return null;
      const ctype = res.headers.get('content-type') || '';
      if (ctype.includes('text/event-stream')) {
        // Take the last JSON-RPC message carrying our id (servers may stream progress first).
        const msgs = text
          .split('\n')
          .filter((l) => l.startsWith('data:'))
          .map((l) => {
            try {
              return JSON.parse(l.slice(5).trim());
            } catch {
              return null;
            }
          })
          .filter(Boolean);
        return msgs.reverse().find((m) => m.id === payload.id) ?? msgs[0] ?? null;
      }
      return JSON.parse(text);
    } finally {
      clearTimeout(t);
    }
  }

  async init() {
    if (!this.ready) {
      this.ready = (async () => {
        await this.post({ jsonrpc: '2.0', id: this.nextId++, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'secondtry', version: '1.0.0' } } });
        await this.post({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} });
      })().catch((e) => {
        this.ready = null;
        throw e;
      });
    }
    return this.ready;
  }

  async callTool(name, args) {
    await this.init();
    const id = this.nextId++;
    const msg = await this.post({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } });
    if (msg?.error) throw new YouCamError(msg.error.message || 'MCP error', { code: 'mcp_error' });
    return msg?.result;
  }
}

/** Pull the YouCam task payload out of an MCP tool result (structuredContent or text JSON). */
export function parseToolResult(result) {
  if (!result) return null;
  let obj = result.structuredContent ?? null;
  if (!obj) {
    const text = (result.content ?? []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');
    try {
      obj = JSON.parse(text);
    } catch {
      const m = /\{[\s\S]*\}/.exec(text);
      obj = m ? JSON.parse(m[0]) : { text };
    }
  }
  if (obj && obj.result && typeof obj.result === 'object' && !Array.isArray(obj.result)) obj = obj.result;
  const data = obj.data ?? obj;
  return { data, isError: Boolean(result.isError), raw: obj };
}

export class McpYouCamClient extends YouCamClient {
  constructor(opts) {
    super(opts);
    this.mode = 'live';
    this.transport = 'mcp';
    this.sessions = {};
  }

  session(server) {
    this.sessions[server] ??= new McpSession(SERVERS[server], this.apiKey);
    return this.sessions[server];
  }

  async runAndWait(feature, body, { sessionId } = {}) {
    const map = MCP_TOOLS[feature];
    if (!map) return super.runAndWait(feature, body, { sessionId });
    const [server, tool] = map;
    const t0 = Date.now();
    try {
      const result = await this.session(server).callTool(tool, { request: body, polling: true });
      const parsed = parseToolResult(result);
      const data = parsed?.data ?? {};
      const taskId = data.task_id ?? parsed?.raw?.task_id ?? null;
      if (parsed?.isError || data.task_status === 'error' || data.error) {
        const code = typeof data.error === 'string' ? data.error : data.error_code || 'mcp_task_error';
        throw new YouCamError(data.error_message || String(code), { code, feature });
      }
      if (data.task_status !== 'success') {
        // Polling did not finish inside the tool call (or the reply was not a task payload):
        // finish via REST polling if we have a task id, otherwise fall back to REST entirely.
        if (!taskId) {
          this.log(`[mcp] ${feature}: unexpected reply shape ${JSON.stringify(Object.keys(parsed?.raw ?? {}))}`);
          throw new YouCamError('MCP reply had no task result', { code: 'mcp_incomplete', feature });
        }
        const done = await this.pollTask(feature, taskId);
        Object.assign(data, done);
      }
      const hasResult = feature === 'skin-tone-analysis' ? Boolean(data.results?.color) : Boolean(data.results?.url);
      if (!hasResult) throw new YouCamError('MCP task finished without a result', { code: 'mcp_incomplete', feature });
      const ms = Date.now() - t0;
      const entry = this.meter.record({ feature, ok: true, ms, sessionId });
      return { data, taskId, ms, units: entry.units, via: 'mcp' };
    } catch (e) {
      // Transport/protocol failures (not task errors like error_no_face) fall back to REST,
      // so the shopper never sees an MCP outage.
      if (String(e.code || '').startsWith('mcp_') || e.name === 'AbortError' || e.code === undefined) {
        this.log(`[mcp] ${feature} transport error (${e.code || e.name}); falling back to REST`);
        const r = await super.runAndWait(feature, body, { sessionId });
        return { ...r, via: 'rest-fallback' };
      }
      const ms = Date.now() - t0;
      this.meter.record({ feature, ok: false, ms, sessionId });
      e.ms = ms;
      throw e;
    }
  }
}
