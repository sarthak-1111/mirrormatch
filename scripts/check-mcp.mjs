// Checks whether YouCam's hosted MCP servers answer a JSON-RPC initialize + tools/list
// over streamable HTTP, and prints the tool names and input schemas we'd use.
// Usage: node scripts/check-mcp.mjs [beauty|fashion]
import { config } from '../server/config.js';

const which = process.argv[2] || 'beauty';
const url = `https://mcp-api-01.makeupar.com/mcp/${which}`;
if (!config.youcam.apiKey) {
  console.error('YOUCAM_API_KEY not set');
  process.exit(1);
}

let sessionId = null;
async function rpc(method, params, id) {
  const headers = {
    Authorization: `Bearer ${config.youcam.apiKey}`,
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
  };
  if (sessionId) headers['Mcp-Session-Id'] = sessionId;
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ jsonrpc: '2.0', method, params, ...(id !== undefined ? { id } : {}) }),
  });
  sessionId = res.headers.get('mcp-session-id') || sessionId;
  const text = await res.text();
  const ctype = res.headers.get('content-type') || '';
  let payload = text;
  if (ctype.includes('text/event-stream')) {
    const data = text.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).filter(Boolean);
    payload = data.length ? data[data.length - 1] : '';
  }
  try {
    return { status: res.status, json: payload ? JSON.parse(payload) : null };
  } catch {
    return { status: res.status, json: null, text: text.slice(0, 300) };
  }
}

const init = await rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'secondtry-check', version: '1.0.0' } }, 1);
console.log('initialize:', init.status, JSON.stringify(init.json?.result?.serverInfo ?? init.json ?? init.text));
await rpc('notifications/initialized', {});
const list = await rpc('tools/list', {}, 2);
const tools = list.json?.result?.tools ?? [];
console.log(`tools/list: ${list.status}, ${tools.length} tools`);
for (const t of tools) {
  const props = Object.keys(t.inputSchema?.properties ?? {});
  console.log(`- ${t.name}: ${props.join(', ')}`);
}
if (process.argv[3]) {
  const t = tools.find((x) => x.name === process.argv[3]);
  console.log(JSON.stringify(t, null, 2));
}
