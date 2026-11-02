// The MirrorMatch agent: a deterministic planner that decides the next step of a return from
// tool results, records a PII-free trace (step, tool, timing, units), and asks the optional
// LLM only to reword text. Every branch here is covered by unit tests.
import { copy } from './copy.js';
import { reword } from './llm.js';
import { ToolError } from './tools.js';
import { publicProduct } from '../store/catalog.js';
import { POLICY, REASONS, mirrorMatchEligibility, renderBudget, lookBudget, addOnPrice } from '../policy/policy.js';
import { skinSummary, foundationAdvice, skincareVariant } from '../color/skin.js';
import { createHash } from 'node:crypto';

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

export class Agent {
  constructor({ tools, sessions, catalog, events, youcam, meter, config, log = () => {} }) {
    Object.assign(this, { tools, sessions, catalog, events, youcam, meter, config, log });
  }

  // ---------- tracing ----------
  async call(session, tool, args) {
    const t0 = Date.now();
    const at = new Date().toISOString();
    try {
      const r = await this.tools[tool](args);
      const units = r.units ?? 0;
      session.unitsUsed += units;
      session.trace.push({ kind: 'tool', tool, at, ms: Date.now() - t0, units, ok: true, cached: Boolean(r.cached), summary: r.summary });
      return r.data;
    } catch (e) {
      session.trace.push({ kind: 'tool', tool, at, ms: Date.now() - t0, units: 0, ok: false, summary: e.code ?? e.message });
      throw e;
    }
  }

  decide(session, text) {
    session.trace.push({ kind: 'decision', at: new Date().toISOString(), summary: text });
  }

  // ---------- entry points ----------
  async start({ orderId, lineId }) {
    const session = this.sessions.create({ mode: this.youcam.mode });
    const { order, line, product } = await this.call(session, 'get_order', { orderId, lineId });
    Object.assign(session, { orderId: order.id, lineId: line.lineId, returnedId: product.id, step: 'reason' });
    this.events.add('return_started', { sessionId: session.id, productId: product.id, category: product.category, price: line.price });
    this.decide(session, 'Return opened; ask for the reason before offering anything.');
    return this.view(session);
  }

  async handle(sessionId, type, payload = {}) {
    const session = this.sessions.get(sessionId);
    if (!session) throw new ToolError('Session not found or expired', { code: 'session_not_found' });
    if (session.status !== 'active' && !['view'].includes(type)) return this.view(session);
    const handler = this[`on_${type}`];
    if (!handler) throw new ToolError(`Unknown event ${type}`, { code: 'bad_event' });
    await handler.call(this, session, payload);
    return this.view(session);
  }

  ctx(session) {
    const { order, line, product } = this.catalog.line(session.orderId, session.lineId);
    return { order, line, returned: product };
  }

  // ---------- events ----------
  async on_reason(session, { reason }) {
    const { order, returned } = this.ctx(session);
    if (!REASONS[reason]) throw new ToolError('Unknown reason', { code: 'bad_reason' });
    session.reason = reason;
    const elig = mirrorMatchEligibility({ reason, order, category: returned.category });
    if (elig.eligible) {
      session.step = 'offer';
      this.events.add('mirrormatch_offered', { sessionId: session.id, productId: session.returnedId, reason });
      this.decide(
        session,
        returned.category === 'skincare'
          ? `Reason "${reason}" fits skincare and is within ${POLICY.returnWindowDays} days → offer a skin reading (refund stays one tap away).`
          : `Reason "${reason}" is colour-related and within ${POLICY.returnWindowDays} days → offer MirrorMatch (refund stays one tap away).`,
      );
    } else {
      session.step = 'refund_review';
      session.notEligibleWhy = elig.why;
      this.decide(session, `Reason "${reason}" → ${elig.why}; standard refund path, no MirrorMatch.`);
    }
  }

  async on_accept_mirrormatch(session) {
    session.step = 'consent';
    this.events.add('mirrormatch_accepted', { sessionId: session.id, productId: session.returnedId });
  }

