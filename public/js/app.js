// MirrorMatch shopper flow (vanilla JS, no build step).
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

/** "Shade", "Colour" or "Texture" for a product category; nouns follow the same rule. */
const variantLabel = (category) => ({ dress: 'Colour', skincare: 'Texture' })[category] ?? 'Shade';
const variantNoun = (category) => variantLabel(category).toLowerCase();

function refundLink(label = 'Continue to refund') {
  return `<button class="btn ghost" data-action="refund-review">${esc(label)}</button>`;
}

// ---------- progress, voice, passport helpers ----------
const STEPS = ['Why', 'Photo', 'Your match', 'Done'];
const STEP_OF = { reason: 0, offer: 0, consent: 1, capture: 1, matches: 2, tryon: 2, exchanged: 3 };

/** A slim "where am I" bar for the MirrorMatch path (not shown on the plain refund path). */
function progressBar(step) {
  const at = STEP_OF[step];
  if (at == null) return '';
  const last = at === STEPS.length - 1;
  return `
    <ol class="progress" aria-label="Step ${at + 1} of ${STEPS.length}: ${esc(STEPS[at])}">
      ${STEPS.map((label, i) => {
        const done = i < at || (last && i === at);
        return `<li class="${done ? 'done' : ''} ${i === at ? 'now' : ''}" ${i === at ? 'aria-current="step"' : ''}><span class="dot" aria-hidden="true">${done ? '✓' : i + 1}</span><span class="lbl">${esc(label)}</span></li>`;
      }).join('')}
    </ol>`;
}

const canSpeak = () => 'speechSynthesis' in window && typeof window.SpeechSynthesisUtterance === 'function';
function stopSpeaking() {
  if (canSpeak()) window.speechSynthesis.cancel();
  document.querySelectorAll('[data-action="listen"][aria-pressed="true"]').forEach((b) => {
    b.setAttribute('aria-pressed', 'false');
    b.querySelector('.lbl').textContent = 'Read my results aloud';
  });
}

