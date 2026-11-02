// MirrorMatch workspace: four tabs, one thing on screen at a time.
//   Try it      · pick a return; the shopper app plays it in the phone (autopilot via postMessage)
//   Agent steps · every tool call and decision for the session in the phone, as it happens
//   Store view  · live merchant numbers, events and the agent's suggestions
//   Setup       · what is connected, and the privacy guarantees
// Read-only views of existing endpoints, plus the autopilot controls.
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
// Plain words for each agent tool, so the steps read like a story, not a log.
const TOOL_LABEL = {
  get_order: 'Looked up the order',
  check_photo_quality: 'Checked the photo is usable',
  analyze_skin_tone: 'Measured skin tone with YouCam',
  analyze_skin: 'Read the skin with YouCam Skin Analysis',
  find_alternatives: 'Ranked in-stock shades by colour science',
  check_stock_and_policy: 'Checked stock and the exchange policy',
  render_tryon: 'Rendered a try-on with YouCam',
  render_look: 'Rendered the complete look with YouCam',
  pair_lip_with_dress: 'Picked a lipstick for the dress',
  pair_blush_with_lip: 'Picked a blush for the lipstick',
  create_exchange: 'Created the exchange',
  escalate_to_human: 'Handed the return to a person',
  'llm.reword': 'Worded the reply',
};
const toolLabel = (tool) => TOOL_LABEL[tool] ?? String(tool ?? '').replaceAll('_', ' ');

// ---------- tabs ----------
const tabs = [...document.querySelectorAll('[role="tab"]')];
const TAB_IDS = tabs.map((t) => t.id.replace('tab-', ''));
const unseen = { agent: 0, store: 0 };
let current = 'try';

function badge(name) {
  const el = $(`count-${name}`);
  if (!el) return;
  el.hidden = !unseen[name];
  el.textContent = unseen[name] > 99 ? '99+' : String(unseen[name]);
  const tab = $(`tab-${name}`);
  const base = tab.firstChild.textContent;
  tab.setAttribute('aria-label', unseen[name] ? `${base}, ${unseen[name]} new` : base);
}

function select(name, { focus = false, updateHash = true } = {}) {
  if (!TAB_IDS.includes(name)) name = 'try';
  current = name;
  for (const t of tabs) {
    const on = t.id === `tab-${name}`;
    t.setAttribute('aria-selected', String(on));
    t.tabIndex = on ? 0 : -1;
    $(t.getAttribute('aria-controls')).hidden = !on;
    if (on && focus) t.focus();
  }
  if (name in unseen) {
    unseen[name] = 0;
    badge(name);
  }
  if (updateHash) history.replaceState(null, '', name === 'try' ? location.pathname + location.search : `#${name}`);
  if (name === 'agent') followLatest();
}

/** Keep the newest step in view inside the steps box (the page itself doesn't move). */
function followLatest() {
  const box = $('console');
  box.scrollTop = box.scrollHeight;
}

tabs.forEach((t, i) => {
  t.addEventListener('click', () => select(TAB_IDS[i]));
  t.addEventListener('keydown', (e) => {
    const k = { ArrowRight: 1, ArrowLeft: -1, Home: -Infinity, End: Infinity }[e.key];
    if (k === undefined) return;
    e.preventDefault();
    const n = k === -Infinity ? 0 : k === Infinity ? tabs.length - 1 : (i + k + tabs.length) % tabs.length;
    select(TAB_IDS[n], { focus: true });
  });
});
document.addEventListener('click', (e) => {
  const go = e.target.closest('[data-goto]');
  if (go) select(go.dataset.goto, { focus: true });
});
window.addEventListener('hashchange', () => select(location.hash.slice(1), { updateHash: false }));
select(location.hash.slice(1), { updateHash: false });

// ---------- agent steps ----------
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
  // Back on the orders page: keep the last return's trace on screen until a new one starts.
  if (!id || id === consoleState.id) return;
  clearTimeout(consoleState.timer);
  Object.assign(consoleState, { id, trace: null, seen: 0, endedPolls: 0 });
  $('console-list').innerHTML = '';
  $('console-sum').innerHTML = '';
  $('console-empty').hidden = true;
  $('recent').innerHTML = '';
  poll();
}