  async on_decline_mirrormatch(session) {
    session.step = 'refund_review';
    this.events.add('mirrormatch_declined', { sessionId: session.id, productId: session.returnedId });
  }

  async on_consent(session, { accepted }) {
    if (!accepted) {
      session.step = 'refund_review';
      return;
    }
    session.consent = true;
    session.step = 'capture';
  }

  async on_retake(session) {
    session.step = 'capture';
    session.guidance = null;
  }

  async on_photo(session, { image, width, height, stats, hint }) {
    if (!session.consent) throw new ToolError('Consent required before a photo', { code: 'no_consent' });
    const m = /^data:(image\/(?:jpeg|png));base64,(.+)$/s.exec(image || '');
    if (!m) throw new ToolError('Expected a JPEG or PNG data URL', { code: 'bad_image' });
    const buffer = Buffer.from(m[2], 'base64');
    if (buffer.length > MAX_IMAGE_BYTES) throw new ToolError('Image too large', { code: 'exceed_max_filesize' });
    session.photo = { buffer, mime: m[1], width: Number(width) || 0, height: Number(height) || 0, sha: createHash('sha256').update(buffer).digest('hex') };
    session.attempts.photo += 1;
    session.guidance = null;

    const q = await this.call(session, 'check_photo_quality', { photo: session.photo, stats });
    if (!q.ok) return this.needRetake(session, q.guidance, q.issues[0]);

    // Skincare reads the skin (YouCam skin analysis), not the skin tone, and has no try-on.
    if (this.ctx(session).returned.category === 'skincare') return this.skincarePhoto(session, hint);

    let tone;
    try {
      tone = await this.call(session, 'analyze_skin_tone', { session, hint: this.youcam.mode === 'mock' ? hint : undefined });
    } catch (e) {
      if (!(e instanceof ToolError)) throw e;
      if (e.code === 'unit_floor' || e.code === 'CreditInsufficiency') {
        return this.escalate(session, 'credit', copy.analysisFailed());
      }
      if (e.retake) return this.needRetake(session, e.guidance, e.code);
      session.attempts.analysis += 1;
      if (session.attempts.analysis >= POLICY.maxAnalysisFailures) {
        this.decide(session, `Analysis failed ${session.attempts.analysis}× (${e.code}) → escalate to a human.`);
        return this.escalate(session, 'analysis_failed', copy.analysisFailed());
      }
      return this.needRetake(session, e.guidance, e.code);
    }

    const profile = tone.profile;
    session.profile = profile;
    this.events.add('tone_analyzed', { sessionId: session.id, productId: session.returnedId, profileKey: profile.profileKey });

    const { order, returned } = this.ctx(session);
    const summaryDraft = copy.toneSummary(profile);
    const llmPromise = reword({
      purpose: 'kind skin-tone summary for a shopper',
      facts: { depth: profile.depthLabel, undertone: profile.undertone, lip: profile.lipDescriptor },
      fallback: summaryDraft,
      mustInclude: [profile.undertone],
    });

    const alt = await this.call(session, 'find_alternatives', { profile, returned });
    session.matches = alt;
    const picks = [];
    for (const cand of alt.ranked) {
      if (picks.length >= 2) break;
      const pol = await this.call(session, 'check_stock_and_policy', { order, returned, alternative: cand.product, reason: session.reason });
      if (pol.allowed) picks.push({ ...cand, policy: pol });
      else this.decide(session, `${cand.product.shadeName} blocked by policy → skip.`);
    }
    session.picks = picks;

    // The LLM only rewords text, so it never blocks the flow: the templated summary is shown
    // at once and swapped for the reworded one when (and if) it arrives within the timeout.
    session.toneSummary = summaryDraft;
    session.llmPending = true;
    llmPromise.then((llm) => {
      session.llmPending = false;
      if (llm.source === 'llm' && session.status === 'active') session.toneSummary = llm.text;
      session.trace.push({ kind: 'llm', tool: 'llm.reword', at: new Date().toISOString(), ms: llm.ms, units: 0, ok: llm.source === 'llm', summary: llm.source === 'llm' ? 'tone summary reworded (wording only)' : `template kept (${llm.why})` });
    });

    if (!picks.length || alt.confidence === 'low' || alt.confidence === 'none') {
      this.decide(session, `Match confidence ${alt.confidence} (best ${alt.ranked[0]?.score ?? '–'} vs returned ${alt.returnedScore}) → escalate instead of guessing.`);
      return this.escalate(session, 'low_confidence', copy.lowConfidence(returned), { keepPhoto: false });
    }
    this.decide(session, `Confidence ${alt.confidence}; ${picks.map((p) => p.product.shadeName).join(' + ')} pass stock & policy → show matches, then render returned + ${picks.length} picks (cap ${this.config.budget.maxRendersPerReturn}).`);
    session.step = 'matches';
    if (returned.category === 'foundation') this.startSkinToday(session, hint);
  }