/** The colour passport: tone numbers only (never the photo), on this device only, opt-in. */
const PASSPORT_KEY = 'mirrormatch.passport';
function readPassport() {
  try {
    const p = JSON.parse(localStorage.getItem(PASSPORT_KEY) || 'null');
    return p && /^#[0-9A-F]{6}$/i.test(p.skinHex) ? p : null;
  } catch {
    return null;
  }
}
function writePassport(p) {
  try {
    if (p) localStorage.setItem(PASSPORT_KEY, JSON.stringify(p));
    else localStorage.removeItem(PASSPORT_KEY);
    return true;
  } catch {
    return false;
  }
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
  stopSpeaking();
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
  const passport = readPassport();
  $app.innerHTML = `
    <section class="stack-lg">
      <div>
        <p class="eyebrow">Your orders</p>
        <h1>Hi ${esc(first)}, need to return something?</h1>
        <p class="lede">Returns are free within 30 days of delivery. If a colour wasn't right, we'll help you find one that is.</p>
      </div>
      ${passport ? '<section class="card passport-shelf stack" id="passport-shelf" aria-labelledby="shelf-title" hidden></section>' : ''}
      <a class="story-link" href="/story.html">
        <span class="story-dots" aria-hidden="true"><i style="background:#c98f8a"></i><i style="background:#b77a5f"></i></span>
        <span class="grow"><b>New here? Start with Alex's story</b><span>Why a "wrong shade" return deserves a second chance. 1-minute read.</span></span>
        <span aria-hidden="true">→</span>
      </a>
      <ul class="stack" style="list-style:none;margin-bottom:0;padding:0">
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
              <div class="muted small">${esc(variantLabel(l.product.category))}: ${esc(l.product.shadeName)} · <span class="price">${money(l.price)}</span></div>
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
  if (passport) loadPassportShelf(passport);
}

/** "Picked for you": the same deterministic matcher, run on the saved tone numbers. */
async function loadPassportShelf(passport) {
  const el = document.getElementById('passport-shelf');
  if (!el) return;
  let data;
  try {
    data = await api('POST', '/api/profile/matches', { skinHex: passport.skinHex, lipHex: passport.lipHex, hairHex: passport.hairHex });
  } catch {
    return; // the shelf is a bonus; the orders page works without it
  }
  const kept = passport.kept;
  const picks = Object.entries(data.picks || {})
    .map(([cat, list]) =>
      kept?.category === cat
        ? [cat, { ...kept, reason: 'Your pick from your last return. We\'ll remember it works for you.', yours: true }]
        : [cat, (list || [])[0]],
    )
    .filter(([, p]) => p);
  if (!picks.length) return;
  const catName = { lipstick: 'Lipstick', foundation: 'Foundation', dress: 'Dress colour' };
  el.innerHTML = `
    <div class="row" style="justify-content:space-between;align-items:baseline">
      <h2 id="shelf-title">Picked for you</h2>
      <button class="btn ghost small" style="min-height:0;padding:0" data-action="forget-passport">Forget my colours</button>
    </div>
    <p class="muted small" style="margin-top:4px">From the colour profile you saved on this device (${esc(cap(data.profile?.depthLabel || passport.depthLabel || ''))} · ${esc(data.profile?.undertone || passport.undertone || '')}). No photo is kept.</p>
    <ul class="shelf">
      ${picks
        .map(
          ([cat, p]) => `
        <li class="shelf-item">
          <img src="${esc(p.image)}" alt="" width="56" height="72" />
          <div class="grow">
            <div class="muted small">${esc(catName[cat] || cat)}</div>
            <div style="font-weight:600">${esc(p.shadeName)} <span class="badge ${p.yours ? 'mine' : 'best'}">${p.yours ? 'Your pick' : 'Suits you'}</span></div>
            <div class="small muted">${esc(p.reason || '')}</div>
          </div>
        </li>`,
        )
        .join('')}
    </ul>`;
  el.hidden = false;
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
  if (s.profile) state.lastProfile = s.profile;
  $app.insertAdjacentHTML('afterbegin', progressBar(s.step));
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
  // Colour reasons for colour products, "It didn't suit my skin" for skincare only.
  const reasons = Object.fromEntries(Object.entries(state.reasons).filter(([, r]) => !r.categories || r.categories.includes(s.returned.category)));
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
  const cat = s.returned.category;
  const noun = variantNoun(cat);
  const skincare = cat === 'skincare';
  $app.innerHTML = `
    <section class="stack-lg">
      ${returnedHeader(s)}
      <p class="empathy">${skincare
        ? `Sorry ${esc(s.returned.shadeName)} wasn't right for your skin. Skin is personal and hard to judge from a product page, and that's on us, not you.`
        : `Sorry ${esc(s.returned.shadeName)} wasn't right. Colour is hard to judge through a screen, and that's on us, not you.`}</p>
      <div class="hero-offer stack">
        <p class="timer">◷ About 30 seconds</p>
        <h1>${skincare ? 'Find the texture that suits your skin?' : 'See a better match on you before you decide?'}</h1>
        <p class="lede">${skincare
          ? "We'll read your skin from a selfie (shine, hydration and redness) and suggest the texture that suits it. Skincare can't be previewed, so there's no try-on."
          : cat === 'hair'
            ? "We'll measure your skin tone and natural hair colour from a selfie, find the right shade in stock, and show it on your own hair."
            : `We'll measure your skin tone from a selfie, find the right ${noun} in stock, and show it on your own photo.`}</p>
        <div class="steps-mini" aria-hidden="true">
          ${skincare ? '<div><b>1</b>Selfie</div><div><b>2</b>Your skin</div><div><b>3</b>Your match</div>' : '<div><b>1</b>Selfie</div><div><b>2</b>Your match</div><div><b>3</b>See it on you</div>'}
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
        ${state.returnTo ? `<button class="btn block secondary" data-action="back">${state.returnTo === 'tryon' || state.returnTo === 'matches' ? 'Back to my matches' : 'Back'}</button>` : ''}
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
          <li><b>Used only for this return:</b> ${s.returned.category === 'skincare' ? 'to read your skin (shine, hydration and redness). No previews.' : 'to measure your skin tone and show previews.'}</li>
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
        <button class="btn block secondary" data-action="use-sample" data-kind="${body ? 'body' : 'face'}" aria-describedby="sample-note">Use YouCam's sample model</button>
        <p class="muted small" id="sample-note" style="margin:0;text-align:center">No photo handy? Try it with YouCam's official ${body ? 'waist-up' : 'selfie'} sample image.</p>
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
      <p style="margin:0" id="tone-summary">${esc(p.summary)}</p>
      <details class="how">
        <summary>How we measured this</summary>
        <p>YouCam's skin-tone analysis measured your skin, lip, eye and hair colours. We converted them to CIELAB and ranked in-stock options by colour distance (CIEDE2000) plus undertone rules. Measured on this photo only; lighting can shift results.</p>
      </details>
    </div>`;
}

const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : '');

// ---------- "Your skin today" (YouCam skin analysis) ----------
function skinCard(s) {
  const k = s.skin;
  if (!k) return '';
  const pick = s.picks.find((p) => p.product.id === state.selected) ?? s.picks[0];
  let body;
  if (k.status === 'running') {
    body = `<p class="muted small" style="margin:0" role="status">Reading your skin for finish tips…</p><div class="skeleton" style="height:14px;border-radius:7px;width:70%"></div>`;
  } else if (k.status === 'failed') {
    body = `<p class="small muted" style="margin:0">${esc(k.message)}</p>`;
  } else {
    body = `
      <div class="pills">${k.chips.map((c) => `<span class="pill">${esc(c.label)}</span>`).join('')}</div>
      <p style="margin:0">${esc(k.text)}</p>
      ${k.advice ? `
        <div class="advice">
          <div class="small muted">How to wear ${esc(pick?.product.shadeName ?? 'your match')}</div>
          <div class="advice-row"><span><b>${esc(cap(k.advice.finish))}</b> finish</span><span><b>${esc(cap(k.advice.coverage))}</b> coverage</span></div>
          <p class="small" style="margin:0;color:var(--fg-2)">${esc(k.advice.reason)}</p>
        </div>` : ''}
      <p class="small muted" style="margin:0">${esc(k.note)}</p>
      <details class="how">
        <summary>How we read this</summary>
        <p>YouCam's AI Skin Analysis looked at shine, hydration, redness and skin type on this photo. Simple, published rules turn that into ${k.advice ? 'a finish and coverage tip' : 'a texture suggestion'}. We don't show scores, and it isn't medical advice.</p>
      </details>`;
  }
  return `
    <section class="card skin-card stack" id="skin-card" data-key="${esc(skinKey(s))}" aria-labelledby="skin-title">
      <div class="row" style="gap:10px"><span class="skin-dot" aria-hidden="true"></span><h2 id="skin-title" style="margin:0">Your skin today</h2></div>
      ${body}
    </section>`;
}
const skinKey = (s) => `${s.skin?.status}|${state.selected}`;

// ---------- "Complete the look" (opt-in extra previews) ----------
function lookImg(s, look, alt) {
  if (!look || look.status === 'rendering') return `<div class="skeleton" style="width:100%;height:100%" role="img" aria-label="Preview loading"></div>`;
  if (look.status === 'done' && look.url) {
    return `<img src="${esc(look.url)}" alt="${esc(alt)}" />${s.mode === 'mock' ? `<div class="mock-tint" style="background:${esc(look.lip?.hex || '#c77')}"></div>` : ''}<span class="label-vp">${s.mode === 'mock' ? 'Mock preview · ' : ''}Visual preview, not a guarantee</span>`;
  }
  return `<div class="failed">${esc(look.error || 'Preview unavailable')}</div>`;
}

function lookCard(s) {
  const cat = s.returned.category;
  if (!['dress', 'lipstick'].includes(cat) || !s.picks.length) return '';
  const pick = s.picks.find((p) => p.product.id === state.selected) ?? s.picks[0];
  const render = s.renders.find((r) => r.productId === pick.product.id);
  const ready = render?.status === 'done';
  const left = Math.max(0, (s.maxLooks ?? 2) - (s.looksUsed ?? 0));
  let inner;
  if (cat === 'dress') {
    const look = s.looks.find((l) => l.kind === 'lips_dress' && l.dressId === pick.product.id);
    const head = `
      <div>
        <p class="eyebrow" style="margin:0">Optional · complete the look</p>
        <h2 id="look-title" style="margin-top:4px">Lips for ${esc(pick.product.shadeName)}</h2>
        <p class="muted small" style="margin:4px 0 0">We pick a lipstick that suits you and the new dress, then show both on your photo: makeup and clothes try-on together.</p>
      </div>`;
    if (!look) {
      inner = `${head}
        <button class="btn block secondary" data-action="look-lips" data-pid="${esc(pick.product.id)}" ${ready && left ? '' : 'disabled'}>Complete the look: lips for ${esc(pick.product.shadeName)}</button>
        <p class="small muted" style="margin:0">${!left ? 'You have seen all the extra previews for this return.' : ready ? 'One extra preview. Nothing is added to your exchange unless you choose it.' : 'Available once the dress preview is ready.'}</p>`;
    } else {
      const on = state.addOn?.lipId === look.lipId && state.addOn?.dressId === look.dressId;
      inner = `${head}
        <div class="look-result">
          <div class="look-img zoom">${lookImg(s, look, `Your photo in the ${pick.product.shadeName} dress wearing ${look.lip?.shadeName ?? 'the lipstick'}`)}</div>
          <div class="stack" style="gap:6px">
            <div class="row" style="gap:8px"><span class="swatch" style="background:${esc(look.lip.hex)}"></span><div class="grow"><div style="font-weight:600">${esc(look.lip.shadeName)}</div><div class="small muted">${esc(look.lip.productLine)} · ${money(look.lip.price)}</div></div></div>
            <p class="reason" style="margin:0">${esc(look.lipReason)}</p>
          </div>
        </div>
        ${look.addOn?.allowed ? `
          <label class="addon" for="addon-check">
            <input type="checkbox" id="addon-check" data-lip="${esc(look.lipId)}" data-dress="${esc(look.dressId)}" ${on ? 'checked' : ''} />
            <span>Add ${esc(look.lip.shadeName)} to my order: <b>${money(look.addOn.customerPays)}</b>, charged separately. Your ${esc(pick.product.shadeName)} exchange stays free.</span>
          </label>` : ''}`;
    }
  } else {
    const look = s.looks.find((l) => l.kind === 'lip_blush' && l.lipId === pick.product.id);
    const head = `
      <div>
        <p class="eyebrow" style="margin:0">Optional · complete the look</p>
        <h2 id="look-title" style="margin-top:4px">${esc(pick.product.shadeName)} with a matching blush</h2>
        <p class="muted small" style="margin:4px 0 0">A blush colour picked to go with this lipstick and your undertone, on your photo. A styling idea: there's nothing extra to buy.</p>
      </div>`;
    inner = !look
      ? `${head}
        <button class="btn block secondary" data-action="look-blush" data-pid="${esc(pick.product.id)}" ${left ? '' : 'disabled'}>See it with a matching blush</button>
        ${left ? '' : '<p class="small muted" style="margin:0">You have seen all the extra previews for this return.</p>'}`
      : `${head}
        <div class="look-result">
          <div class="look-img">${lookImg(s, look, `Your photo with ${pick.product.shadeName} and a ${look.blush?.name ?? ''} blush`)}</div>
          <div class="stack" style="gap:6px">
            <div class="row" style="gap:8px"><span class="swatch" style="background:${esc(look.blush.hex)}"></span><div class="grow"><div style="font-weight:600">${esc(cap(look.blush.name))} blush</div><div class="small muted">Paired with ${esc(pick.product.shadeName)}</div></div></div>
            <p class="reason" style="margin:0">${esc(look.blush.reason)}</p>
          </div>
        </div>`;
  }
  return `<section class="card look-card stack" id="look-card" data-key="${esc(lookKey(s))}" aria-labelledby="look-title">${inner}</section>`;
}
const lookKey = (s) => `${state.selected}|${(s.looks || []).map((l) => `${l.kind}:${l.dressId || l.lipId}:${l.status}`).join(',')}|${s.renders.map((r) => r.status).join(',')}|${s.looksUsed}`;

/** Re-render the skin and look cards in place when their state changes (during polling). */
function updateExtras(s) {
  for (const [id, key, html] of [['skin-card', skinKey(s), () => skinCard(s)], ['look-card', lookKey(s), () => lookCard(s)]]) {
    const el = document.getElementById(id);
    if (el && el.dataset.key !== key) el.outerHTML = html();
  }
}

const busyExtras = (s) => s.renders.some((r) => r.status === 'queued' || r.status === 'rendering') || (s.looks || []).some((l) => l.status === 'rendering') || s.skin?.status === 'running';

/** Skincare: the skin reading and a texture exchange. No try-on: skincare can't be previewed. */
function viewSkincare(s) {
  if (!state.selected || !s.picks.some((p) => p.product.id === state.selected)) state.selected = s.picks[0]?.product.id ?? null;
  $app.innerHTML = `
    <section class="stack-lg">
      <div class="stack">
        <p class="eyebrow">Step 2 of 3 · Your match</p>
        <h1>A better texture for your skin</h1>
        ${canSpeak() ? '<button class="btn ghost listen" data-action="listen" aria-pressed="false"><span aria-hidden="true">🔊</span><span class="lbl">Read my results aloud</span></button>' : ''}
      </div>
      ${skinCard(s)}
      <div class="stack">
        <h2>${esc(s.matches?.intro ?? '')}</h2>
        ${s.matches?.returnedCaution ? `<p class="small muted" style="margin:4px 0 0">${esc(s.matches.returnedCaution)} That's about the product, not about you.</p>` : ''}
        <div class="texture-list" role="list">
          ${s.picks
            .map((p, i) => {
              const current = state.selected === p.product.id;
              return `
            <div class="tryon texture" role="listitem" data-pid="${esc(p.product.id)}" ${current ? 'aria-current="true"' : ''}>
              <button class="select" data-action="select" data-pid="${esc(p.product.id)}" aria-label="Choose ${esc(p.product.shadeName)}" aria-pressed="${current}">
                <div class="texture-row">
                  ${productThumb(p.product, 'thumb sm')}
                  <div class="grow">
                    <div style="font-weight:600">${esc(p.product.productLine)} · ${esc(p.product.shadeName)} <span class="badge ${i === 0 ? 'best' : 'alt'}">${i === 0 ? 'Suits you today' : 'Also good'}</span></div>
                    <div class="small muted">${esc(p.product.blurb || '')}</div>
                    <p class="reason" style="margin:6px 0 0">${esc(p.reason)}</p>
                    ${p.price?.type !== 'even' ? `<p class="small muted" style="margin:4px 0 0">${esc(p.price.note)}</p>` : ''}
                  </div>
                  <span class="price">${money(p.product.price)}</span>
                </div>
              </button>
            </div>`;
            })
            .join('')}
        </div>
        <p class="muted small" style="text-align:center;margin-top:2px">Suggestions from a skin reading, not medical advice. Patch-test new skincare.</p>
      </div>
      <div class="banner info small"><span aria-hidden="true">🔒</span><div>Your photo is deleted as soon as you choose. <button class="btn ghost" style="min-height:0;padding:0" data-action="delete-photo">Delete it now</button></div></div>
    </section>`;
  renderSticky(s);
  focusTitle();
}

function viewMatches(s) {
  if (s.returned.category === 'skincare') return viewSkincare(s);
  const options = [
    { role: 'returned', product: s.returned, reason: s.matches?.returnedCaution || 'The one you bought.', badge: 'Returned' },
    ...s.picks.map((p, i) => ({ role: `pick${i + 1}`, product: p.product, reason: p.reason, deltaE: p.deltaE, badge: i === 0 ? 'Best match' : 'Also great', offer: p.offer })),
  ];
  if (!state.selected || !s.picks.some((p) => p.product.id === state.selected)) state.selected = s.picks[0]?.product.id ?? null;
  $app.innerHTML = `
    <section class="stack-lg">
      <div class="stack">
        <p class="eyebrow">Step 2 of 3 · Your match</p>
        <h1>${s.returned.category === 'dress' ? 'Colours picked for you' : 'Shades picked for you'}</h1>
        ${canSpeak() ? '<button class="btn ghost listen" data-action="listen" aria-pressed="false"><span aria-hidden="true">🔊</span><span class="lbl">Read my results aloud</span></button>' : ''}
      </div>
      ${toneCard(s)}
      ${skinCard(s)}
      <div class="stack">
        <h2>${esc(s.matches?.intro ?? '')}</h2>
        <p class="muted small" style="margin-top:4px">Step 3 of 3 · See them on you. Tap a preview to choose.</p>
        <div class="tryon-grid" role="list" id="tryon-grid">
          ${options.map((o) => tryonCard(s, o)).join('')}
        </div>
        <p class="muted small" style="text-align:center;margin-top:2px">${esc(s.copy.tryonLabel)}. Colours on screens vary.</p>
      </div>
      <section class="card compare-card stack" id="compare-card" aria-label="Before and after" hidden></section>
      ${lookCard(s)}
      <details class="why">
        <summary>Why these ${esc(variantNoun(s.returned.category))}s suit you</summary>
      <div class="stack" id="reasons">
        ${s.matches?.returnedCaution
          ? `<div class="card tint match"><div class="match-head"><span class="swatch" style="background:${esc(s.returned.hex)}"></span><div class="grow"><div style="font-weight:600">Why ${esc(s.returned.shadeName)} may not have worked</div></div></div><p class="reason">${esc(s.matches.returnedCaution)} That's about the colour, not about you.</p></div>`
          : ''}
        ${s.picks
          .map(
            (p, i) => `
          <div class="card flat match">
            <div class="match-head">
              <span class="swatch" style="background:${esc(p.product.hex)}"></span>
              <div class="grow"><div style="font-weight:600">${esc(p.product.shadeName)} <span class="badge ${i === 0 ? 'best' : 'alt'}">${i === 0 ? 'Best match' : 'Also great'}</span></div>
              ${p.deltaE != null && s.returned.category === 'foundation' ? `<div class="de">ΔE2000 ${esc(p.deltaE)} from your measured skin tone</div>` : ''}</div>
              <span class="price">${money(p.product.price)}</span>
            </div>
            <p class="reason">${esc(p.reason)}</p>
            ${p.price?.type !== 'even' ? `<p class="small muted" style="margin:0">${esc(p.price.note)}</p>` : ''}
          </div>`,
          )
          .join('')}
      </div>
      </details>
      <div class="banner info small"><span aria-hidden="true">🔒</span><div>Your photo is deleted as soon as you choose. <button class="btn ghost" style="min-height:0;padding:0" data-action="delete-photo">Delete it now</button></div></div>
    </section>`;
  renderSticky(s);
  updateCompare(s);
  if (s.step === 'matches') sendEvent('render', {}, { quiet: true });
  else if (busyExtras(s)) startPolling();
  focusTitle();
}

/**
 * Before / after on the shopper's own photo: the returned shade on the left, the chosen pick
 * revealed on the right. Both are real renders of the same photo, so only the colour changes.
 */
function updateCompare(s) {
  const el = document.getElementById('compare-card');
  if (!el || !s.picks?.length) return;
  const pick = s.picks.find((p) => p.product.id === state.selected) ?? s.picks[0];
  const a = s.renders.find((r) => r.productId === s.returned.id);
  const b = s.renders.find((r) => r.productId === pick.product.id);
  if (!(a?.status === 'done' && a.url && b?.status === 'done' && b.url)) {
    el.hidden = true;
    return;
  }
  const key = `${a.url}|${b.url}`;
  if (el.dataset.key === key) return;
  const firstTime = !el.dataset.key;
  el.dataset.key = key;
  const tint = (hex) => (s.mode === 'mock' ? `<div class="mock-tint" style="background:${esc(hex)}"></div>` : '');
  const from = s.returned.shadeName;
  const to = pick.product.shadeName;
  el.innerHTML = `
    <div>
      <h2>Side by side, on you</h2>
      <p class="muted small" style="margin:4px 0 0">Same photo. Only the ${s.returned.category === 'dress' ? 'colour' : 'shade'} changes. Drag to compare.</p>
    </div>
    <div class="compare ${s.returned.category === 'dress' ? 'body' : 'face'}" style="--pos:50%">
      <div class="layer"><img src="${esc(a.url)}" alt="Your photo with ${esc(from)}, the one you're returning" />${tint(s.returned.hex)}</div>
      <div class="layer b"><img src="${esc(b.url)}" alt="Your photo with ${esc(to)}" />${tint(pick.product.hex)}</div>
      <div class="handle" aria-hidden="true"></div>
      <span class="tag l">${esc(from)} · returning</span>
      <span class="tag r">${esc(to)}</span>
      <span class="label-vp">${s.mode === 'mock' ? 'Mock preview · ' : ''}Visual preview, not a guarantee</span>
    </div>
    <label class="sr-only" for="compare-range">Compare ${esc(from)} and ${esc(to)}</label>
    <input id="compare-range" class="compare-range" type="range" min="0" max="100" value="50" />`;
  el.hidden = false;
  const box = el.querySelector('.compare');
  const range = el.querySelector('#compare-range');
  const set = (v) => {
    const pos = Math.max(0, Math.min(100, v));
    box.style.setProperty('--pos', `${pos}%`);
    range.value = String(Math.round(pos));
  };
  range.addEventListener('input', () => set(Number(range.value)));
  const fromPointer = (e) => {
    const r = box.getBoundingClientRect();
    set(((e.clientX - r.left) / r.width) * 100);
  };
  box.addEventListener('pointerdown', (e) => {
    box.setPointerCapture(e.pointerId);
    fromPointer(e);
  });
  box.addEventListener('pointermove', (e) => {
    if (box.hasPointerCapture(e.pointerId)) fromPointer(e);
  });
  // A gentle one-time reveal when the card comes into view, so the difference is noticed
  // (skipped for reduced motion, or if the shopper already moved the slider).
  if (firstTime && !window.matchMedia('(prefers-reduced-motion: reduce)').matches && 'IntersectionObserver' in window) {
    let touched = false;
    const mark = () => { touched = true; };
    range.addEventListener('input', mark, { once: true });
    box.addEventListener('pointerdown', mark, { once: true });
    set(92);
    const io = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.intersectionRatio >= 0.9)) return;
      io.disconnect();
      if (touched) return;
      const t0 = performance.now();
      const step = (t) => {
        if (touched) return;
        const k = Math.min(1, (t - t0) / 1600);
        set(92 - 42 * (1 - (1 - k) ** 3));
        if (k < 1) requestAnimationFrame(step);
      };
      setTimeout(() => requestAnimationFrame(step), 250);
    }, { threshold: [0.9] });
    io.observe(box);
  }
}

function resultsSpeech(s) {
  const parts = [];
  if (s.profile?.summary) parts.push(s.profile.summary);
  if (s.skin?.status === 'done') parts.push(s.skin.text, s.skin.advice ? s.skin.advice.reason : '', s.skin.note);
  if (s.matches?.returnedCaution) parts.push(`Why ${s.returned.shadeName} may not have worked: ${s.matches.returnedCaution}`);
  s.picks.forEach((p, i) => parts.push(`${i === 0 ? 'Best match' : 'Also great'}: ${p.product.shadeName}, ${money(p.product.price)}. ${p.reason}`));
  parts.push('The previews are a visual guide, not a guarantee. Your refund stays one tap away.');
  return parts.join(' ');
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
  const ts = document.getElementById('tone-summary');
  if (ts && s.profile && ts.textContent !== s.profile.summary) ts.textContent = s.profile.summary;
  const options = [s.returned, ...s.picks.map((p) => p.product)];
  for (const p of options) {
    const el = $app.querySelector(`[data-img="${CSS.escape(p.id)}"]`);
    const r = s.renders.find((x) => x.productId === p.id);
    if (el && r && el.dataset.status !== r.status) {
      el.dataset.status = r.status;
      el.innerHTML = renderImg(s, r, { product: p });
    }
  }
  updateCompare(s);
  updateExtras(s);
}

function renderSticky(s) {
  if (!['matches', 'tryon'].includes(s.step) || !s.picks.length) {
    $sticky.hidden = true;
    return;
  }
  const pick = s.picks.find((p) => p.product.id === state.selected) ?? s.picks[0];
  const addOn = chosenAddOn(s, pick);
  $sticky.hidden = false;
  $sticky.innerHTML = `
    <div class="inner">
      <button class="btn block accent" data-action="exchange" data-pid="${esc(pick.product.id)}" ${addOn ? `data-addon="${esc(addOn.lipId)}"` : ''}>
        <span>Exchange for ${esc(pick.product.shadeName)}<span class="btn-sub">Free, ships today${addOn ? ` · + ${esc(addOn.lip.shadeName)} lipstick ${money(addOn.addOn.customerPays)}` : ''}</span></span>
      </button>
      <button class="btn block secondary" data-action="refund-review">Continue to refund</button>
    </div>`;
}

/** The opt-in lipstick add-on, only if the shopper ticked it for the dress they're exchanging to. */
function chosenAddOn(s, pick) {
  if (!state.addOn || state.addOn.dressId !== pick?.product.id) return null;
  return (s.looks || []).find((l) => l.kind === 'lips_dress' && l.lipId === state.addOn.lipId && l.dressId === state.addOn.dressId && l.addOn?.allowed) ?? null;
}

function viewExchanged(s) {
  $sticky.hidden = true;
  const x = s.exchange;
  const profile = s.profile || state.lastProfile;
  const offerPassport = profile?.skinHex && !readPassport();
  $app.innerHTML = `
    <section class="stack-lg">
      <div class="done-icon" aria-hidden="true">✓</div>
      <div class="stack">
        <h1>Your new ${esc(variantNoun(s.returned.category))} ships today</h1>
        <p class="lede">We think this one's you.</p>
      </div>
      <ol class="timeline card flat" aria-label="What happens next">
        <li class="done"><span class="when">Today · exchange order ${esc(x.id)}</span><span><b>${esc(x.toName)}</b> ships, free.</span></li>
        ${x.addOn ? `<li class="done"><span class="when">Your add-on</span><span><b>${esc(x.addOn.name)}</b> ships with it: ${money(x.addOn.customerPays)}, charged separately (demo: nothing is charged).</span></li>` : ''}
        <li><span class="when">Within 30 days, no rush</span><span>Send ${esc(x.fromName)} back with the prepaid label ${esc(x.returnLabel)}.</span></li>
        ${x.price?.refundToCustomer ? `<li class="done"><span class="when">Price difference</span><span>${money(x.price.refundToCustomer)} goes back to your card.</span></li>` : ''}
      </ol>
      <div class="banner ok"><span aria-hidden="true">🔒</span><div><b>Your photo has been deleted.</b>So have the previews, here and on the processing service.</div></div>
      ${offerPassport ? passportOffer(profile) : ''}
      <a class="btn block secondary" href="#/">Back to orders</a>
      <p class="footer-note">Demo store: no real order was placed.</p>
    </section>`;
  focusTitle();
}

function passportOffer(p) {
  return `
    <section class="card passport stack" id="passport-offer" aria-labelledby="passport-title">
      <div class="row top">
        <div class="swatch-pair" aria-hidden="true"><span style="background:${esc(p.skinHex)}"></span>${p.lipHex ? `<span style="background:${esc(p.lipHex)}"></span>` : ''}</div>
        <div class="grow">
          <h2 id="passport-title">Next time, skip the guesswork</h2>
          <p class="small" style="margin:6px 0 0;color:var(--fg-2)">Save your colour profile on this device and we'll mark the shades that suit you before you buy. It keeps two colour values plus "${esc(cap(p.depthLabel))} · ${esc(p.undertone)}". Never your photo, and never on our server.</p>
        </div>
      </div>
      <div class="btn-col">
        <button class="btn block" data-action="save-passport">Save my colour profile</button>
        <button class="btn ghost" data-action="skip-passport">No thanks</button>
      </div>
    </section>`;
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
  // Wall-clock time inside tool calls: parallel renders overlap, so merge their intervals.
  const spans = tools.map((t) => [Date.parse(t.at), Date.parse(t.at) + (t.ms || 0)]).sort((a, b) => a[0] - b[0]);
  let totalMs = 0;
  let end = -Infinity;
  for (const [a, b] of spans) {
    if (b > end) totalMs += b - Math.max(a, end);
    end = Math.max(end, b);
  }
  $trace.innerHTML = `
    <div class="trace-panel">
      <div class="row" style="justify-content:space-between"><h2>Agent trace</h2><button class="icon-btn" data-action="toggle-trace">Hide</button></div>
      <div class="sum"><span>${tools.length} tool calls</span><span title="Wall-clock time spent in tool calls (parallel previews overlap)">${(totalMs / 1000).toFixed(1)} s in tools</span><span>${s.unitsUsed} units</span><span>renders ${s.rendersUsed}/${s.maxRenders}</span><span>${s.mode === 'live' ? 'live API' : 'mock'}</span></div>
      <ol class="trace-list">
        ${s.trace
          .map((t, i) => {
            if (t.kind === 'decision') return `<li class="decision"><span class="n">→</span><span class="s">${esc(t.summary)}</span><span></span></li>`;
            if (t.kind === 'cleanup') return `<li class="decision"><span class="n">🗑</span><span class="s">${esc(t.summary)}</span><span></span></li>`;
            return `<li class="${t.ok ? '' : 'fail'}"><span class="n">${i + 1}</span><span><span class="tool">${esc(t.tool)}</span> <span class="s">${esc(t.summary)}</span></span><span class="meta">${t.ms} ms${t.units ? ` · ${t.units}u` : ''}${t.cached ? ' · cache' : ''}</span></li>`;
          })
          .join('')}
      </ol>
      <p class="muted small" style="margin:10px 0 0">No photos, colours or raw API output are logged.</p>
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
      if (!busyExtras(v)) stopPolling();
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
    state.addOn = null;
    state.captured = null;
    location.hash = `#/return/${v.id}`;
  },
  accept: () => sendEvent('accept_mirrormatch'),
  async back() {
    state.returnTo = null;
    // Re-read the server state: it is the source of truth (renders may have finished meanwhile).
    state.session = await api('GET', `/api/session/${state.session.id}`);
    renderSession();
  },
  'refund-review': () => {
    stopCamera();
    stopPolling();
    if (state.session.step === 'offer') {
      state.returnTo = null;
      return sendEvent('decline_mirrormatch');
    }
    state.returnTo = ['consent', 'capture', 'matches', 'tryon', 'escalated'].includes(state.session.step) ? state.session.step : null;
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
    updateCompare(state.session);
    updateExtras(state.session);
  },
  async 'look-lips'(el) {
    el.disabled = true;
    await sendEvent('look_lips', { dressId: el.dataset.pid });
    if (busyExtras(state.session)) startPolling();
  },
  async 'look-blush'(el) {
    el.disabled = true;
    await sendEvent('look_blush', { lipId: el.dataset.pid });
    if (busyExtras(state.session)) startPolling();
  },
  listen(el) {
    if (!canSpeak()) return;
    if (el.getAttribute('aria-pressed') === 'true') return stopSpeaking();
    stopSpeaking();
    const u = new SpeechSynthesisUtterance(resultsSpeech(state.session));
    u.rate = 0.98;
    u.onend = u.onerror = () => stopSpeaking();
    el.setAttribute('aria-pressed', 'true');
    el.querySelector('.lbl').textContent = 'Stop reading';
    window.speechSynthesis.speak(u);
  },
  'save-passport'() {
    const p = state.session?.profile || state.lastProfile;
    const card = document.getElementById('passport-offer');
    if (!p?.skinHex) return;
    const ok = writePassport({ skinHex: p.skinHex, lipHex: p.lipHex || null, hairHex: p.hairHex || null, depthLabel: p.depthLabel, undertone: p.undertone, kept: state.kept || null, savedAt: new Date().toISOString().slice(0, 10) });
    if (card) card.innerHTML = ok
      ? '<p style="margin:0"><b>Saved on this device.</b> Your orders page will now show shades picked for you. You can forget them there any time.</p>'
      : '<p style="margin:0">This browser blocks saving, so nothing was stored.</p>';
  },
  'skip-passport'() {
    document.getElementById('passport-offer')?.remove();
  },
  'forget-passport'() {
    writePassport(null);
    document.getElementById('passport-shelf')?.remove();
    toast('Your saved colours are gone from this device.');
  },
  async exchange(el) {
    stopPolling();
    const s = state.session;
    const p = s.picks.find((x) => x.product.id === el.dataset.pid)?.product;
    state.kept = p ? { category: s.returned.category, id: p.id, shadeName: p.shadeName, productLine: p.productLine, image: p.image } : null;
    await sendEvent('exchange', { productId: el.dataset.pid, ...(el.dataset.addon ? { addOnId: el.dataset.addon } : {}) });
  },
  escalate: () => sendEvent('escalate'),
  // YouCam's official sample photo (face for makeup, waist-up body for dresses). The original
  // bytes are sent unchanged, so repeat demo runs hit the server's photo-hash cache.
  async 'use-sample'(el) {
    el.disabled = true;
    try {
      const res = await fetch(`/api/samples/${encodeURIComponent(el.dataset.kind)}`);
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'The sample photo is unavailable. Please upload a photo instead.');
      state.captured = await sampleCapture(await res.blob(), el.dataset.kind);
      showCaptured();
      const img = document.querySelector('#capture-box img.preview');
      if (img) {
        img.alt = "YouCam's sample model photo";
        img.insertAdjacentHTML('afterend', '<span class="sample-tag">YouCam official sample image</span>');
      }
    } finally {
      el.disabled = false;
    }
  },
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
// Opt-in lipstick add-on (never pre-ticked): updates the exchange button's price line.
document.addEventListener('change', (e) => {
  if (e.target?.id !== 'addon-check') return;
  state.addOn = e.target.checked ? { lipId: e.target.dataset.lip, dressId: e.target.dataset.dress } : null;
  renderSticky(state.session);
});

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

