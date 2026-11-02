// SecondTry shopper flow (vanilla JS, no build step).
// All decisions come from the server-side agent; this file only renders its state.

const $app = document.getElementById('app');
const $trace = document.getElementById('trace');
const $sticky = document.getElementById('sticky');
const $layout = document.getElementById('layout');
const $traceToggle = document.getElementById('trace-toggle');
const $modeChip = document.getElementById('mode-chip');

const state = {
  health: null,
  orders: null,
  reasons: null,
  session: null,
  selected: null,
  captured: null, // { dataUrl, width, height, stats, hint }
  stream: null,
  polling: null,
  traceOpen: window.matchMedia('(min-width: 980px)').matches,
  busy: false,
};

// ---------- helpers ----------
const esc = (v) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const money = (n) => `$${Number(n).toFixed(2)}`;
const fmtDate = (iso) => new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });

async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(json.error || `Request failed (${res.status})`);
    err.code = json.code;
    err.guidance = json.guidance;
    throw err;
  }
  return json;
}

function toast(msg) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.setAttribute('role', 'status');
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3200);
}

function focusTitle() {
  const h = $app.querySelector('h1');
  if (h) {
    h.setAttribute('tabindex', '-1');
    h.focus({ preventScroll: false });
  }
  window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
}

function productThumb(p, cls = 'thumb') {
  return `<img class="${cls}" src="${esc(p.image)}" alt="${esc(p.productLine)} in ${esc(p.shadeName)}" width="64" height="84" />`;
}

function refundLink(label = 'Continue to refund') {
  return `<button class="btn ghost" data-action="refund-review">${esc(label)}</button>`;
}

// ---------- boot ----------
async function boot() {
  try {
    state.health = await api('GET', '/api/health');
    const live = state.health.mode === 'live';
    $modeChip.hidden = false;
    $modeChip.className = `chip ${live ? 'live' : 'mock'}`;
    $modeChip.innerHTML = `<span class="dot"></span>${live ? 'Live<span class="long">&nbsp;YouCam API</span>' : 'Mock<span class="long">&nbsp;mode · no API calls</span>'}`;
    $modeChip.title = live ? 'Calls the YouCam API from the server' : 'No YOUCAM_API_KEY set: previews are placeholders';
  } catch {
    /* health is informational */
  }
  const data = await api('GET', '/api/orders');
  state.orders = data.orders;
  state.reasons = data.reasons;
  window.addEventListener('hashchange', route);
  route();
}

async function route() {
  stopCamera();
  stopPolling();
  const hash = location.hash || '#/';
  if (hash.startsWith('#/return/')) {
    const id = hash.split('/')[2];
    if (!state.session || state.session.id !== id) {
      try {
        state.session = await api('GET', `/api/session/${id}`);
      } catch {
        location.hash = '#/';
        return;
      }
    }
    renderSession();
  } else {
    state.session = null;
    renderOrders();
  }
}

// ---------- views ----------
function renderOrders() {
  $sticky.hidden = true;
  $traceToggle.hidden = true;
  $trace.hidden = true;
  $layout.classList.remove('with-trace');
  const first = state.orders[0]?.customer?.firstName ?? 'there';
  $app.innerHTML = `
    <section class="stack-lg">
      <div>
        <p class="eyebrow">Your orders</p>
        <h1>Hi ${esc(first)}, need to return something?</h1>
        <p class="lede">Returns are free within 30 days of delivery.</p>
      </div>
      <ul class="stack" style="list-style:none;margin:0;padding:0">
        ${state.orders
          .map((o) =>
            o.lines
              .map(
                (l) => `
          <li class="card order">
            ${productThumb(l.product)}
            <div class="grow">
              <div class="meta">Order ${esc(o.id)} · delivered ${esc(fmtDate(o.deliveredOn))}</div>
              <div class="name">${esc(l.product.productLine)}</div>
              <div class="muted small">${esc(l.product.category === 'dress' ? 'Colour' : 'Shade')}: ${esc(l.product.shadeName)} · <span class="price">${money(l.price)}</span></div>
              <button class="btn secondary" style="margin-top:10px;min-height:40px;padding:8px 14px;font-size:14.5px" data-action="start-return" data-order="${esc(o.id)}" data-line="${esc(l.lineId)}">Start a return</button>
            </div>
          </li>`,
              )
              .join(''),
          )
          .join('')}
      </ul>
      <p class="footer-note">Hue &amp; Hem is a fictional demo store. <a href="/merchant">Merchant dashboard →</a></p>
    </section>`;
  focusTitle();
}