  /** Foundation: a skin reading in the background (9 units) to advise finish and coverage.
   *  It never blocks the matches, the exchange or the refund; if it fails, the card is skipped. */
  startSkinToday(session, hint) {
    session.skin = { status: 'running' };
    this.decide(session, 'Foundation return → also read the skin (SD skin analysis, 4 concerns) to advise finish and coverage; runs alongside the previews.');
    const p = this.call(session, 'analyze_skin', { session, hint: this.youcam.mode === 'mock' ? hint : undefined })
      .then(({ skin }) => {
        const advice = foundationAdvice(skin);
        session.skin = { status: 'done', reading: skin, ...skinSummary(skin), advice };
        this.decide(session, `Skin reading → ${advice.finish} finish, ${advice.coverage} coverage for the matched shade (rules, not a diagnosis).`);
      })
      .catch((e) => {
        session.skin = { status: 'failed', message: "We couldn't read your skin from this photo, so we'll skip the finish tips. Your shade match doesn't depend on it." };
        this.decide(session, `Skin reading unavailable (${e.code ?? 'error'}) → keep the shade match, skip the finish advice.`);
      });
    session.pending = [...(session.pending ?? []), p];
  }

  /** Skincare return ("It didn't suit my skin"): skin analysis → texture variant by rule → exchange. */
  async skincarePhoto(session, hint) {
    let skin;
    try {
      ({ skin } = await this.call(session, 'analyze_skin', { session, hint: this.youcam.mode === 'mock' ? hint : undefined }));
    } catch (e) {
      if (!(e instanceof ToolError)) throw e;
      if (e.code === 'unit_floor' || e.code === 'CreditInsufficiency') return this.escalate(session, 'credit', copy.skinAnalysisFailed());
      if (e.retake) return this.needRetake(session, e.guidance, e.code);
      session.attempts.analysis += 1;
      if (session.attempts.analysis >= POLICY.maxAnalysisFailures) {
        this.decide(session, `Skin analysis failed ${session.attempts.analysis}× (${e.code}) → escalate to a human.`);
        return this.escalate(session, 'analysis_failed', copy.skinAnalysisFailed());
      }
      return this.needRetake(session, e.guidance, e.code);
    }
    const rec = skincareVariant(skin);
    session.skin = { status: 'done', reading: skin, ...skinSummary(skin), variant: rec };
    const { order, returned } = this.ctx(session);
    const alt = await this.call(session, 'find_alternatives', { profile: { skin }, returned });
    session.matches = alt;
    const picks = [];
    for (const cand of alt.ranked) {
      if (picks.length >= 2) break;
      // Only offer textures that suit today's reading better than the one being returned.
      if (!(cand.score < alt.returnedScore)) continue;
      const pol = await this.call(session, 'check_stock_and_policy', { order, returned, alternative: cand.product, reason: session.reason });
      if (pol.allowed) picks.push({ ...cand, policy: pol });
      else this.decide(session, `${cand.product.shadeName} blocked by policy → skip.`);
    }
    session.picks = picks;
    if (!picks.length || alt.confidence === 'low' || alt.confidence === 'none') {
      this.decide(session, `Skin reading suggests "${rec.variant}"; nothing in stock clearly suits better than ${returned.shadeName} → escalate to a skincare specialist instead of guessing.`);
      return this.escalate(session, 'low_confidence', copy.skincareLowConfidence(returned));
    }
    this.decide(session, `Skin reading → "${rec.variant}" by rule; ${picks.map((p) => p.product.shadeName).join(' + ')} pass stock & policy → show the reading and the exchange (no try-on for skincare).`);
    session.step = 'matches';
  }