async function poll() {
  const id = consoleState.id;
  if (!id) return;
  let t;
  try {
    const r = await fetch(`/api/trace/${encodeURIComponent(id)}`);
    if (r.status === 404) {
      if (id === consoleState.id) $('ws-session').textContent = 'That return is no longer on this server.';
      return;
    }
    if (!r.ok) throw new Error(String(r.status));
    t = await r.json();
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

const secs = (ms) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${ms} ms`);
const unitsText = (n) => `${n} ${Number(n) === 1 ? 'unit' : 'units'}`;

function traceItem(t, i, t0, isNew) {
  const at = Date.parse(t.at);
  const rel = Number.isFinite(at) ? `+${((at - t0) / 1000).toFixed(1)} s` : '';
  const cls = isNew ? ' new' : '';
  if (t.kind === 'decision') return `<li class="decision${cls}"><span class="n" aria-hidden="true">→</span><span class="s"><span class="sr-only">Decision: </span>${esc(t.summary)}</span><span class="meta">${rel}</span></li>`;
  if (t.kind === 'cleanup') return `<li class="decision cleanup${cls}"><span class="n" aria-hidden="true">✓</span><span class="s"><span class="sr-only">Clean-up: </span>${esc(t.summary)}</span><span class="meta">${rel}</span></li>`;
  const over = /over MCP/.test(t.summary || '') ? ' · MCP' : '';
  // A kept template (LLM off or slow) is normal, not a failure.
  const failed = !t.ok && t.kind !== 'llm';
  return `<li class="${failed ? 'fail' : ''}${t.kind === 'llm' ? ' llm' : ''}${cls}"><span class="n">${i + 1}</span><span class="s"><span class="label">${esc(toolLabel(t.tool))}<span class="tool" translate="no">${esc(t.tool)}</span></span><span class="detail">${esc(t.summary)}</span></span><span class="meta">${rel} · ${esc(secs(t.ms || 0))}${t.units ? ` · ${esc(unitsText(t.units))}` : ''}${t.cached ? ' · replay' : ''}${over}</span></li>`;
}

function renderRecent(t) {
  const tools = t.trace.filter((x) => x.kind === 'tool' && x.kind !== 'llm' && x.tool !== 'llm.reword');
  const last = tools.slice(-3).reverse();
  $('recent-wrap').hidden = !last.length;
  const before = $('recent').dataset.key;
  const key = last.map((x) => `${x.at}|${x.tool}`).join(',');
  if (before === key) return;
  $('recent').dataset.key = key;
  $('recent').innerHTML = last
    .map((x, k) => `<li class="${k === 0 && before ? 'new' : ''}"><span class="tick" aria-hidden="true">${x.ok ? '✓' : '!'}</span><span>${esc(toolLabel(x.tool))}</span><span class="when">${esc(secs(x.ms || 0))}${x.units ? ` · ${esc(unitsText(x.units))}` : ''}</span></li>`)
    .join('');
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
    const newTools = t.trace.slice(consoleState.seen).filter((x) => x.kind === 'tool').length;
    list.insertAdjacentHTML('beforeend', fresh.join(''));
    consoleState.seen = t.trace.length;
    if (current === 'agent') followLatest();
    else if (newTools) {
      unseen.agent += newTools;
      badge('agent');
    }
  }
  renderRecent(t);
  const name = t.returned ? t.returned.name : 'return';
  $('ws-session').innerHTML = `<span class="id">${esc(t.id.slice(0, 8))}</span> ${esc(name)} · <b>${esc(STEP_LABEL[t.step] ?? t.step)}</b>${t.outcome ? ` · ${esc(t.outcome)}` : ''}${t.profileKey ? ` · ${esc(t.profileKey.replace('-', ' · '))}` : ''}`;
}

// ---------- Try it: autopilot controls ----------
const picks = [...document.querySelectorAll('[data-flow]')];
const apStop = $('ap-stop');
const run = $('run');
let activeFlow = null;
function setRunning(running, flow = activeFlow) {
  activeFlow = running ? flow : null;
  picks.forEach((b) => {
    b.disabled = running;
    b.setAttribute('aria-pressed', String(running && b.dataset.flow === flow));
  });
  apStop.disabled = !running;
}
function setMeter(step, total, state) {
  const pct = total ? Math.round((Math.min(step, total) / total) * 100) : 0;
  $('meter-fill').style.transform = `scaleX(${(state === 'done' ? 100 : pct) / 100})`;
  const m = $('meter');
  m.setAttribute('aria-valuemax', String(total || 12));
  m.setAttribute('aria-valuenow', String(state === 'done' ? total || 12 : step || 0));
  run.dataset.state = state;
}
function sendToApp(msg) {
  frame.contentWindow?.postMessage({ source: 'mirrormatch-workspace', ...msg }, location.origin);
}
let heardFromAutopilot = false;
let watchdog = null;
picks.forEach((b) =>
  b.addEventListener('click', () => {
    const label = b.querySelector('.pick-name').textContent.toLowerCase();
    setRunning(true, b.dataset.flow);
    heardFromAutopilot = false;
    $('run-step').textContent = 'Starting…';
    setMeter(0, 12, 'running');
    $('ap-caption').textContent = `Starting the ${label} return…`;
    sendToApp({ type: 'autopilot-start', flow: b.dataset.flow });
    // If the phone app hasn't loaded yet, the message is lost: hand the buttons back.
    clearTimeout(watchdog);
    watchdog = setTimeout(() => {
      if (heardFromAutopilot) return;
      setRunning(false);
      setMeter(0, 12, 'idle');
      $('run-step').textContent = 'Ready when you are';
      $('ap-caption').textContent = 'The app in the phone is still loading. Please try again in a moment.';
    }, 4000);
  }),
);
apStop.addEventListener('click', () => sendToApp({ type: 'autopilot-stop' }));

window.addEventListener('message', (e) => {
  if (e.origin !== location.origin || e.source !== frame.contentWindow) return;
  const m = e.data;
  if (!m || m.source !== 'mirrormatch-app') return;
  if (m.type === 'session') follow(m.id);
  if (m.type === 'autopilot') {
    heardFromAutopilot = true;
    const running = m.status === 'running';
    const done = m.status === 'done';
    $('ap-caption').textContent = m.caption;
    $('run-step').textContent = running ? (m.step ? `Step ${m.step} of ${m.total}` : 'Starting…') : done ? 'Done' : 'Stopped · your turn';
    setMeter(m.step || 0, m.total || 12, running ? 'running' : done ? 'done' : 'idle');
    setRunning(running, m.flow ?? activeFlow);
  }
});

// Real product pictures and names for the four picks, from the demo store's orders.
getJson('/api/orders')
  .then(({ orders }) => {
    for (const b of picks) {
      const o = orders.find((x) => x.id === b.dataset.order);
      const p = o?.lines?.[0]?.product;
      if (!p) continue;
      const img = b.querySelector('img');
      if (p.image) img.src = p.image;
      b.title = `${p.productLine} · ${p.shadeName}`;
    }
  })
  .catch(() => {});

// ---------- Store view ----------
let productNames = {};
let lastEventKey = null;
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
  const recent = s.live.recent.slice(0, 8);
  const key = recent[0] ? `${recent[0].at}|${recent[0].type}` : '';
  if (lastEventKey !== null && key !== lastEventKey && current !== 'store') {
    const i = s.live.recent.findIndex((e) => `${e.at}|${e.type}` === lastEventKey);
    unseen.store += i < 0 ? 1 : i;
    badge('store');
  }
  lastEventKey = key;
  renderFeed(recent);
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
  const top = [...shades.slice(0, 2), ...notes.slice(0, 2)];
  $('ws-suggestions').innerHTML = `
    <p class="muted small" style="margin:0">${shades.length} proposed ${shades.length === 1 ? 'shade' : 'shades'} and ${notes.length} product-page ${notes.length === 1 ? 'note' : 'notes'}${synth ? ` (${synth} from synthetic demo data)` : ''}, drafted by plain code${j.llm ? ' and reworded by the LLM' : ''}. Nothing is published until a person approves.</p>
    <ul class="ws-sugg-list">
      ${top
        .map(
          (s) => `<li><span class="swatch" style="background:${esc(s.hex)}" aria-hidden="true"></span><span>${s.kind === 'shade' ? `<b>New shade</b> for ${esc(s.profileLabel.toLowerCase())}` : `<b>Fit note</b> on ${esc(s.shadeName)} · ${esc(s.profileLabel.toLowerCase())}${s.synthetic ? ' <span class="ws-synth">synthetic</span>' : ''}`}</span></li>`,
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

// ---------- Setup ----------
async function loadEnv() {
  const [h, env] = await Promise.all([getJson('/api/health'), getJson('/api/workspace/env')]);
  const live = h.mode === 'live';
  const chip = $('mode-chip');
  chip.hidden = false;
  chip.className = `chip ${live ? 'live' : 'mock'}`;
  chip.innerHTML = `<span class="dot"></span>${live ? 'Live YouCam API' : 'Mock mode'}`;
  const u = h.units ?? {};
  const cap = h.limits?.dailyUnitCap ? `${u.spentToday ?? 0} of ${h.limits.dailyUnitCap} used today` : `${u.spentToday ?? 0} used today · no daily cap set`;
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