function renderSession() {
  const s = state.session;
  $traceToggle.hidden = false;
  renderTrace();
  const views = {
    reason: viewReason,
    offer: viewOffer,
    refund_review: viewRefundReview,
    consent: viewConsent,
    capture: viewCapture,
    matches: viewMatches,
    tryon: viewMatches,
    exchanged: viewExchanged,
    refunded: viewRefunded,
    escalated: viewEscalated,
  };
  (views[s.step] ?? viewReason)(s);
}

function returnedHeader(s) {
  const p = s.returned;
  return `
    <div class="row">
      ${productThumb(p, 'thumb sm')}
      <div class="grow">
        <div class="muted small">Returning · order ${esc(s.order.id)}</div>
        <div style="font-weight:600">${esc(p.productLine)}</div>
        <div class="muted small">${esc(p.shadeName)} · ${money(s.order.price)}</div>
      </div>
    </div>`;
}

function viewReason(s) {
  $sticky.hidden = true;
  const reasons = state.reasons;
  $app.innerHTML = `
    <section class="stack-lg">
      ${returnedHeader(s)}
      <form id="reason-form" class="stack">
        <fieldset>
          <legend><h1>${esc(s.copy.reasonPrompt)}</h1></legend>
          <div class="choices">
            ${Object.entries(reasons)
              .map(
                ([key, r], i) => `
              <div class="choice">
                <input type="radio" name="reason" id="r-${key}" value="${key}" ${i === 0 ? 'required' : ''} />
                <label for="r-${key}">${esc(r.label)}</label>
              </div>`,
              )
              .join('')}
          </div>
        </fieldset>
        <button class="btn block" type="submit">Continue</button>
      </form>
    </section>`;
  $app.querySelector('#reason-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const reason = new FormData(e.target).get('reason');
    if (!reason) return;
    await sendEvent('reason', { reason });
  });
  focusTitle();
}

function viewOffer(s) {
  $sticky.hidden = true;
  const noun = s.returned.category === 'dress' ? 'colour' : 'shade';
  $app.innerHTML = `
    <section class="stack-lg">
      ${returnedHeader(s)}
      <div class="hero-offer stack">
        <p class="timer">◷ About 30 seconds</p>
        <h1>See a better match on you before you decide?</h1>
        <p class="lede">We'll measure your skin tone from a selfie, find the right ${noun} in stock, and show it on your own photo.</p>
        <div class="steps-mini" aria-hidden="true">
          <div><b>1</b>Selfie</div><div><b>2</b>Your match</div><div><b>3</b>See it on you</div>
        </div>
      </div>
      <div class="btn-col">
        <button class="btn block accent" data-action="accept">Show me my match</button>
        <button class="btn block secondary" data-action="refund-review">No thanks, continue to refund</button>
      </div>
      <p class="muted small" style="text-align:center">Your refund stays one tap away at every step.</p>
    </section>`;
  focusTitle();
}

function viewRefundReview(s) {
  $sticky.hidden = true;
  $app.innerHTML = `
    <section class="stack-lg">
      ${returnedHeader(s)}
      <div class="stack">
        <h1>Refund ${money(s.order.price)}</h1>
        <p class="lede">${esc(s.copy.notEligible || 'We\'ll refund your original payment method as soon as you confirm.')}</p>
      </div>
      <div class="card flat stack">
        <dl class="kv"><dt>Refund to</dt><dd>Original payment method</dd><dt>Amount</dt><dd>${money(s.order.price)}</dd><dt>Timing</dt><dd>3–5 business days</dd></dl>
      </div>
      <div class="btn-col">
        <button class="btn block" data-action="refund">Confirm refund</button>
        ${s.reason && state.reasons[s.reason]?.secondTry && !s.profile ? '<button class="btn block secondary" data-action="back-offer">Back</button>' : ''}
      </div>
    </section>`;
  focusTitle();
}