  needRetake(session, guidance, code) {
    session.step = 'capture';
    session.guidance = guidance;
    this.events.add('photo_retake', { sessionId: session.id, code });
    if (session.attempts.photo >= POLICY.maxPhotoAttempts) {
      session.canEscalate = true;
      this.decide(session, `${session.attempts.photo} photo attempts → offer a human specialist alongside retake and refund.`);
    } else {
      this.decide(session, `Photo not usable (${code}) → friendly guidance, retake.`);
    }
  }

  async escalate(session, code, why, { keepPhoto = false } = {}) {
    const esc = await this.call(session, 'escalate_to_human', { session, why, code });
    session.escalation = { ...esc, message: copy.escalated(esc.ticket, why, this.catalog.product(session.returnedId)?.category) };
    session.step = 'escalated';
    if (!keepPhoto) this.end(session, 'escalated', { keepActive: true });
  }

  async on_render(session) {
    if (session.renders.length) return; // already started: renders are idempotent per session
    if (!session.photo) throw new ToolError('Photo no longer available', { code: 'photo_deleted' });
    const { returned } = this.ctx(session);
    if (returned.category === 'skincare') return; // no try-on for skincare
    const queue = [
      { role: 'returned', product: returned },
      ...session.picks.map((p, i) => ({ role: `pick${i + 1}`, product: p.product })),
    ];
    const allowed = Math.min(queue.length, renderBudget(session.rendersUsed), this.config.budget.maxRendersPerReturn);
    queue.forEach((q, i) => {
      session.renders.push({ id: null, productId: q.product.id, role: q.role, status: i < allowed ? 'queued' : 'skipped', units: 0, cached: false });
    });
    session.step = 'tryon';
    const jobs = queue.slice(0, allowed).map((q, i) => this.renderOne(session, q, session.renders[i]));
    session.renderPromise = Promise.allSettled(jobs).then(() => {
      const done = session.renders.filter((r) => r.status === 'done').length;
      this.events.add('renders_done', { sessionId: session.id, productId: session.returnedId, count: done });
      this.decide(session, `${done}/${session.renders.length} previews ready; ${session.unitsUsed} units used this return.`);
    });
  }

  async renderOne(session, q, slot) {
    slot.status = 'rendering';
    try {
      const r = await this.call(session, 'render_tryon', { session, product: q.product, role: q.role });
      Object.assign(slot, { id: r.renderId, status: 'done', cached: r.cached, buffer: r.buffer, contentType: r.contentType, feature: r.feature });
    } catch (e) {
      Object.assign(slot, { status: 'failed', error: e.guidance ?? 'Preview unavailable, but you can still choose from the swatches.' });
    }
  }

  // ---------- "complete the look" (opt-in extras, never required for the exchange or refund) ----------
  looks(session) {
    return session.renders.filter((r) => r.role === 'look');
  }

