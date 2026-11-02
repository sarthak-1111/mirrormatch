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
  suggestion_approved: 'Suggestion approved (logged only)',
  suggestion_dismissed: 'Suggestion dismissed',
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
  loadSuggestions().catch(() => {});
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
  // Sequential neutral ramp from the design tokens (surface-warm → border → muted → fg), so the
  // coral accent stays for actions. Text flips to white once the cell is dark enough.
  const stops = [[247, 247, 247], [221, 221, 221], [106, 106, 106], [34, 34, 34]];
  const x = Math.max(0, Math.min(1, t)) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(x));
  const f = x - i;
  const c = stops[i].map((v, j) => Math.round(v + (stops[i + 1][j] - v) * f));
  return { bg: `rgb(${c.join(',')})`, fg: t > 0.5 ? 'var(--on-dark)' : 'var(--fg)' };
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
                  return `<td class="${n ? '' : 'zero'}" style="${n ? `background:${c.bg};color:${c.fg}` : ''}" aria-label="${esc(p.shadeName)}, ${esc(k.label)}: ${n} returns">${n}</td>`;
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
          ${i.recommendName ? ` → <span class="swatch" style="background:${esc(to?.hex ?? 'var(--border)')}"></span>${esc(i.recommendName)}` : ''}
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
  if (e.type.startsWith('suggestion_')) detail = String(e.suggestionId ?? '').replace(/^(shade|note):/, '').replaceAll(':', ' · ');
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

// ---------- agent suggestions (deterministic drafts; approve/dismiss only log an event) ----------
const previewState = new Map(); // suggestion id -> { status, url?, cached?, units?, error? }
let suggSig = '';
let suggMeta = { mode: 'mock', previewLabel: 'Visual preview, not a guarantee' };

function labText(lab) {
  return `L* ${lab.L} · a* ${lab.a} · b* ${lab.b}`;
}