function viewConsent(s) {
  $sticky.hidden = true;
  $app.innerHTML = `
    <section class="stack-lg">
      <div class="stack">
        <p class="eyebrow">Step 1 of 3 · Selfie</p>
        <h1>Before we take a photo</h1>
        <ul class="privacy">
          <li><b>Used only for this return:</b> to measure your skin tone and show previews.</li>
          <li><b>Deleted when this return ends</b>, from our server and from the YouCam processing service.</li>
          <li>Never used for marketing or to train models. You can delete it any time.</li>
        </ul>
      </div>
      <div class="btn-col">
        <button class="btn block accent" data-action="consent">I agree, continue</button>
        ${refundLink()}
      </div>
    </section>`;
  focusTitle();
}

function viewCapture(s) {
  $sticky.hidden = true;
  const body = s.returned.category === 'dress';
  const hasCamera = Boolean(navigator.mediaDevices?.getUserMedia) && window.isSecureContext;
  $app.innerHTML = `
    <section class="stack-lg">
      <div class="stack">
        <p class="eyebrow">Step 1 of 3 · ${body ? 'Photo' : 'Selfie'}</p>
        <h1>${body ? 'A photo from the waist up' : 'Take a quick selfie'}</h1>
        <p class="lede">${esc(s.copy.capture)}</p>
      </div>
      ${s.guidance ? `<div class="banner warn" role="alert"><span aria-hidden="true">↺</span><div><b>Let's try that again</b>${esc(s.guidance)}</div></div>` : ''}
      <div class="capture-box" id="capture-box">
        <div class="capture-empty" id="capture-empty">
          <div class="stack">
            <p style="margin:0">${body ? 'Prop your phone up or use a mirror: face the camera, waist up, arms relaxed.' : 'Face the camera in soft, even light.'}</p>
            ${hasCamera ? '<button class="btn accent" data-action="camera">Use camera</button>' : ''}
          </div>
        </div>
      </div>
      <div class="btn-col" id="capture-actions">
        <label class="btn block secondary" for="file-input" style="cursor:pointer">Upload a photo</label>
        <input id="file-input" type="file" accept="image/jpeg,image/png" capture="user" class="sr-only" />
        ${s.canEscalate ? '<button class="btn block secondary" data-action="escalate">Talk to a shade specialist</button>' : ''}
        ${refundLink()}
      </div>
    </section>`;
  $app.querySelector('#file-input').addEventListener('change', onFile);
  focusTitle();
}

function showCaptured() {
  const box = document.getElementById('capture-box');
  const actions = document.getElementById('capture-actions');
  stopCamera();
  box.innerHTML = `<img class="preview" src="${state.captured.dataUrl}" alt="Your photo preview" />`;
  actions.innerHTML = `
    <button class="btn block accent" data-action="submit-photo">Use this photo</button>
    <button class="btn block secondary" data-action="retake">Retake</button>
    ${refundLink()}`;
  actions.querySelector('[data-action="submit-photo"]').focus();
}

function viewProcessing(title, sub) {
  $sticky.hidden = true;
  $app.innerHTML = `
    <section class="processing" role="status">
      <div class="spinner" aria-hidden="true"></div>
      <h1 style="font-size:22px">${esc(title)}</h1>
      <p class="muted" style="margin:0">${esc(sub)}</p>
    </section>`;
}

function toneCard(s) {
  const p = s.profile;
  return `
    <div class="card stack">
      <div class="tone-card">
        <div class="swatch-xl" style="background:${esc(p.skinHex)}" role="img" aria-label="Your measured skin tone"></div>
        <div class="grow">
          <p class="eyebrow" style="margin:0">Your skin tone</p>
          <div class="pills"><span class="pill">${esc(cap(p.depthLabel))} depth</span><span class="pill">${esc(cap(p.undertone))} undertone</span>${p.lipHex ? `<span class="pill" style="display:inline-flex;gap:6px;align-items:center"><span class="swatch" style="width:14px;height:14px;background:${esc(p.lipHex)}"></span>Natural lip</span>` : ''}</div>
        </div>
      </div>
      <p style="margin:0">${esc(p.summary)}</p>
      <details class="how">
        <summary>How we measured this</summary>
        <p>YouCam's skin-tone analysis measured your skin, lip, eye and hair colours. We converted them to CIELAB and ranked in-stock options by colour distance (CIEDE2000) plus undertone rules. Measured on this photo only; lighting can shift results.</p>
      </details>
    </div>`;
}

const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : '');

function viewMatches(s) {
  const options = [
    { role: 'returned', product: s.returned, reason: s.matches?.returnedCaution || 'The one you bought.', badge: 'You returned' },
    ...s.picks.map((p, i) => ({ role: `pick${i + 1}`, product: p.product, reason: p.reason, deltaE: p.deltaE, badge: i === 0 ? 'Best match' : 'Also great', offer: p.offer })),
  ];
  if (!state.selected || !s.picks.some((p) => p.product.id === state.selected)) state.selected = s.picks[0]?.product.id ?? null;
  $app.innerHTML = `
    <section class="stack-lg">
      <div class="stack">
        <p class="eyebrow">Step 2 of 3 · Your match</p>
        <h1>${s.returned.category === 'dress' ? 'Colours picked for you' : 'Shades picked for you'}</h1>
      </div>
      ${toneCard(s)}
      <div class="stack">
        <h2>${esc(s.matches?.intro ?? '')}</h2>
        <p class="muted small" style="margin-top:4px">Step 3 of 3 · See them on you. Tap a preview to choose.</p>
        <div class="tryon-grid" role="list" id="tryon-grid">
          ${options.map((o) => tryonCard(s, o)).join('')}
        </div>
        <p class="muted small" style="text-align:center;margin-top:2px">${esc(s.copy.tryonLabel)}. Colours on screens vary.</p>
      </div>
      <div class="stack" id="reasons">
        ${s.picks
          .map(
            (p, i) => `
          <div class="card flat match">
            <div class="match-head">
              <span class="swatch" style="background:${esc(p.product.hex)}"></span>
              <div class="grow"><div style="font-weight:600">${esc(p.product.shadeName)} <span class="badge ${i === 0 ? 'best' : 'alt'}">${i === 0 ? 'Best match' : 'Also great'}</span></div>
              ${p.deltaE != null && s.returned.category !== 'dress' ? `<div class="de">ΔE ${esc(p.deltaE)} from your target</div>` : ''}</div>
              <span class="price">${money(p.product.price)}</span>
            </div>
            <p class="reason">${esc(p.reason)}</p>
            ${p.price?.type !== 'even' ? `<p class="small muted" style="margin:0">${esc(p.price.note)}</p>` : ''}
          </div>`,
          )
          .join('')}
      </div>
      <div class="banner info small"><span aria-hidden="true">🔒</span><div>Your photo is deleted as soon as you choose. <button class="btn ghost" style="min-height:0;padding:0" data-action="delete-photo">Delete it now</button></div></div>
    </section>`;
  renderSticky(s);
  if (s.step === 'matches') sendEvent('render', {}, { quiet: true });
  else if (s.renders.some((r) => r.status === 'queued' || r.status === 'rendering')) startPolling();
  focusTitle();
}

function tryonCard(s, o) {
  const r = s.renders.find((x) => x.productId === o.product.id);
  const selectable = o.role !== 'returned';
  const current = selectable && state.selected === o.product.id;
  return `
    <div class="tryon" role="listitem" data-pid="${esc(o.product.id)}" ${current ? 'aria-current="true"' : ''}>
      ${selectable ? `<button class="select" data-action="select" data-pid="${esc(o.product.id)}" aria-label="Choose ${esc(o.product.shadeName)}" aria-pressed="${current}">` : '<div>'}
        <div class="img" data-img="${esc(o.product.id)}">${renderImg(s, r, o)}</div>
        <div class="cap">
          <span class="swatch" style="background:${esc(o.product.hex)};width:20px;height:20px"></span>
          <div class="grow"><div class="name">${esc(o.product.shadeName)}</div><span class="badge ${o.role === 'returned' ? 'returned' : o.role === 'pick1' ? 'best' : 'alt'}">${esc(o.badge)}</span></div>
        </div>
      ${selectable ? '</button>' : '</div>'}
    </div>`;
}

function renderImg(s, r, o) {
  if (!r || r.status === 'queued' || r.status === 'rendering') return `<div class="skeleton" style="width:100%;height:100%" role="img" aria-label="Preview of ${esc(o.product.shadeName)} loading"></div>`;
  if (r.status === 'done' && r.url) {
    const mockTint = s.mode === 'mock' ? `<div class="mock-tint" style="background:${esc(o.product.hex)}"></div>` : '';
    return `<img src="${esc(r.url)}" alt="Preview of ${esc(o.product.shadeName)} on your photo" loading="lazy" />${mockTint}<span class="label-vp">${s.mode === 'mock' ? 'Mock preview · ' : ''}Visual preview, not a guarantee</span>`;
  }
  if (r.status === 'skipped') return `<div class="failed">Preview limit reached for this return.</div>`;
  return `<div class="failed"><div><span class="swatch" style="background:${esc(o.product.hex)};width:48px;height:48px;margin:0 auto 8px"></span>${esc(r.error || 'Preview unavailable')}</div></div>`;
}

function updateRenders(s) {
  const options = [s.returned, ...s.picks.map((p) => p.product)];
  for (const p of options) {
    const el = $app.querySelector(`[data-img="${CSS.escape(p.id)}"]`);
    const r = s.renders.find((x) => x.productId === p.id);
    if (el && r && el.dataset.status !== r.status) {
      el.dataset.status = r.status;
      el.innerHTML = renderImg(s, r, { product: p });
    }
  }
}

function renderSticky(s) {
  if (!['matches', 'tryon'].includes(s.step) || !s.picks.length) {
    $sticky.hidden = true;
    return;
  }
  const pick = s.picks.find((p) => p.product.id === state.selected) ?? s.picks[0];
  $sticky.hidden = false;
  $sticky.innerHTML = `
    <div class="inner">
      <button class="btn block accent" data-action="exchange" data-pid="${esc(pick.product.id)}">
        <span>Exchange for ${esc(pick.product.shadeName)}<span class="btn-sub">Free, ships today</span></span>
      </button>
      <button class="btn block secondary" data-action="refund-review">Continue to refund</button>
    </div>`;
}

function viewExchanged(s) {
  $sticky.hidden = true;
  const x = s.exchange;
  $app.innerHTML = `
    <section class="stack-lg">
      <div class="done-icon" aria-hidden="true">✓</div>
      <div class="stack">
        <h1>Your new ${s.returned.category === 'dress' ? 'colour' : 'shade'} ships today</h1>
        <p class="lede">${esc(x.message)}</p>
      </div>
      <div class="card flat">
        <dl class="kv">
          <dt>Exchange order</dt><dd>${esc(x.id)}</dd>
          <dt>Sending</dt><dd>${esc(x.toName)}</dd>
          <dt>Returning</dt><dd>${esc(x.fromName)}</dd>
          <dt>Return label</dt><dd>${esc(x.returnLabel)} (prepaid)</dd>
          ${x.price?.refundToCustomer ? `<dt>Refund</dt><dd>${money(x.price.refundToCustomer)} difference</dd>` : ''}
        </dl>
      </div>
      <div class="banner ok"><span aria-hidden="true">🔒</span><div><b>Your photo has been deleted.</b>So have the previews, here and on the processing service.</div></div>
      <a class="btn block secondary" href="#/">Back to orders</a>
      <p class="footer-note">Demo store: no real order was placed.</p>
    </section>`;
  focusTitle();
}

function viewRefunded(s) {
  $sticky.hidden = true;
  $app.innerHTML = `
    <section class="stack-lg">
      <div class="done-icon" aria-hidden="true">✓</div>
      <div class="stack"><h1>Refund on its way</h1><p class="lede">${esc(s.refund.message)}</p></div>
      ${s.attempts.photo ? '<div class="banner ok"><span aria-hidden="true">🔒</span><div><b>Your photo has been deleted.</b></div></div>' : ''}
      <a class="btn block secondary" href="#/">Back to orders</a>
      <p class="footer-note">Demo store: no real refund was issued.</p>
    </section>`;
  focusTitle();
}

function viewEscalated(s) {
  $sticky.hidden = true;
  $app.innerHTML = `
    <section class="stack-lg">
      ${s.profile ? toneCard(s) : ''}
      <div class="stack">
        <p class="eyebrow">A person will help</p>
        <h1>We'd rather not guess</h1>
        <p class="lede">${esc(s.escalation?.message ?? '')}</p>
      </div>
      <div class="btn-col">
        <button class="btn block" data-action="refund-review">Continue to refund</button>
        <a class="btn block secondary" href="#/">Back to orders</a>
      </div>
    </section>`;
  focusTitle();
}

// ---------- trace panel ----------
function renderTrace() {
  const s = state.session;
  if (!s) return;
  $traceToggle.setAttribute('aria-pressed', String(state.traceOpen));
  $trace.hidden = !state.traceOpen;
  $layout.classList.toggle('with-trace', state.traceOpen);
  if (!state.traceOpen) return;
  const tools = s.trace.filter((t) => t.kind === 'tool');
  const totalMs = tools.reduce((a, t) => a + (t.ms || 0), 0);
  $trace.innerHTML = `
    <div class="trace-panel">
      <div class="row" style="justify-content:space-between"><h2>Agent trace</h2><button class="icon-btn" style="background:#2d2724;color:#efe8e1;border-color:#3a332f" data-action="toggle-trace">Hide</button></div>
      <div class="sum"><span>${tools.length} tool calls</span><span>${(totalMs / 1000).toFixed(1)} s</span><span>${s.unitsUsed} units</span><span>renders ${s.rendersUsed}/${s.maxRenders}</span><span>${s.mode === 'live' ? 'live API' : 'mock'}</span></div>
      <ol class="trace-list">
        ${s.trace
          .map((t, i) => {
            if (t.kind === 'decision') return `<li class="decision"><span class="n">→</span><span class="s">${esc(t.summary)}</span><span></span></li>`;
            if (t.kind === 'cleanup') return `<li class="decision"><span class="n">🗑</span><span class="s">${esc(t.summary)}</span><span></span></li>`;
            return `<li class="${t.ok ? '' : 'fail'}"><span class="n">${i + 1}</span><span><span class="tool">${esc(t.tool)}</span> <span class="s">${esc(t.summary)}</span></span><span class="meta">${t.ms} ms${t.units ? ` · ${t.units}u` : ''}${t.cached ? ' · cache' : ''}</span></li>`;
          })
          .join('')}
      </ol>
      <p style="color:#8f857c;margin:10px 0 0">No photos, colours or raw API output are logged.</p>
    </div>`;
}

// ---------- events ----------
async function sendEvent(type, payload = {}, { quiet = false } = {}) {
  if (state.busy && !quiet) return;
  state.busy = !quiet;
  try {
    const v = await api('POST', `/api/session/${state.session.id}/event`, { type, ...payload });
    const prevStep = state.session.step;
    state.session = v;
    if (type === 'render') {
      renderTrace();
      startPolling();
      return;
    }
    if (v.step === prevStep && ['matches', 'tryon'].includes(v.step)) {
      updateRenders(v);
      renderTrace();
      return;
    }
    renderSession();
  } catch (e) {
    toast(e.guidance || e.message);
    if (e.code === 'session_not_found') location.hash = '#/';
  } finally {
    state.busy = false;
  }
}

function startPolling() {
  stopPolling();
  state.polling = setInterval(async () => {
    try {
      const v = await api('GET', `/api/session/${state.session.id}`);
      state.session = v;
      updateRenders(v);
      renderTrace();
      if (!v.renders.some((r) => r.status === 'queued' || r.status === 'rendering')) stopPolling();
    } catch {
      stopPolling();
    }
  }, 1200);
}
function stopPolling() {
  if (state.polling) clearInterval(state.polling);
  state.polling = null;
}

const actions = {
  async 'start-return'(el) {
    const v = await api('POST', '/api/returns', { orderId: el.dataset.order, lineId: el.dataset.line });
    state.session = v;
    state.selected = null;
    state.captured = null;
    location.hash = `#/return/${v.id}`;
  },
  accept: () => sendEvent('accept_secondtry'),
  'back-offer': () => {
    state.session.step = 'offer';
    renderSession();
  },
  'refund-review': () => {
    stopCamera();
    if (state.session.step === 'offer') return sendEvent('decline_secondtry');
    state.session = { ...state.session, step: 'refund_review' };
    renderSession();
  },
  refund: () => sendEvent('refund'),
  consent: () => sendEvent('consent', { accepted: true }),
  camera: startCamera,
  async snap() {
    const video = document.querySelector('#capture-box video');
    if (!video?.videoWidth) return;
    state.captured = processImage(video, video.videoWidth, video.videoHeight);
    showCaptured();
  },
  retake: () => {
    state.captured = null;
    if (state.session.step !== 'capture') return sendEvent('retake');
    viewCapture(state.session);
  },
  async 'submit-photo'() {
    const c = state.captured;
    if (!c) return;
    viewProcessing('Measuring your skin tone…', 'Then finding your best matches in stock.');
    await sendEvent('photo', { image: c.dataUrl, width: c.width, height: c.height, stats: c.stats, hint: state.health?.mode === 'mock' ? c.hint : undefined });
  },
  select(el) {
    state.selected = el.dataset.pid;
    $app.querySelectorAll('.tryon').forEach((t) => {
      const on = t.dataset.pid === state.selected;
      t.toggleAttribute('aria-current', on);
      if (on) t.setAttribute('aria-current', 'true');
      const b = t.querySelector('button.select');
      if (b) b.setAttribute('aria-pressed', String(on));
    });
    renderSticky(state.session);
  },
  async exchange(el) {
    stopPolling();
    await sendEvent('exchange', { productId: el.dataset.pid });
  },
  escalate: () => sendEvent('escalate'),
  async 'delete-photo'() {
    const v = await api('DELETE', `/api/session/${state.session.id}`);
    state.session = v;
    toast('Your photo and previews have been deleted.');
    renderSession();
  },
  'toggle-trace': () => {
    state.traceOpen = !state.traceOpen;
    renderTrace();
  },
};

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const fn = actions[el.dataset.action];
  if (fn) {
    e.preventDefault();
    Promise.resolve(fn(el)).catch((err) => toast(err.guidance || err.message));
  }
});
$traceToggle.addEventListener('click', () => actions['toggle-trace']());