  /** Lips for the new dress: pick a lipstick for the shopper + the chosen colourway, then put it on
   *  the clothes try-on render with makeup-vto (the render is uploaded as a new file). */
  async on_look_lips(session, { dressId }) {
    const { returned } = this.ctx(session);
    if (returned.category !== 'dress' || !session.profile) throw new ToolError('Lips preview is for dress returns', { code: 'bad_event' });
    const pick = session.picks.find((p) => p.product.id === dressId);
    if (!pick) throw new ToolError('That colourway was not offered', { code: 'not_offered' });
    if (this.looks(session).some((l) => l.kind === 'lips_dress' && l.dressId === dressId)) return; // idempotent
    const render = session.renders.find((r) => r.role !== 'look' && r.productId === dressId);
    if (!(render?.status === 'done' && render.buffer)) throw new ToolError('The dress preview is not ready yet', { code: 'render_not_ready', guidance: 'The dress preview is still loading. Try again in a moment.' });
    if (lookBudget(session.looksUsed) <= 0) {
      this.decide(session, `Look preview cap (${POLICY.maxLookRendersPerReturn}) reached → no more extras; exchange and refund unaffected.`);
      throw new ToolError('Look preview limit reached', { code: 'look_cap', guidance: 'That is all the extra previews for this return. Your exchange and refund are unaffected.' });
    }
    const { pick: lip } = await this.call(session, 'pair_lip_with_dress', { profile: session.profile, dress: pick.product });
    const addOn = addOnPrice(lip.product);
    const slot = {
      id: null,
      role: 'look',
      kind: 'lips_dress',
      productId: `look:lips:${dressId}`,
      dressId,
      lipId: lip.product.id,
      lipReason: lip.reason,
      addOn,
      status: 'rendering',
      units: 0,
      cached: false,
    };
    session.renders.push(slot);
    this.decide(session, `Shopper asked to complete the ${pick.product.shadeName} look → ${lip.product.shadeName} by rule; render lips on the dress preview (1 makeup-vto unit, extras cap ${POLICY.maxLookRendersPerReturn}). Add-on stays opt-in and priced.`);
    this.runLook(session, slot, { kind: 'lips_dress', lip: lip.product, sourceBuffer: render.buffer, sourceType: render.contentType, label: `lips ${lip.product.shadeName} on the ${pick.product.shadeName} dress` });
  }

  /** Lipstick + matching blush in one makeup-vto call on the selfie. Styling idea only. */
  async on_look_blush(session, { lipId }) {
    const { returned } = this.ctx(session);
    if (returned.category !== 'lipstick' || !session.profile) throw new ToolError('Blush preview is for lipstick returns', { code: 'bad_event' });
    const pick = session.picks.find((p) => p.product.id === lipId);
    if (!pick) throw new ToolError('That shade was not offered', { code: 'not_offered' });
    if (this.looks(session).some((l) => l.kind === 'lip_blush' && l.lipId === lipId)) return; // idempotent
    if (!session.photo) throw new ToolError('Photo no longer available', { code: 'photo_deleted' });
    if (lookBudget(session.looksUsed) <= 0) {
      this.decide(session, `Look preview cap (${POLICY.maxLookRendersPerReturn}) reached → no more extras; exchange and refund unaffected.`);
      throw new ToolError('Look preview limit reached', { code: 'look_cap', guidance: 'That is all the extra previews for this return. Your exchange and refund are unaffected.' });
    }
    const blush = await this.call(session, 'pair_blush_with_lip', { profile: session.profile, lip: pick.product });
    const slot = { id: null, role: 'look', kind: 'lip_blush', productId: `look:blush:${lipId}`, lipId, blush, status: 'rendering', units: 0, cached: false };
    session.renders.push(slot);
    this.decide(session, `Shopper asked for a matching blush → ${blush.name} paired with ${pick.product.shadeName} by rule; lip + blush in one makeup-vto call (1 unit).`);
    this.runLook(session, slot, { kind: 'lip_blush', lip: pick.product, blush, label: `${pick.product.shadeName} + ${blush.name} blush` });
  }

  runLook(session, slot, args) {
    const p = this.call(session, 'render_look', { session, ...args })
      .then((r) => Object.assign(slot, { id: r.renderId, status: 'done', cached: r.cached, buffer: r.buffer, contentType: r.contentType, feature: 'makeup-vto' }))
      .catch((e) => {
        Object.assign(slot, { status: 'failed', error: e.guidance ?? 'This preview is unavailable, but your exchange and refund are unaffected.' });
        this.decide(session, `Look preview failed (${e.code ?? 'error'}) → show a friendly note; exchange and refund unaffected.`);
      });
    session.pending = [...(session.pending ?? []), p];
  }