/** A sample photo: light stats and the mock hint are computed exactly as for uploads (on the
 *  downscaled canvas), but the photo sent is the original file, byte for byte. */
async function sampleCapture(blob, kind) {
  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("We couldn't read the sample photo."));
      i.src = url;
    });
    const processed = processImage(img, img.naturalWidth, img.naturalHeight);
    const dataUrl = await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(new Error("We couldn't read the sample photo."));
      r.readAsDataURL(blob);
    });
    return { ...processed, dataUrl, width: img.naturalWidth, height: img.naturalHeight, sample: kind };
  } finally {
    URL.revokeObjectURL(url);
  }
}

boot().catch((e) => {
  $app.innerHTML = `<div class="card"><h1>Something went wrong</h1><p>${esc(e.message)}</p></div>`;
});

// =====================================================================================
// Embed mode (?embed=1) and the autopilot demo (?autoplay=lipstick|dress, or postMessage)
// Used by /workspace.html, which shows this app in a phone frame next to the agent console.
// Embed mode hides the app chrome and tells the parent which session is running. The
// autopilot plays a whole return by clicking the same buttons a person would, so it uses the
// same code paths; a person can take over at any moment.
// =====================================================================================
const params = new URLSearchParams(location.search);
const EMBED = params.has('embed');
const inFrame = window.parent !== window;