// ---------- camera & image prep ----------
async function startCamera() {
  const box = document.getElementById('capture-box');
  try {
    state.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 960 } }, audio: false });
  } catch {
    toast('Camera unavailable. You can upload a photo instead.');
    return;
  }
  const body = state.session.returned.category === 'dress';
  box.innerHTML = `<video autoplay playsinline muted aria-label="Camera preview"></video>${body ? '<div class="guide-oval body"></div><div class="guide-shoulders"></div>' : '<div class="guide-oval"></div>'}<div class="live-hint" id="live-hint" aria-live="polite">Checking light…</div>`;
  const video = box.querySelector('video');
  video.srcObject = state.stream;
  const actionsEl = document.getElementById('capture-actions');
  actionsEl.insertAdjacentHTML('afterbegin', '<button class="btn block accent" data-action="snap" id="snap-btn">Take photo</button>');
  const hint = document.getElementById('live-hint');
  const probe = document.createElement('canvas');
  probe.width = 48;
  probe.height = 64;
  const ctx = probe.getContext('2d', { willReadFrequently: true });
  state.lightTimer = setInterval(() => {
    if (!video.videoWidth) return;
    ctx.drawImage(video, video.videoWidth * 0.25, video.videoHeight * 0.1, video.videoWidth * 0.5, video.videoHeight * 0.6, 0, 0, 48, 64);
    const { meanLuma } = lumaStats(ctx.getImageData(0, 0, 48, 64).data);
    hint.textContent = meanLuma < 60 ? 'A bit dark: face a window or a lamp' : meanLuma > 215 ? 'Very bright: step out of direct light' : 'Lighting looks good ✓';
  }, 600);
}