  async on_exchange(session, { productId, addOnId }) {
    const { order, returned } = this.ctx(session);
    const pick = session.picks.find((p) => p.product.id === productId);
    if (!pick) throw new ToolError('That product was not offered', { code: 'not_offered' });
    let addOn = null;
    if (addOnId) {
      // Only a lipstick the shopper saw in a "complete the look" preview, and only when they opted in.
      const look = this.looks(session).find((l) => l.kind === 'lips_dress' && l.lipId === addOnId);
      if (!look) throw new ToolError('That add-on was not offered', { code: 'not_offered' });
      addOn = this.catalog.product(addOnId);
      if (!addOnPrice(addOn).allowed) {
        session.guidance = 'Sorry, that lipstick just sold out. Your exchange is still available without it.';
        return;
      }
      this.decide(session, `Shopper opted in to the paid add-on ${addOn.shadeName} ($${addOn.price}); the exchange itself stays free.`);
    }
    const pol = await this.call(session, 'check_stock_and_policy', { order, returned, alternative: pick.product, reason: session.reason });
    if (!pol.allowed) {
      session.guidance = 'Sorry, that item just became unavailable. Please pick another option or take the refund.';
      this.decide(session, 'Policy re-check failed at exchange time → keep shopper on the offer with an explanation.');
      return;
    }
    const exchange = await this.call(session, 'create_exchange', { session, order, returned, alternative: pick.product, price: pol.price, addOn });
    session.exchange = { ...exchange, message: copy.exchanged(exchange) };
    session.step = 'exchanged';
    this.decide(session, `Exchange ${exchange.id} created → end session, delete photo and YouCam tasks.`);
    this.end(session, 'exchange');
  }

  async on_refund(session) {
    const { line } = this.ctx(session);
    this.events.add('refund_chosen', { sessionId: session.id, productId: session.returnedId, value: line.price });
    session.refund = { amount: line.price, message: copy.refunded(line.price) };
    session.step = 'refunded';
    this.decide(session, 'Shopper chose refund → refund immediately, no friction; end session.');
    this.end(session, 'refund');
  }

  async on_escalate(session) {
    await this.escalate(session, 'customer_request', 'You asked to talk to a person.');
  }

  async on_delete_photo(session) {
    this.sessions.wipePersonalData(session);
    this.deleteRemoteTasks(session);
    session.guidance = copy.photoDeleted();
  }

  // ---------- teardown ----------
  end(session, outcome, { keepActive = false } = {}) {
    session.outcome = outcome;
    if (!keepActive) session.status = 'ended';
    const finish = () => {
      this.sessions.wipePersonalData(session);
      this.deleteRemoteTasks(session);
      this.refreshBalance();
    };
    // Wait for in-flight renders, skin readings and look previews so their tasks are deleted too.
    const inFlight = [session.renderPromise, ...(session.pending ?? [])].filter(Boolean);
    if (inFlight.length) Promise.allSettled(inFlight).finally(finish);
    else finish();
  }

  deleteRemoteTasks(session) {
    if (!this.config.youcam.deleteTasksOnEnd) return;
    const ids = session.taskIds.splice(0);
    if (!ids.length) return;
    Promise.all(ids.map((id) => this.youcam.deleteTask(id))).then((res) => {
      const n = res.filter(Boolean).length;
      session.trace.push({ kind: 'cleanup', at: new Date().toISOString(), summary: `deleted ${n}/${ids.length} YouCam tasks (inputs + outputs)` });
    });
  }

  async refreshBalance() {
    try {
      const c = await this.youcam.getCredit();
      this.meter.setBalance(c.total);
    } catch {
      /* balance refresh is best-effort */
    }
  }

