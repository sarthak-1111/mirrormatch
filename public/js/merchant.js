// Merchant dashboard: live KPIs from demo sessions (SSE), a product × tone-profile heatmap,
// insight cards, agent traces and the YouCam unit budget. Synthetic history is rendered
// in its own clearly-labelled section and never mixed into live numbers.
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const money = (n) => `$${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const $ = (id) => document.getElementById(id);

const EVENT_LABEL = {
  return_started: 'Return started',
  mirrormatch_offered: 'MirrorMatch offered',
  mirrormatch_accepted: 'Shopper tried MirrorMatch',
  mirrormatch_declined: 'Shopper went straight to refund',
  photo_retake: 'Photo retake requested',
  tone_analyzed: 'Skin tone analysed',
  renders_done: 'Try-on previews ready',
  exchange_created: 'Exchange created',
  refund_chosen: 'Refund chosen',
  escalated: 'Escalated to a specialist',
};

let summary = null;
let products = {};

async function load() {
  const [s, traces] = await Promise.all([fetch('/api/merchant/summary').then((r) => r.json()), fetch('/api/merchant/traces').then((r) => r.json())]);
  summary = s;
  for (const p of [...s.live.products, ...s.synthetic.products]) products[p.id] = p;
  renderChips(s);
  renderKpis(s.live.kpis);
  $('live-heat').innerHTML = Object.keys(s.live.heat).length
    ? heatTable(s.live.heat, s.profileKeys, s.live.products, 'Live returns')
    : '<div class="empty">No analysed returns yet. Run a return in the shopper view and it appears here.</div>';
  $('live-insights').innerHTML = s.live.insights.map(insightCard).join('');
  renderFeed(s.live.recent);
  $('synth-disclaimer').textContent = s.synthetic.disclaimer;
  $('synth-sub').textContent = `${s.synthetic.returns} simulated colour-related returns. Illustrative only; not real customers or results.`;
  $('synth-heat').innerHTML = heatTable(s.synthetic.heat, s.profileKeys, s.synthetic.products, 'Synthetic returns', 10);
  $('synth-insights').innerHTML = s.synthetic.insights.map(insightCard).join('');
  renderTraces(traces);
  renderUnits(s.units, s.mode);
  loadFit().catch(() => {}); // live escalations and stock can change the gap cards
}

function renderChips(s) {
  const mode = $('mode-chip');
  mode.className = `chip ${s.mode === 'live' ? 'live' : 'mock'}`;
  mode.innerHTML = `<span class="dot"></span>${s.mode === 'live' ? 'Live YouCam API' : 'Mock mode'}`;
  $('units-chip').textContent = s.units.balance == null ? 'Units: n/a' : `${s.units.balance} units left`;
}

function renderKpis(k) {
  const rate = k.exchangeRate == null ? '–' : `${Math.round(k.exchangeRate * 100)}%`;
  $('kpis').innerHTML = [
    ['Returns started', k.returnsStarted, `${k.mirrorMatchOffered} colour-related`],
    ['Tried MirrorMatch', k.mirrorMatchAccepted, `of ${k.mirrorMatchOffered} offered`],
    ['Exchanges accepted', k.exchanges, `${k.refunds} refunds · ${k.escalations} escalated`],
    ['Refund value retained', money(k.refundValueRetained), `${money(k.refundValuePaid)} refunded`, 'accent'],
    ['Exchange rate', rate, 'exchanges ÷ (exchanges + refunds)'],
  ]
    .map(([label, value, sub, cls]) => `<div class="kpi ${cls ?? ''}"><div class="label">${esc(label)}</div><div class="value">${esc(value)}</div><div class="sub">${esc(sub)}</div></div>`)
    .join('');
}

function ramp(t) {
  // sequential ramp: #f3ece5 → #e7a68f → #b4533f → #6e2618
  const stops = [[243, 236, 229], [231, 166, 143], [180, 83, 63], [110, 38, 24]];
  const x = Math.max(0, Math.min(1, t)) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(x));
  const f = x - i;
  const c = stops[i].map((v, j) => Math.round(v + (stops[i + 1][j] - v) * f));
  return { bg: `rgb(${c.join(',')})`, fg: t > 0.55 ? '#fff' : '#231e1b' };
}

function heatTable(heat, keys, prods, caption, maxRows = 12) {
  const rows = prods
    .map((p) => ({ p, total: Object.values(heat[p.id] ?? {}).reduce((a, b) => a + b, 0) }))
    .sort((a, b) => b.total - a.total)
    .slice(0, maxRows);
  const max = Math.max(1, ...rows.flatMap((r) => keys.map((k) => heat[r.p.id]?.[k.key] ?? 0)));
  const groups = ['light', 'medium', 'deep'];
  return `
    <div class="heat-wrap">
      <table class="heat">
        <caption class="sr-only">${esc(caption)}: number of returns per product and tone profile</caption>
        <thead>
          <tr><th></th>${groups.map((g) => `<th colspan="3" scope="colgroup">${g[0].toUpperCase() + g.slice(1)} depth</th>`).join('')}<th></th></tr>
          <tr><th scope="col" style="text-align:left">Product</th>${keys.map((k) => `<th scope="col">${esc(k.key.split('-')[1])}</th>`).join('')}<th scope="col">Total</th></tr>
        </thead>
        <tbody>
          ${rows
            .map(
              ({ p, total }) => `
            <tr>
              <th scope="row" class="prod"><span class="swatch" style="background:${esc(p.hex)}"></span>${esc(p.name)}</th>
              ${keys
                .map((k) => {
                  const n = heat[p.id]?.[k.key] ?? 0;
                  const c = ramp(n / max);
                  return `<td class="${n ? '' : 'zero'}" style="background:${n ? c.bg : '#f8f4ef'};color:${n ? c.fg : ''}" aria-label="${esc(p.shadeName)}, ${esc(k.label)}: ${n} returns">${n}</td>`;
                })
                .join('')}
              <td><b>${total}</b></td>
            </tr>`,
            )
            .join('')}
        </tbody>
      </table>
    </div>
    <div class="legend"><span>fewer</span><span class="ramp" aria-hidden="true"></span><span>more returns</span></div>`;
}

function insightCard(i) {
  const from = products[i.productId];
  const to = i.recommendId ? summary && [...summary.live.products, ...summary.synthetic.products].find((p) => p.id === i.recommendId) : null;
  return `
    <div class="insight">
      <div class="ico" aria-hidden="true">i</div>
      <div>
        <div>${esc(i.text)}</div>
        <div class="swatches">
          ${from ? `<span class="swatch" style="background:${esc(from.hex)}" title="${esc(from.shadeName)}"></span>${esc(from.shadeName)}` : ''}
          ${i.recommendName ? ` → <span class="swatch" style="background:${esc(to?.hex ?? '#ccc')}"></span>${esc(i.recommendName)}` : ''}
          <span>· ${esc(i.share)}% of this product's returns</span>
        </div>
      </div>
    </div>`;
}

function feedItem(e, isNew = false) {
  const t = new Date(e.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const p = products[e.productId];
  let detail = p ? `${p.name}` : e.productId ?? '';
  if (e.type === 'exchange_created' && products[e.toProductId]) detail = `${p?.shadeName ?? ''} → ${products[e.toProductId].shadeName} · ${money(e.value)} kept`;
  if (e.type === 'tone_analyzed') detail += ` · ${String(e.profileKey).replace('-', ' · ')}`;
  if (e.type === 'refund_chosen') detail += ` · ${money(e.value)}`;
  return `<li class="${isNew ? 'new' : ''}"><time datetime="${esc(e.at)}">${esc(t)}</time><div><span class="t">${esc(EVENT_LABEL[e.type] ?? e.type)}</span><div class="muted small">${esc(detail)}</div></div></li>`;
}

function renderFeed(list) {
  $('feed').innerHTML = list.length ? list.map((e) => feedItem(e)).join('') : '<li class="empty" style="display:block">Waiting for the first return…</li>';
}

// Wall-clock time inside tool calls: parallel previews overlap, so merge their intervals.
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

function renderTraces(traces) {
  if (!traces.length) {
    $('traces').innerHTML = '<div class="empty">No sessions yet on this server.</div>';
    return;
  }
  $('traces').innerHTML = traces
    .map((s, idx) => {
      const tools = s.trace.filter((t) => t.kind === 'tool');
      const ms = wallClockMs(tools);
      return `
      <details ${idx === 0 ? 'open' : ''}>
        <summary><span class="id">${esc(s.id)}</span><b>${esc(products[s.returnedId]?.name ?? s.returnedId)}</b><span class="chip">${esc(s.outcome ?? s.step)}</span><span class="chip">${tools.length} tools · ${(ms / 1000).toFixed(1)} s in tools · ${s.unitsUsed} units</span>${s.profileKey ? `<span class="chip">${esc(s.profileKey.replace('-', ' · '))}</span>` : ''}</summary>
        <div class="trace-panel"><ol class="trace-list">
          ${s.trace
            .map((t, i) =>
              t.kind === 'tool' || t.kind === 'llm'
                ? `<li class="${t.ok ? '' : 'fail'}"><span class="n">${i + 1}</span><span><span class="tool">${esc(t.tool)}</span> <span class="s">${esc(t.summary)}</span></span><span class="meta">${t.ms} ms${t.units ? ` · ${t.units}u` : ''}${t.cached ? ' · cache' : ''}</span></li>`
                : `<li class="decision"><span class="n">${t.kind === 'cleanup' ? '🗑' : '→'}</span><span class="s">${esc(t.summary)}</span><span></span></li>`,
            )
            .join('')}
        </ol></div>
      </details>`;
    })
    .join('');
}

function renderUnits(u, mode) {
  const rows = Object.entries(u.costs)
    .filter(([k]) => ['skin-tone-analysis', 'makeup-vto', 'cloth-v4', 'cloth', 'look-vto'].includes(k))
    .map(([k, v]) => `<tr><td><code>${esc(k)}</code></td><td class="num">${esc(v)}</td></tr>`)
    .join('');
  $('units').innerHTML = `
    <div class="kpis" style="margin-bottom:12px">
      <div class="kpi"><div class="label">Balance</div><div class="value">${u.balance ?? '–'}</div><div class="sub">${mode === 'live' ? 'from /s2s/v1.0/client/credit' : 'mock'}</div></div>
      <div class="kpi"><div class="label">At server start</div><div class="value">${u.startupBalance ?? '–'}</div><div class="sub">checked at startup</div></div>
      <div class="kpi"><div class="label">Spent this run</div><div class="value">${u.spentThisRun}</div><div class="sub">${u.calls} metered calls</div></div>
    </div>
    <table class="costs"><thead><tr><th>Feature</th><th>Units per call</th></tr></thead><tbody>${rows}</tbody></table>
    <p class="muted small">Costs source: ${esc(u.costSource === 'api' ? 'GET /s2s/v2.0/credit/feature-cost' : 'YouCam documentation')}. Units are charged only when a task succeeds. Max 3 try-on renders per return; renders and tone results are cached per session.</p>`;
}

// ---------- "Who is each shade for?" (catalogue × reference profiles; no customer data) ----------
const FIT_CATS = [
  ['lipstick', 'Lipstick'],
  ['foundation', 'Foundation'],
  ['dress', 'Dresses'],
];
const FIT_TEXT = { great: 'Great', good: 'Good', poor: '—' };
const GAP_KIND = {
  range: ['!', 'Gap in your range'],
  thin: ['1', 'Thin coverage'],
  live: ['L', 'Live escalations'],
  nofit: ['i', 'Note'],
};
let fitCategory = 'lipstick';

function renderFitTabs(counts = {}) {
  const host = $('fit-tabs');
  if (!host.childElementCount) {
    host.innerHTML = FIT_CATS.map(([key]) => `<button type="button" class="tab" data-cat="${key}"></button>`).join('');
    host.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-cat]');
      if (!b || b.dataset.cat === fitCategory) return;
      fitCategory = b.dataset.cat;
      loadFit();
    });
  }
  for (const b of host.querySelectorAll('button[data-cat]')) {
    const [, label] = FIT_CATS.find(([k]) => k === b.dataset.cat);
    const n = counts[b.dataset.cat] ?? 0;
    b.setAttribute('aria-pressed', String(b.dataset.cat === fitCategory));
    b.innerHTML = `${esc(label)}${n ? ` <span class="tab-badge" aria-label="${n} ${n === 1 ? 'gap' : 'gaps'}">${n}</span>` : ''}`;
  }
}

function fitTable(m) {
  const flagged = new Set(m.gaps.filter((g) => g.kind !== 'live').map((g) => g.profileKey));
  const groups = ['light', 'medium', 'deep'];
  return `
    <div class="heat-wrap">
      <table class="heat fit">
        <caption class="sr-only">Who each ${esc(m.category)} suits: fit per product and reference tone profile. ${esc(m.source)}.</caption>
        <thead>
          <tr><th></th>${groups.map((g) => `<th colspan="3" scope="colgroup">${g[0].toUpperCase() + g.slice(1)} depth</th>`).join('')}</tr>
          <tr><th scope="col" style="text-align:left">Product</th>${m.profiles
            .map((p) => `<th scope="col" class="${flagged.has(p.key) ? 'flag' : ''}"${flagged.has(p.key) ? ` title="${esc(p.label)}: see gaps and notes"` : ''}>${esc(p.key.split('-')[1])}${flagged.has(p.key) ? '<span class="flag-dot" aria-label=" (flagged)"></span>' : ''}</th>`)
            .join('')}</tr>
        </thead>
        <tbody>
          ${m.products
            .map(
              (p, i) => `
            <tr class="${p.inStock ? '' : 'soldout'}">
              <th scope="row" class="prod"><span class="swatch" style="background:${esc(p.hex)}"></span>${esc(p.shadeName)}${p.inStock ? '' : ' <span class="tag">Sold out</span>'}</th>
              ${m.cells[i]
                .map((c, j) => `<td class="fit-cell ${c.level}${flagged.has(m.profiles[j].key) ? ' flagcol' : ''}" aria-label="${esc(p.shadeName)}, ${esc(m.profiles[j].label)}: ${c.level === 'poor' ? 'not a strong fit' : `${c.level} fit`}">${FIT_TEXT[c.level]}</td>`)
                .join('')}
            </tr>`,
            )
            .join('')}
        </tbody>
      </table>
    </div>`;
}

function gapCard(g) {
  const [ico, label] = GAP_KIND[g.kind] ?? GAP_KIND.nofit;
  return `
    <div class="insight gap ${esc(g.kind)}">
      <div class="ico" aria-hidden="true">${esc(ico)}</div>
      <div>
        <div class="gap-kind">${esc(label)}${g.profileLabel ? ` · ${esc(g.profileLabel)}` : ''}${g.kind === 'live' || g.liveEscalations ? ' · <span class="live-tag">live</span>' : ''}</div>
        <div>${esc(g.text)}</div>
      </div>
    </div>`;
}

async function loadFit() {
  const cat = fitCategory;
  const m = await fetch(`/api/merchant/fit?category=${encodeURIComponent(cat)}`).then((r) => r.json());
  if (cat !== fitCategory) return; // a newer tab click won
  renderFitTabs(m.gapCounts);
  $('fit-source').textContent = m.source;
  $('fit-table').innerHTML = fitTable(m);
  const cards = [...m.gaps, ...m.notes];
  $('fit-gaps').innerHTML = cards.length
    ? cards.map(gapCard).join('')
    : `<div class="empty">Every reference profile has at least two good in-stock options in this category.</div>`;
}

let reloadTimer = null;
function connect() {
  const es = new EventSource('/api/merchant/stream');
  es.onmessage = (msg) => {
    const ev = JSON.parse(msg.data);
    const feed = $('feed');
    if (feed.querySelector('.empty')) feed.innerHTML = '';
    feed.insertAdjacentHTML('afterbegin', feedItem(ev, true));
    clearTimeout(reloadTimer);
    reloadTimer = setTimeout(load, 500);
  };
}

load().then(connect);
setInterval(load, 15000);