function decisionLine(s) {
  if (!s.decision) return '';
  const t = new Date(s.decision.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return `<p class="sugg-decided ${esc(s.decision.decision)}" role="status">${s.decision.decision === 'approved' ? 'Approved' : 'Dismissed'} at ${esc(t)} · logged as an event only</p>`;
}

function decisionButtons(s) {
  const d = s.decision?.decision;
  return `
    <div class="sugg-actions">
      <button type="button" class="btn small-btn" data-sugg="approved" data-id="${esc(s.id)}" ${d === 'approved' ? 'aria-pressed="true"' : 'aria-pressed="false"'}>Approve</button>
      <button type="button" class="btn secondary small-btn" data-sugg="dismissed" data-id="${esc(s.id)}" ${d === 'dismissed' ? 'aria-pressed="true"' : 'aria-pressed="false"'}>Dismiss</button>
    </div>`;
}

function previewBlock(s) {
  if (!s.previewable) return '<p class="muted small" style="margin:0">Clothes try-on needs a garment image, so a proposed colourway has no preview yet.</p>';
  const p = previewState.get(s.id);
  const mock = suggMeta.mode === 'mock';
  let inner = '';
  if (p?.status === 'loading') inner = '<div class="sugg-img skeleton" role="img" aria-label="Preview loading"></div>';
  if (p?.status === 'done') {
    inner = `
      <figure class="sugg-img">
        <img src="${esc(p.url)}" alt="YouCam's sample model wearing the proposed ${esc(s.category === 'foundation' ? 'foundation' : 'lipstick')} colour ${esc(s.hex)}" />
        ${mock ? `<div class="mock-tint" style="background:${esc(s.hex)}"></div>` : ''}
        <figcaption class="label-vp">${mock ? 'Mock preview · ' : ''}${esc(suggMeta.previewLabel)}</figcaption>
      </figure>
      <p class="muted small" style="margin:0">${p.cached ? 'From cache · 0 units' : `Rendered with makeup-vto · ${esc(p.units)} unit${p.units === 1 ? '' : 's'}`} · YouCam official sample image</p>`;
  }
  if (p?.status === 'error') inner = `<p class="small sugg-err" role="alert">${esc(p.error)}</p>`;
  return `
    ${inner}
    ${p?.status === 'done' ? '' : `<button type="button" class="btn secondary small-btn" data-preview="${esc(s.id)}" ${p?.status === 'loading' ? 'disabled' : ''}>Preview on the sample model</button>
    <p class="muted small" style="margin:0">Renders this exact colour on YouCam's sample model (1 unit, then cached). ${esc(suggMeta.previewLabel)}.</p>`}`;
}

function shadeCard(s) {
  return `
    <article class="card sugg shade ${s.decision?.decision === 'dismissed' ? 'dismissed' : ''}" aria-labelledby="t-${esc(s.id)}">
      <p class="sugg-kind"><span id="t-${esc(s.id)}">${esc(s.title)}</span> · ${esc(s.profileLabel)}${s.liveEscalations ? ' · <span class="live-tag">live escalations</span>' : ''}</p>
      <div class="sugg-colour">
        <span class="sugg-swatch" style="background:${esc(s.hex)}" role="img" aria-label="Proposed colour ${esc(s.hex)}"></span>
        <dl class="sugg-dl">
          <dt>Hex</dt><dd><code>${esc(s.hex)}</code></dd>
          <dt>CIELAB</dt><dd>${esc(labText(s.lab))}</dd>
          <dt>Matcher fit</dt><dd>${esc(s.fit.level)} for ${esc(s.profileLabel.toLowerCase())}${s.alsoFits.length ? `; also good for ${esc(s.alsoFits.map((a) => a.label.toLowerCase()).join(', '))}` : ''}</dd>
          ${s.nearest ? `<dt>Nearest now</dt><dd><span class="swatch" style="width:14px;height:14px;display:inline-block;vertical-align:-2px;border-width:1px;background:${esc(s.nearest.hex)}"></span> ${esc(s.nearest.shadeName)} · ΔE00 ${esc(s.nearest.deltaE)}</dd>` : ''}
        </dl>
      </div>
      <p class="sugg-text">${esc(s.text)}</p>
      <div class="sugg-preview">${previewBlock(s)}</div>
      ${decisionLine(s)}
      ${decisionButtons(s)}
    </article>`;
}

function noteCard(s) {
  const from = s.hex;
  return `
    <article class="card sugg note ${s.synthetic ? 'synth' : ''} ${s.decision?.decision === 'dismissed' ? 'dismissed' : ''}" aria-labelledby="t-${esc(s.id)}">
      <p class="sugg-kind"><span id="t-${esc(s.id)}">${esc(s.title)}</span> · ${esc(s.productName)}${s.synthetic ? ' <span class="synth-tag">Synthetic demo data</span>' : ' · <span class="live-tag">live</span>'}</p>
      <blockquote class="sugg-quote">${esc(s.note)}</blockquote>
      <div class="swatches small muted">
        <span class="swatch" style="background:${esc(from)}" aria-hidden="true"></span>${esc(s.shadeName)}
        ${s.recommendName ? ` → <span class="swatch" style="background:${esc(s.recommendHex ?? '#ccc')}" aria-hidden="true"></span>${esc(s.recommendName)} (${s.recommendBasis === 'live_exchanges' ? 'what shoppers chose' : "matcher's pick"})` : ''}
      </div>
      <p class="muted small" style="margin:0">${esc(s.basis)}${s.wording === 'llm' ? ' Reworded by the LLM (wording only).' : ''}</p>
      ${decisionLine(s)}
      ${decisionButtons(s)}
    </article>`;
}

function renderSuggestions(list) {
  const host = $('sugg-list');
  host.innerHTML = list.length
    ? list.map((s) => (s.kind === 'shade' ? shadeCard(s) : noteCard(s))).join('')
    : '<div class="empty">No suggestions right now: every reference profile has at least two good options, and no product stands out in returns.</div>';
}

let suggestions = [];
async function loadSuggestions(force = false) {
  const j = await fetch('/api/merchant/suggestions').then((r) => r.json());
  suggMeta = { mode: j.mode, previewLabel: j.previewLabel };
  $('sugg-llm').textContent = j.llm ? ' · wording by the optional LLM' : '';
  const sig = JSON.stringify(j.suggestions);
  if (!force && sig === suggSig) return; // unchanged: keep focus and previews as they are
  suggSig = sig;
  suggestions = j.suggestions;
  renderSuggestions(suggestions);
  const open = suggestions.filter((x) => !x.decision).length;
  const count = $('sugg-count');
  count.hidden = !open;
  count.textContent = String(open);
  $('mtab-suggestions').setAttribute('aria-label', open ? `Suggestions, ${open} open` : 'Suggestions');
}

function rerenderKeepingFocus(selector) {
  renderSuggestions(suggestions);
  if (selector) document.querySelector(selector)?.focus();
}

$('sugg-list').addEventListener('click', async (e) => {
  const dec = e.target.closest('button[data-sugg]');
  const pre = e.target.closest('button[data-preview]');
  if (dec) {
    const id = dec.dataset.id;
    const decision = dec.dataset.sugg;
    dec.disabled = true;
    try {
      const r = await fetch(`/api/merchant/suggestions/${encodeURIComponent(id)}/decision`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision }),
      });
      if (!r.ok) throw new Error();
      const j = await r.json();
      const s = suggestions.find((x) => x.id === id);
      if (s) s.decision = { decision, at: j.at };
      suggSig = JSON.stringify(suggestions);
      rerenderKeepingFocus(`button[data-sugg="${decision}"][data-id="${CSS.escape(id)}"]`);
    } catch {
      dec.disabled = false;
    }
  }
  if (pre) {
    const id = pre.dataset.preview;
    previewState.set(id, { status: 'loading' });
    rerenderKeepingFocus();
    try {
      const r = await fetch(`/api/merchant/suggestions/${encodeURIComponent(id)}/preview`, { method: 'POST' });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'The preview could not be rendered right now.');
      previewState.set(id, { status: 'done', url: j.url, cached: j.cached, units: j.units });
    } catch (err) {
      previewState.set(id, { status: 'error', error: err.message });
    }
    rerenderKeepingFocus();
  }
});

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