  // ---------- public view (no photo bytes, no raw API output) ----------
  view(session) {
    const ctx = session.orderId ? this.ctx(session) : null;
    const p = session.profile;
    return {
      id: session.id,
      status: session.status,
      step: session.step,
      mode: session.mode,
      reason: session.reason,
      order: ctx ? { id: ctx.order.id, deliveredOn: ctx.order.deliveredOn, price: ctx.line.price } : null,
      returned: ctx ? publicProduct(ctx.returned) : null,
      notEligibleWhy: session.notEligibleWhy ?? null,
      guidance: session.guidance ?? null,
      canEscalate: Boolean(session.canEscalate),
      attempts: session.attempts,
      hasPhoto: Boolean(session.photo),
      photoDeletedAt: session.photoDeletedAt ?? null,
      profile: p
        ? {
            depthLabel: p.depthLabel,
            depthGroup: p.depthGroup,
            undertone: p.undertone,
            contrast: p.contrast,
            profileLabel: p.profileLabel,
            skinHex: p.skinHex,
            lipHex: p.lipHex,
            eyeName: p.eyeName,
            hairName: p.hairName,
            summary: session.toneSummary ?? copy.toneSummary(p),
          }
        : null,
      matches: session.matches
        ? {
            confidence: session.matches.confidence,
            returnedScore: session.matches.returnedScore,
            returnedCaution: session.matches.returnedCaution,
            returnedReason: session.matches.returnedReason,
            intro: ctx ? copy.matchesIntro(ctx.returned, session.picks.map((x) => x.product)) : '',
          }
        : null,
      picks: session.picks.map((x) => ({
        product: publicProduct(x.product),
        score: x.score,
        deltaE: x.deltaE,
        reason: x.reason,
        caution: x.caution,
        price: x.policy.price,
        offer: copy.offer(x.product, x.policy.price),
      })),
      renders: session.renders.filter((r) => r.role !== 'look').map((r) => ({
        role: r.role,
        productId: r.productId,
        status: r.status,
        cached: r.cached,
        error: r.error ?? null,
        url: r.status === 'done' && r.buffer ? `/api/session/${session.id}/render/${r.id}` : null,
      })),
      rendersUsed: session.rendersUsed,
      maxRenders: this.config.budget.maxRendersPerReturn,
      // "Your skin today" (foundation and skincare): kind chips + advice, never raw scores.
      skin: session.skin
        ? {
            status: session.skin.status,
            chips: session.skin.chips ?? [],
            text: session.skin.text ?? null,
            note: session.skin.note ?? null,
            advice: session.skin.advice ?? null,
            variant: session.skin.variant ?? null,
            message: session.skin.message ?? null,
          }
        : null,
      // "Complete the look" previews (opt-in extras).
      looks: this.looks(session).map((l) => ({
        kind: l.kind,
        dressId: l.dressId ?? null,
        lipId: l.lipId,
        lip: l.lipId ? publicProduct(this.catalog.product(l.lipId)) : null,
        lipReason: l.lipReason ?? null,
        blush: l.blush ?? null,
        addOn: l.addOn ?? null,
        status: l.status,
        cached: l.cached,
        error: l.error ?? null,
        url: l.status === 'done' && l.buffer ? `/api/session/${session.id}/render/${l.id}` : null,
      })),
      looksUsed: session.looksUsed ?? 0,
      maxLooks: POLICY.maxLookRendersPerReturn,
      unitsUsed: session.unitsUsed,
      exchange: session.exchange ?? null,
      refund: session.refund ?? null,
      escalation: session.escalation ? { ticket: session.escalation.ticket, message: session.escalation.message, code: session.escalation.code } : null,
      trace: session.trace,
      copy: {
        consent: copy.consent(),
        capture: ctx ? copy.capture(ctx.returned.category) : '',
        offer: ctx ? copy.offerMirrorMatch(ctx.returned) : '',
        reasonPrompt: ctx ? copy.reasonPrompt(ctx.returned) : '',
        notEligible: session.notEligibleWhy ? copy.notEligible(session.notEligibleWhy) : '',
        tryonLabel: copy.tryonLabel(),
      },
    };
  }
}