function loadExtraCss() {
  if (document.getElementById('embed-css')) return;
  const link = document.createElement('link');
  link.id = 'embed-css';
  link.rel = 'stylesheet';
  link.href = '/css/embed.css';
  document.head.appendChild(link);
}

function postToParent(msg) {
  if (inFrame) window.parent.postMessage({ source: 'mirrormatch-app', ...msg }, location.origin);
}

if (EMBED) {
  document.documentElement.classList.add('embed');
  // Hide the chrome at once (before the stylesheet arrives) so it never flashes.
  const hide = document.createElement('style');
  hide.textContent = 'html.embed .topbar, html.embed #trace, html.embed #trace-toggle { display: none !important; }';
  document.head.appendChild(hide);
  loadExtraCss();
  state.traceOpen = false; // the workspace shows the agent console instead
}

// Tell the workspace which session is on screen (id, step, status) whenever it changes.
if (inFrame) {
  let last = '';
  setInterval(() => {
    const s = state.session;
    const key = s ? `${s.id}|${s.step}|${s.status}` : 'none';
    if (key === last) return;
    last = key;
    postToParent({ type: 'session', id: s?.id ?? null, step: s?.step ?? 'orders', status: s?.status ?? null, category: s?.returned?.category ?? null });
  }, 300);
  postToParent({ type: 'ready' });
}

