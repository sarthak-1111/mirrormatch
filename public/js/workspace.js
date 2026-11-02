// MirrorMatch workspace: the shopper app in a phone frame, the agent console following the
// session running in it, a compact merchant strip, and what is connected. Read-only views of
// existing endpoints, plus the autopilot controls (sent to the app with postMessage).
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const money = (n) => `$${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const $ = (id) => document.getElementById(id);
const getJson = async (url) => {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return r.json();
};

const frame = $('app-frame');
const STEP_LABEL = {
  orders: 'orders',
  reason: 'reason',
  offer: 'offer',
  consent: 'consent',
  capture: 'photo',
  matches: 'matches',
  tryon: 'try-on',
  exchanged: 'exchanged',
  refund_review: 'refund',
  refunded: 'refunded',
  escalated: 'escalated',
};
const EVENT_LABEL = {
  return_started: 'Return started',
  mirrormatch_offered: 'MirrorMatch offered',
  mirrormatch_accepted: 'Shopper tried MirrorMatch',
  mirrormatch_declined: 'Straight to refund',
  photo_retake: 'Photo retake requested',
  tone_analyzed: 'Skin tone analysed',
  renders_done: 'Try-on previews ready',
  exchange_created: 'Exchange created',
  refund_chosen: 'Refund chosen',
  escalated: 'Escalated to a specialist',
  suggestion_approved: 'Suggestion approved',
  suggestion_dismissed: 'Suggestion dismissed',
};

// ---------- agent console ----------
const consoleState = { id: null, timer: null, trace: null, seen: 0, endedPolls: 0 };

function wallClockMs(tools) {
  const spans = tools.map((t) => [Date.parse(t.at), Date.parse(t.at) + (t.ms || 0)]).sort((a, b) => a[0] - b[0]);
  let total = 0;
  let end = -Infinity;
  for (const [a, b] of spans) {
    if (b > end) total += b - Math.max(a, end);
    end = Math.max(end, b);
  }
  return total;
}

function follow(id) {
  if (id === consoleState.id) return;
  clearTimeout(consoleState.timer);
  Object.assign(consoleState, { id, trace: null, seen: 0, endedPolls: 0 });
  $('console-list').innerHTML = '';
  $('console-sum').innerHTML = '';
  $('console-empty').hidden = Boolean(id);
  if (!id) {
    $('ws-session').textContent = 'No return open in the phone.';
    return;
  }
  poll();
}

async function poll() {
  const id = consoleState.id;
  if (!id) return;
  let t;
  try {
    t = await getJson(`/api/trace/${encodeURIComponent(id)}`);
  } catch {
    if (id === consoleState.id) consoleState.timer = setTimeout(poll, 3000);
    return;
  }
  if (id !== consoleState.id) return;
  renderConsole(t);
  // Follow closely while the return is active; after it ends, a few more reads catch the
  // YouCam task clean-up line, then stop.
  if (t.status !== 'active') consoleState.endedPolls += 1;
  if (t.status === 'active' || consoleState.endedPolls < 5) consoleState.timer = setTimeout(poll, t.status === 'active' ? 900 : 1500);
}

function traceItem(t, i, t0, isNew) {
  const at = Date.parse(t.at);
  const rel = Number.isFinite(at) ? `+${((at - t0) / 1000).toFixed(1)} s` : '';
  const cls = isNew ? ' new' : '';
  if (t.kind === 'decision') return `<li class="decision${cls}"><span class="n" aria-hidden="true">→</span><span class="s"><span class="sr-only">Decision: </span>${esc(t.summary)}</span><span class="meta">${rel}</span></li>`;
  if (t.kind === 'cleanup') return `<li class="decision cleanup${cls}"><span class="n" aria-hidden="true">✓</span><span class="s"><span class="sr-only">Clean-up: </span>${esc(t.summary)}</span><span class="meta">${rel}</span></li>`;
  const over = /over MCP/.test(t.summary || '') ? ' · MCP' : '';
  return `<li class="${t.ok ? '' : 'fail'}${cls}"><span class="n">${i + 1}</span><span><span class="tool">${esc(t.tool)}</span> <span class="s">${esc(t.summary)}</span></span><span class="meta">${rel} · ${esc(t.ms)} ms${t.units ? ` · ${esc(t.units)}u` : ''}${t.cached ? ' · cache' : ''}${over}</span></li>`;
}

function renderConsole(t) {
  const tools = t.trace.filter((x) => x.kind === 'tool');
  const ms = wallClockMs(tools);
  const t0 = Date.parse(t.createdAt);
  const viaMcp = tools.some((x) => /over MCP/.test(x.summary || ''));
  $('console-sum').innerHTML = [
    `${tools.length} tool calls`,
    `${(ms / 1000).toFixed(1)} s in tools`,
    `${t.unitsUsed} units this return`,
    `renders ${t.rendersUsed}/${t.maxRenders}`,
    t.mode === 'live' ? (viaMcp ? 'YouCam over MCP' : `YouCam ${t.transport === 'mcp' ? 'MCP (REST fallback)' : 'REST'}`) : 'mock: no API calls',
    t.hasPhoto ? 'photo in memory' : t.status === 'active' ? 'no photo yet' : 'photo deleted',
  ]
    .map((s) => `<span>${esc(s)}</span>`)
    .join('');
  const list = $('console-list');
  // Append only what is new, so the list doesn't flicker while it follows the session.
  if (t.trace.length < consoleState.seen) {
    list.innerHTML = '';
    consoleState.seen = 0;
  }
  const fresh = t.trace.slice(consoleState.seen).map((x, k) => traceItem(x, consoleState.seen + k, t0, consoleState.seen > 0));
  if (fresh.length) {
    list.insertAdjacentHTML('beforeend', fresh.join(''));
    consoleState.seen = t.trace.length;
    const box = $('console');
    box.scrollTop = box.scrollHeight;
  }
  const name = t.returned ? t.returned.name : 'return';
  $('ws-session').innerHTML = `<span class="id">${esc(t.id.slice(0, 8))}</span> ${esc(name)} · <b>${esc(STEP_LABEL[t.step] ?? t.step)}</b>${t.outcome ? ` · ${esc(t.outcome)}` : ''}${t.profileKey ? ` · ${esc(t.profileKey.replace('-', ' · '))}` : ''}`;
}

// ---------- autopilot controls ----------
const apButtons = [...document.querySelectorAll('[data-flow]')];
const apStop = $('ap-stop');
function setRunning(running) {
  apButtons.forEach((b) => (b.disabled = running));
  apStop.disabled = !running;
}
function sendToApp(msg) {
  frame.contentWindow?.postMessage({ source: 'mirrormatch-workspace', ...msg }, location.origin);
}
apButtons.forEach((b) =>
  b.addEventListener('click', () => {
    setRunning(true);
    $('ap-caption').textContent = `Starting the ${b.dataset.flow} return…`;
    sendToApp({ type: 'autopilot-start', flow: b.dataset.flow });
  }),
);
apStop.addEventListener('click', () => sendToApp({ type: 'autopilot-stop' }));

window.addEventListener('message', (e) => {
  if (e.origin !== location.origin || e.source !== frame.contentWindow) return;
  const m = e.data;
  if (!m || m.source !== 'mirrormatch-app') return;
  if (m.type === 'session') follow(m.id);
  if (m.type === 'autopilot') {
    $('ap-caption').textContent = m.status === 'running' && m.step ? `Step ${m.step} of ${m.total}: ${m.caption}` : m.caption;
    setRunning(m.status === 'running');
  }
});

// ---------- merchant strip ----------
let productNames = {};
async function loadMerchant() {
  const s = await getJson('/api/merchant/summary');
  for (const p of [...s.live.products, ...s.synthetic.products]) productNames[p.id] = p;
  const k = s.live.kpis;
  const rate = k.exchangeRate == null ? '–' : `${Math.round(k.exchangeRate * 100)}%`;
  $('ws-kpis').innerHTML = [
    ['Returns', k.returnsStarted],
    ['Exchanges', k.exchanges],
    ['Refund value kept', money(k.refundValueRetained)],
    ['Exchange rate', rate],
  ]
    .map(([label, value]) => `<div class="kpi"><div class="label">${esc(label)}</div><div class="value">${esc(value)}</div></div>`)
    .join('');
  renderFeed(s.live.recent.slice(0, 5));
}

function feedItem(e) {
  const t = new Date(e.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const p = productNames[e.productId];
  let detail = p ? p.name : e.productId ?? '';
  if (e.type === 'exchange_created' && productNames[e.toProductId]) detail = `${p?.shadeName ?? ''} → ${productNames[e.toProductId].shadeName} · ${money(e.value)} kept`;
  if (e.type === 'tone_analyzed' && e.profileKey) detail += ` · ${String(e.profileKey).replace('-', ' · ')}`;
  if (e.type.startsWith('suggestion_')) detail = String(e.suggestionId ?? '').replace(/^(shade|note):/, '').replaceAll(':', ' · ');
  return `<li><time datetime="${esc(e.at)}">${esc(t)}</time><div><span class="t">${esc(EVENT_LABEL[e.type] ?? e.type)}</span><div class="muted small">${esc(detail)}</div></div></li>`;
}
function renderFeed(list) {
  $('ws-feed').innerHTML = list.length ? list.map(feedItem).join('') : '<li class="empty" style="display:block">Waiting for the first return…</li>';
}

async function loadSuggestions() {
  const j = await getJson('/api/merchant/suggestions');
  const open = j.suggestions.filter((s) => !s.decision);
  const shades = open.filter((s) => s.kind === 'shade');
  const notes = open.filter((s) => s.kind === 'note');
  const synth = notes.filter((s) => s.synthetic).length;
  const top = [...shades.slice(0, 2), ...notes.slice(0, 1)];
  $('ws-suggestions').innerHTML = `
    <p class="small" style="margin:0 0 8px">${shades.length} proposed ${shades.length === 1 ? 'shade' : 'shades'} · ${notes.length} fit ${notes.length === 1 ? 'note' : 'notes'}${synth ? ` (${synth} from <span class="ws-synth">synthetic demo data</span>)` : ''} · drafted by deterministic code${j.llm ? ', reworded by the LLM' : ''}</p>
    <ul class="ws-sugg-list">
      ${top
        .map(
          (s) => `<li><span class="swatch" style="background:${esc(s.hex)}" aria-hidden="true"></span><span>${s.kind === 'shade' ? `<b>New shade</b> ${esc(s.hex)} for ${esc(s.profileLabel.toLowerCase())}` : `<b>Fit note</b> ${esc(s.shadeName)} · ${esc(s.profileLabel.toLowerCase())}${s.synthetic ? ' <span class="ws-synth">synthetic</span>' : ''}`}</span></li>`,
        )
        .join('')}
    </ul>
    <a class="small" href="/merchant#suggestions" target="_blank" rel="noopener">Review and approve in the dashboard ↗</a>`;
}

let reloadTimer = null;
function connectStream() {
  const es = new EventSource('/api/merchant/stream');
  es.onmessage = () => {
    clearTimeout(reloadTimer);
    reloadTimer = setTimeout(() => {
      loadMerchant().catch(() => {});
      loadSuggestions().catch(() => {});
      loadEnv().catch(() => {});
    }, 500);
  };
}

// ---------- environment ----------
async function loadEnv() {
  const [h, env] = await Promise.all([getJson('/api/health'), getJson('/api/workspace/env')]);
  const live = h.mode === 'live';
  const chip = $('mode-chip');
  chip.hidden = false;
  chip.className = `chip ${live ? 'live' : 'mock'}`;
  chip.innerHTML = `<span class="dot"></span>${live ? 'Live YouCam API' : 'Mock mode'}`;
  const u = h.units ?? {};
  const cap = h.limits?.dailyUnitCap ? `${u.spentToday ?? 0} of ${h.limits.dailyUnitCap} today` : `${u.spentToday ?? 0} today · no daily cap set`;
  const transport = !live ? 'no API calls, placeholder previews' : h.transport === 'mcp' ? "YouCam's MCP servers (REST fallback)" : 'REST task endpoints';
  const cost = (f) => u.costs?.[f] ?? '–';
  const rows = [
    ['YouCam', `${live ? 'Live' : 'Mock'} · ${transport}`, live ? 'ok' : 'warn'],
    ['Units', `${u.balance ?? '–'} left · ${cap}`, ''],
    ['Unit costs', `skin tone ${cost('skin-tone-analysis')} · makeup try-on ${cost('makeup-vto')} · clothes try-on ${cost('cloth-v4')} (floor ${h.limits?.unitFloor ?? '–'})`, ''],
    ['Demo cache', h.demoCache ? 'On: repeat sample runs cost 0 units' : 'Off: nothing personal is written to disk', h.demoCache ? 'ok' : ''],
    ['LLM', env.llm?.enabled ? `On (${h.llm?.model ?? 'configured'}): wording only, optional` : 'Off: templated text (optional, never required)', ''],
    ['Returns portal', `<code>${esc(env.webhook.method)} ${esc(env.webhook.path)}</code>${env.webhook.secretRequired ? ' · shared secret required' : ' · no secret set'}`, ''],
    ['Sample model', `face: ${esc(env.samples.face)} · body: ${esc(env.samples.body)} (YouCam official images)`, ''],
  ];
  $('ws-env').innerHTML = rows
    .map(([k, v, cls]) => `<div class="${cls}"><dt>${esc(k)}</dt><dd>${k === 'Returns portal' ? v : esc(v)}</dd></div>`)
    .join('');
  $('ws-privacy').innerHTML = env.privacy.guarantees.map((g) => `<li>${esc(g)}</li>`).join('');
}

loadEnv().catch(() => {
  $('ws-env').innerHTML = '<div><dt>Server</dt><dd>Not reachable</dd></div>';
});
loadMerchant().catch(() => renderFeed([]));
loadSuggestions().catch(() => {
  $('ws-suggestions').innerHTML = '<p class="muted small">Suggestions unavailable.</p>';
});
connectStream();
setInterval(() => loadEnv().catch(() => {}), 15000);