function stopCamera() {
  if (state.lightTimer) clearInterval(state.lightTimer);
  state.lightTimer = null;
  if (state.stream) state.stream.getTracks().forEach((t) => t.stop());
  state.stream = null;
}

async function onFile(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  if (!/^image\/(jpeg|png)$/.test(file.type)) {
    toast('Please choose a JPG or PNG photo.');
    return;
  }
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    state.captured = processImage(img, img.naturalWidth, img.naturalHeight);
    URL.revokeObjectURL(url);
    showCaptured();
  };
  img.onerror = () => toast("We couldn't read that photo. Try a JPG or PNG.");
  img.src = url;
}

function lumaStats(data) {
  let sum = 0;
  let sumSq = 0;
  let clipped = 0;
  const n = data.length / 4;
  for (let i = 0; i < data.length; i += 4) {
    const y = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
    sum += y;
    sumSq += y * y;
    if (y > 250 || y < 5) clipped++;
  }
  const mean = sum / n;
  return { meanLuma: Math.round(mean), contrast: Math.round(Math.sqrt(Math.max(0, sumSq / n - mean * mean))), clippedPct: Math.round((clipped / n) * 100) };
}

function avgHex(ctx, x, y, w, h) {
  const d = ctx.getImageData(Math.round(x), Math.round(y), Math.max(1, Math.round(w)), Math.max(1, Math.round(h))).data;
  let r = 0, g = 0, b = 0;
  const n = d.length / 4;
  for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; }
  const hx = (v) => Math.round(v / n).toString(16).padStart(2, '0');
  return `#${hx(r)}${hx(g)}${hx(b)}`.toUpperCase();
}

/** Downscale to a 1024px long side (YouCam makeup VTO needs < 1920 px), JPEG, plus light stats. */
function processImage(source, w, h) {
  const scale = Math.min(1, 1024 / Math.max(w, h));
  const cw = Math.round(w * scale);
  const ch = Math.round(h * scale);
  const canvas = document.createElement('canvas');
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(source, 0, 0, cw, ch);
  const region = ctx.getImageData(Math.round(cw * 0.25), Math.round(ch * 0.15), Math.round(cw * 0.5), Math.round(ch * 0.55)).data;
  const stats = lumaStats(region);
  // Rough colour hint, only used by the server's MOCK transport (never in live mode).
  const hint = { skinHex: avgHex(ctx, cw * 0.42, ch * 0.42, cw * 0.06, ch * 0.05), lipHex: avgHex(ctx, cw * 0.47, ch * 0.63, cw * 0.06, ch * 0.02) };
  return { dataUrl: canvas.toDataURL('image/jpeg', 0.9), width: cw, height: ch, stats, hint };
}

boot().catch((e) => {
  $app.innerHTML = `<div class="card"><h1>Something went wrong</h1><p>${esc(e.message)}</p></div>`;
});