const autopilot = (() => {
  const FLOWS = {
    lipstick: { order: 'HH-10421', reason: 'wrong_shade', reasonText: "The shade didn't match", label: 'Lipstick' },
    dress: { order: 'HH-10307', reason: 'colour_didnt_suit', reasonText: "The colour didn't suit me", label: 'Dress', extra: 'look-lips' },
    hair: { order: 'HH-10455', reason: 'wrong_shade', reasonText: "The shade didn't match", label: 'Hair colour' },
    foundation: { order: 'HH-10388', reason: 'wrong_shade', reasonText: "The shade didn't match", label: 'Foundation', skin: true },
  };
  FLOWS.lipstick.extra = 'look-blush';
  let TOTAL = 12;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let run = null; // { flow, stopped, n }

  class Stopped extends Error {}
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const $q = (sel) => document.querySelector(sel);
  const visible = (el) => Boolean(el && el.isConnected && !el.closest('[hidden]') && el.getClientRects().length);

  function check() {
    if (!run || run.stopped) throw new Stopped();
  }

  /** About 1.2–1.8 s per step, so a viewer can follow along. */
  async function pause(ms = 1200 + ((run?.n ?? 0) % 4) * 200) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      check();
      await sleep(Math.min(100, end - Date.now()));
    }
    check();
  }

  async function waitFor(fn, what, timeoutMs = 150000) {
    const end = Date.now() + timeoutMs;
    for (;;) {
      check();
      const v = fn();
      if (v) return v;
      if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
      await sleep(150);
    }
  }

  function bar() {
    let el = document.getElementById('ap-bar');
    if (!el) {
      el = document.createElement('div');
      el.id = 'ap-bar';
      el.className = 'ap-bar';
      el.innerHTML = `
        <div class="ap-badge" role="group" aria-label="Autopilot demo">
          <span class="ap-dot" aria-hidden="true"></span>
          <span class="ap-title">Autopilot demo: choosing the top match</span>
          <button type="button" class="ap-stop" data-ap="stop">Stop</button>
        </div>
        <p class="ap-caption" ${inFrame ? 'aria-live="off"' : 'role="status" aria-live="polite"'}><span class="ap-n"></span><span class="ap-text"></span></p>`;
      document.body.appendChild(el);
      el.querySelector('[data-ap="stop"]').addEventListener('click', () => stop('user'));
    }
    return el;
  }

  function caption(text, { status = 'running', step = run?.n ?? 0 } = {}) {
    const el = bar();
    el.querySelector('.ap-n').textContent = status === 'running' && step ? `${step}/${TOTAL}` : '';
    el.querySelector('.ap-text').textContent = text;
    el.querySelector('.ap-stop').hidden = status !== 'running';
    postToParent({ type: 'autopilot', status, caption: text, step, total: TOTAL, flow: run?.flow ?? null });
  }

  function step(text) {
    run.n += 1;
    caption(text);
  }

  /** Scroll this document only (scrollIntoView would also scroll the workspace around the frame). */
  function reveal(el) {
    if (!el || el.closest('#sticky')) return;
    const r = el.getBoundingClientRect();
    const top = window.scrollY + r.top - Math.max(0, (window.innerHeight - r.height) / 2);
    window.scrollTo({ top: Math.max(0, top), behavior: reduced ? 'auto' : 'smooth' });
  }

  /** Point at a control for a moment, then press it the way a person would. */
  async function press(el, { wait = true } = {}) {
    check();
    reveal(el);
    el.classList.add('ap-target');
    if (wait) await pause();
    el.classList.remove('ap-target');
    check();
    el.click();
  }

  /** Stop politely if the agent took the return somewhere the autopilot shouldn't follow. */
  function screen() {
    const s = state.session;
    if (s && ['escalated', 'refunded', 'refund_review'].includes(s.step)) {
      throw new Error(s.step === 'escalated' ? 'the agent handed this return to a person' : 'the return went to refund');
    }
    if (s?.step === 'capture' && s.guidance) throw new Error('the photo needs a retake');
  }

  async function slide() {
    const range = $q('#compare-range');
    if (!range) return;
    const set = (v) => {
      range.value = String(Math.round(v));
      range.dispatchEvent(new Event('input', { bubbles: true }));
    };
    const stops = reduced ? [25, 75, 50] : [50, 14, 86, 50];
    let from = Number(range.value) || 50;
    for (const to of stops) {
      const t0 = performance.now();
      const dur = reduced ? 0 : 650;
      for (;;) {
        check();
        const k = dur ? Math.min(1, (performance.now() - t0) / dur) : 1;
        set(from + (to - from) * (1 - (1 - k) ** 3));
        if (k >= 1) break;
        await sleep(16);
      }
      from = to;
      await sleep(reduced ? 500 : 180);
    }
  }

  async function play(flowKey) {
    const flow = FLOWS[flowKey];
    if (!flow) return;
    if (run && !run.stopped) stop('restart', { quiet: true });
    run = { flow: flowKey, stopped: false, n: 0 };
    TOTAL = 12 + (flow.extra ? 1 : 0) + (flow.skin ? 1 : 0);
    const mine = run;
    loadExtraCss();
    document.documentElement.classList.add('autopilot');
    bar();
    try {
      step(`Opening the ${flow.label.toLowerCase()} order to return it`);
      if (location.hash !== '#/' && location.hash !== '') location.hash = '#/';
      const start = await waitFor(() => {
        const b = $q(`[data-action="start-return"][data-order="${flow.order}"]`);
        return visible(b) && b;
      }, 'the orders page', 20000);
      await press(start);

      step(`Choosing the reason: “${flow.reasonText}”`);
      const radio = await waitFor(() => $q(`#reason-form input[value="${flow.reason}"]`), 'the reason form', 20000);
      const choice = radio.closest('.choice');
      reveal(choice);
      choice?.classList.add('ap-target');
      await pause();
      choice?.classList.remove('ap-target');
      radio.checked = true;
      radio.dispatchEvent(new Event('change', { bubbles: true }));
      await pause(500);
      await press($q('#reason-form button[type="submit"]'), { wait: false });

      step('Accepting the offer: see a better match first (the refund stays one tap away)');
      await press(await waitFor(() => { screen(); return $q('[data-action="accept"]'); }, 'the offer', 20000));

      step('Giving consent: the photo is used only for this return, then deleted');
      await press(await waitFor(() => $q('[data-action="consent"]'), 'the consent step', 20000));

      step("Using YouCam's sample model photo");
      await press(await waitFor(() => $q('[data-action="use-sample"]'), 'the photo step', 20000));
      const submit = await waitFor(() => $q('[data-action="submit-photo"]'), 'the sample photo', 30000);

      step('Sending the photo: a free quality check, then skin-tone analysis');
      await press(submit);

      step("Waiting for YouCam's skin-tone analysis");
      await waitFor(() => { screen(); return $q('.tone-card'); }, 'the analysis');
      step('Reading the result: depth, undertone and the ranked matches');
      reveal($q('.tone-card'));
      await pause();

      if (flow.skin) {
        step("Reading YouCam's skin analysis: the right finish, not just the right shade");
        await waitFor(() => { screen(); return state.session?.skin?.status && state.session.skin.status !== 'running' && $q('#skin-card'); }, 'the skin analysis', 90000);
        reveal($q('#skin-card'));
        await pause(1800);
      }

      step('Rendering try-on previews on the same photo');
      reveal(document.getElementById('tryon-grid'));
      await waitFor(() => {
        screen();
        const s = state.session;
        if (!s?.renders?.length) return false;
        if (s.renders.some((r) => r.status === 'queued' || r.status === 'rendering')) return false;
        return !$q('.tryon .skeleton');
      }, 'the previews', 180000);
      await pause(600);

      step('Comparing before and after: only the colour changes');
      const card = $q('#compare-card');
      if (visible(card)) {
        reveal(card);
        await pause(700);
        await slide();
      }
      await pause(500);

      const top = state.session.picks[0]?.product;
      if (!top) throw new Error('there was no pick to exchange for');

      // Optional "complete the look" preview (one extra makeup call). Never adds anything to the order.
      if (flow.extra) {
        const btn = await waitFor(() => { const b = $q(`[data-action="${flow.extra}"]`); return b && !b.disabled && b; }, 'the look button', 30000).catch(() => null);
        if (btn) {
          step(flow.extra === 'look-lips'
            ? `Completing the look: a matching lipstick tried on over the ${top.shadeName} dress`
            : `Completing the look: ${top.shadeName} with a matching blush, in one makeup call`);
          await press(btn);
          await waitFor(() => {
            screen();
            const looks = state.session?.looks || [];
            return looks.length && looks.every((l) => l.status !== 'rendering') && $q('#look-card .look-result img');
          }, 'the look preview', 120000);
          reveal($q('#look-card'));
          await pause(2200);
        }
      }
      step(`Choosing the top match: ${top.shadeName}`);
      const sel = $q(`.tryon button.select[data-pid="${CSS.escape(top.id)}"]`);
      if (sel) await press(sel);

      step(`Exchanging for ${top.shadeName}: free, ships today`);
      const ex = await waitFor(() => {
        const b = $q('#sticky [data-action="exchange"]');
        return b && b.dataset.pid === top.id && b;
      }, 'the exchange button', 10000);
      await press(ex);
      await waitFor(() => state.session?.step === 'exchanged', 'the exchange', 30000);
      if (run !== mine) return;
      run.stopped = true;
      caption(`Done: exchanged for ${top.shadeName}. The photo and previews are deleted.`, { status: 'done' });
      setTimeout(() => finish(mine), 6000);
    } catch (e) {
      if (e instanceof Stopped || run !== mine) return;
      run.stopped = true;
      caption(`Autopilot stopped: ${e.message}. You're in control.`, { status: 'error' });
      setTimeout(() => finish(mine), 6000);
    }
  }

  function finish(which) {
    if (run !== which) return; // a newer run owns the bar
    document.getElementById('ap-bar')?.remove();
    document.documentElement.classList.remove('autopilot');
    document.querySelectorAll('.ap-target').forEach((el) => el.classList.remove('ap-target'));
  }

  function stop(why = 'user', { quiet = false } = {}) {
    if (!run || run.stopped) return;
    run.stopped = true;
    const was = run;
    document.querySelectorAll('.ap-target').forEach((el) => el.classList.remove('ap-target'));
    if (quiet) return;
    caption("Stopped. You're in control: every button works as usual.", { status: 'stopped' });
    setTimeout(() => finish(was), 2500);
  }

  // A person pressing any control in the app takes over from the autopilot.
  const takeOver = (e) => {
    if (!e.isTrusted || !run || run.stopped) return;
    if (e.target.closest?.('#ap-bar')) return;
    if (e.type === 'keydown' && !['Enter', ' '].includes(e.key)) return;
    if (e.target.closest?.('[data-action], button, a, input, label, select, .compare')) stop('user');
  };
  document.addEventListener('pointerdown', takeOver, true);
  document.addEventListener('keydown', takeOver, true);

  return { play, stop, running: () => Boolean(run && !run.stopped) };
})();

window.addEventListener('message', (e) => {
  if (e.origin !== location.origin || e.source !== window.parent) return;
  const m = e.data;
  if (!m || m.source !== 'mirrormatch-workspace') return;
  if (m.type === 'autopilot-start') autopilot.play(m.flow);
  if (m.type === 'autopilot-stop') autopilot.stop('user');
});

if (params.get('autoplay')) {
  // Start once the orders page has data.
  const flow = params.get('autoplay');
  const t = setInterval(() => {
    if (!state.orders) return;
    clearInterval(t);
    autopilot.play(flow);
  }, 150);
}