// ---------- tabs (hash-addressable: #overview, #fit, #suggestions, #history, #log) ----------
const tabs = [...document.querySelectorAll('.m-tabs [role="tab"]')];
const PANELS = tabs.map((t) => t.getAttribute('aria-controls'));
function select(name, { focus = false, updateHash = true } = {}) {
  if (!PANELS.includes(name)) name = 'overview';
  tabs.forEach((t, i) => {
    const on = PANELS[i] === name;
    t.setAttribute('aria-selected', String(on));
    t.tabIndex = on ? 0 : -1;
    $(PANELS[i]).hidden = !on;
    if (on && focus) t.focus();
  });
  if (updateHash) history.replaceState(null, '', name === 'overview' ? location.pathname : `#${name}`);
  window.scrollTo({ top: 0 });
}
tabs.forEach((t, i) => {
  t.addEventListener('click', () => select(PANELS[i]));
  t.addEventListener('keydown', (e) => {
    const k = { ArrowRight: 1, ArrowLeft: -1, Home: -Infinity, End: Infinity }[e.key];
    if (k === undefined) return;
    e.preventDefault();
    const n = k === -Infinity ? 0 : k === Infinity ? tabs.length - 1 : (i + k + tabs.length) % tabs.length;
    select(PANELS[n], { focus: true });
  });
});
window.addEventListener('hashchange', () => select(location.hash.slice(1), { updateHash: false }));
select(location.hash.slice(1), { updateHash: false });

load().then(connect);
setInterval(load, 15000);
