// The agent's tools. Each tool is a plain async function with a name, so the orchestrator
// can call it, time it, meter its units and record a PII-free trace line.
// Tools: get_order, check_photo_quality, analyze_skin_tone, find_alternatives,
//        render_tryon, check_stock_and_policy, create_exchange, escalate_to_human,
//        analyze_skin, pair_lip_with_dress, pair_blush_with_lip, render_look
import { createHash, randomUUID } from 'node:crypto';
import { buildToneProfile } from '../color/tone.js';
import { findAlternatives } from '../color/match.js';
import { SKIN_ACTIONS, readSkin, skinSignals } from '../color/skin.js';
import { lipsForDress, blushForLip } from '../color/pairing.js';
import { checkStockAndPolicy, renderBudget, lookBudget, addOnPrice } from '../policy/policy.js';
import { qualityIssues, guidanceFor, YouCamError } from '../youcam/errors.js';
import { resultUrl } from '../youcam/client.js';
import { publicProduct } from '../store/catalog.js';

export class ToolError extends Error {
  constructor(message, { code, guidance, retake = false, escalate = false } = {}) {
    super(message);
    this.code = code;
    this.guidance = guidance;
    this.retake = retake;
    this.escalate = escalate;
  }
}

export function createTools({ youcam, meter, catalog, events, config, demoCache, garmentFiles }) {
  const sha = (buf) => createHash('sha256').update(buf).digest('hex');

  async function ensureUploaded(session) {
    if (session.youcamFileId && session.youcamFileSha === session.photo.sha) return { fileId: session.youcamFileId, uploaded: false };
    // Parallel callers (3 renders + skin analysis) share one in-flight upload of the same photo.
    if (session.uploading?.sha === session.photo.sha) return { fileId: await session.uploading.promise, uploaded: false };
    const photoSha = session.photo.sha;
    const promise = youcam.uploadImage(session.photo.buffer, {
      contentType: session.photo.mime,
      fileName: session.photo.mime === 'image/png' ? 'photo.png' : 'photo.jpg',
    });
    session.uploading = { sha: photoSha, promise };
    try {
      const fileId = await promise;
      session.youcamFileId = fileId;
      session.youcamFileSha = photoSha;
      return { fileId, uploaded: true };
    } finally {
      session.uploading = null;
    }
  }

  function budgetCheck(feature) {
    const cost = meter.costOf(feature);
    if (meter.balance !== null && meter.balance - cost < config.budget.unitFloor) {
      throw new ToolError('Unit balance is below the safety floor', { code: 'unit_floor', ...guidanceObj('unit_floor') });
    }
    if (config.budget.dailyUnitCap > 0 && meter.spentToday + cost > config.budget.dailyUnitCap) {
      throw new ToolError('Daily unit cap reached', { code: 'unit_floor', ...guidanceObj('unit_floor') });
    }
  }

  const guidanceObj = (code) => {
    const g = guidanceFor(code);
    return { guidance: g.message, retake: g.retake };
  };

  return {
    async get_order({ orderId, lineId }) {
      const found = catalog.line(orderId, lineId);
      if (!found) throw new ToolError('Order not found', { code: 'order_not_found' });
      return {
        data: found,
        summary: `order ${found.order.id}: ${found.product.productLine} · ${found.product.shadeName} ($${found.line.price})`,
      };
    },

    /** Pre-flight checks that cost nothing. The face itself is confirmed by analyze_skin_tone. */
    async check_photo_quality({ photo, stats }) {
      const issues = [];
      if (!['image/jpeg', 'image/png'].includes(photo.mime)) issues.push('error_decode_image');
      if (photo.buffer.length > 10 * 1024 * 1024) issues.push('exceed_max_filesize');
      if (Math.min(photo.width || 0, photo.height || 0) < 320) issues.push('error_below_min_image_size');
      if (stats) {
        if (stats.meanLuma < 55 || stats.meanLuma > 225 || stats.clippedPct > 30 || stats.contrast < 12) issues.push('lighting');
      }
      const ok = issues.length === 0;
      return {
        data: { ok, issues, guidance: ok ? null : guidanceFor(issues[0]).message },
        summary: ok ? `passed (${photo.width}×${photo.height}, luma ${stats?.meanLuma ?? 'n/a'})` : `failed: ${issues.join(', ')}`,
      };
    },

    async analyze_skin_tone({ session, hint }) {
      const cacheKey = `tone:${session.photo.sha}`;
      const cached = session.toneCache?.[cacheKey] ?? (await demoCache.getJson(cacheKey));
      let color;
      let faceQuality;
      let units = 0;
      let cachedHit = false;
      let taskId = null;
      if (cached) {
        ({ color, faceQuality } = cached);
        cachedHit = true;
      } else {
        budgetCheck('skin-tone-analysis');
        const { fileId } = await ensureUploaded(session);
        // Verified live: a waist-up photo (needed by cloth-v4) passes analysis at "low"
        // strictness but fails at "high" with error_face_angle_downward.
        const isDress = catalog.product(session.returnedId)?.category === 'dress';
        const strictness = isDress ? 'low' : config.youcam.faceAngleStrictness;
        try {
          const r = await youcam.runAndWait(
            'skin-tone-analysis',
            { src_file_id: fileId, face_angle_strictness_level: strictness },
            { sessionId: session.id, hint },
          );
          taskId = r.taskId;
          if (r.taskId) session.taskIds.push(r.taskId);
          units = r.units;
          if (r.via === 'mcp') session.toneVia = 'mcp';
          color = r.data.results?.color;
          faceQuality = r.data.results?.face_quality;
        } catch (e) {
          if (e.taskId) session.taskIds.push(e.taskId);
          if (e instanceof YouCamError) {
            const g = guidanceFor(e.code);
            throw new ToolError(`skin-tone-analysis failed: ${e.code}`, { code: e.code, guidance: g.message, retake: g.retake });
          }
          throw e;
        }
        session.toneCache = { ...(session.toneCache ?? {}), [cacheKey]: { color, faceQuality } };
        await demoCache.setJson(cacheKey, { color, faceQuality });
      }
      const issues = qualityIssues(faceQuality);
      // No face or no colour reading: ask for a retake. A reading with only soft quality flags
      // (light, size, angle) is kept with a note: the units are already spent and the result is usable.
      if (!color?.skin_color || issues.includes('error_no_face')) {
        const code = issues.includes('error_no_face') || !color?.skin_color ? 'error_no_face' : issues[0];
        const g = guidanceFor(code);
        throw new ToolError(`face quality: ${[...new Set([code, ...issues])].join(', ')}`, { code, guidance: g.message, retake: true });
      }
      const profile = buildToneProfile(color);
      return {
        data: { profile, faceQuality, qualityIssues: issues, cached: cachedHit, taskId },
        units,
        cached: cachedHit,
        summary: `${profile.profileLabel} (ITA ${profile.ita}°, hue ${profile.hueAngle}°, contrast ${profile.contrast})${cachedHit ? ' [cache]' : session.toneVia === 'mcp' ? ' over MCP' : ''}`,
      };
    },

    async find_alternatives({ profile, returned }) {
      const r = findAlternatives({ profile, returned, products: catalog.products, limit: 3 });
      const top = r.ranked.map((x) => `${x.product.shadeName} ${x.score}`).join(', ');
      return {
        data: r,
        summary: `considered ${r.consideredCount}, excluded ${r.excluded.length} (${summarizeExcluded(r.excluded)}); top: ${top || 'none'}; returned scores ${r.returnedScore}; confidence ${r.confidence}`,
      };
    },

    async check_stock_and_policy({ order, returned, alternative, reason }) {
      const r = checkStockAndPolicy({ order, returned, alternative, reason });
      return {
        data: r,
        summary: `${alternative.shadeName}: ${r.allowed ? 'allowed' : 'blocked'} (${r.checks.filter((c) => !c.ok).map((c) => c.rule).join(', ') || r.price.type})`,
      };
    },

    async render_tryon({ session, product, role }) {
      if (renderBudget(session.rendersUsed) <= 0) {
        throw new ToolError('Render cap reached for this return', { code: 'render_cap' });
      }
      const feature = product.category === 'dress' ? config.youcam.clothFeature : product.category === 'hair' ? 'hair-color' : 'makeup-vto';
      // Hair renders key on their params too (photo hash + feature + params), so a tuning change
      // never serves a stale render. Existing keys are unchanged so the demo cache stays valid.
      const cacheKey =
        product.category === 'hair'
          ? `render:${session.photo.sha}:${feature}:${product.id}:${paramsKey(hairPalette(product))}`
          : `render:${session.photo.sha}:${feature}:${product.id}`;
      const inSession = session.renderCache?.[cacheKey];
      const onDisk = inSession ? null : await demoCache.getBinary(cacheKey);
      const renderId = randomUUID().slice(0, 8);
      if (inSession || onDisk) {
        const hit = inSession ?? onDisk;
        return {
          data: { renderId, buffer: hit.buffer, contentType: hit.contentType, cached: true, feature },
          units: 0,
          cached: true,
          summary: `${role}: ${product.shadeName} via ${feature} [cache, 0 units]`,
        };
      }
      budgetCheck(feature);
      const { fileId } = await ensureUploaded(session);
      let body;
      if (product.category === 'lipstick') {
        body = {
          src_file_id: fileId,
          version: '1.0',
          effects: [
            // No smoothing: the preview should show the shade, not retouch the shopper.
            { category: 'skin_smooth', skinSmoothStrength: 0, skinSmoothColorIntensity: 0 },
            {
              category: 'lip_color',
              shape: { name: 'original' },
              style: { type: 'full' },
              palettes: [{ color: product.hex, texture: 'matte', colorIntensity: 75 }],
            },
          ],
        };
      } else if (product.category === 'foundation') {
        body = {
          src_file_id: fileId,
          version: '1.0',
          effects: [
            { category: 'skin_smooth', skinSmoothStrength: 0, skinSmoothColorIntensity: 0 },
            { category: 'foundation', palettes: [{ color: product.hex, colorIntensity: 60, glowIntensity: 10, coverageIntensity: 55 }] },
          ],
        };
      } else if (product.category === 'hair') {
        // AI Hair Color, full colour (not ombre), with the kit's exact hex.
        body = { src_file_id: fileId, pattern: { name: 'full' }, palettes: [hairPalette(product)] };
      } else {
        const refId = await garmentFiles.fileIdFor(product, session);
        body = { src_file_id: fileId, ref_file_id: refId, garment_category: config.youcam.garmentCategory };
      }
      session.rendersUsed += 1; // counts against the cap even if it fails, to bound spend
      let r;
      try {
        r = await youcam.runAndWait(feature, body, { sessionId: session.id });
      } catch (e) {
        if (e.taskId) session.taskIds.push(e.taskId);
        const g = guidanceFor(e.code);
        throw new ToolError(`${feature} failed: ${e.code}`, { code: e.code, guidance: g.message, retake: false });
      }
      if (r.taskId) session.taskIds.push(r.taskId);
      const url = resultUrl(r.data);
      if (!url) throw new ToolError('Render returned no image', { code: 'no_result' });
      const dl = await youcam.download(url);
      session.renderCache = { ...(session.renderCache ?? {}), [cacheKey]: dl };
      await demoCache.setBinary(cacheKey, dl);
      return {
        data: { renderId, buffer: dl.buffer, contentType: dl.contentType, cached: false, feature, ms: r.ms },
        units: r.units,
        summary: `${role}: ${product.shadeName} via ${feature}${r.via === 'mcp' ? ' over MCP' : ''} (${r.units} unit${r.units === 1 ? '' : 's'})`,
      };
    },

    /**
     * YouCam AI Skin Analysis (SD, 4 concerns, 9 units): oiliness, moisture, redness, skin type.
     * Used to advise a foundation finish and coverage, and to choose a moisturiser texture.
     * Cached per photo hash + feature + concerns. Never preceded by lighting or enhance.
     */
    async analyze_skin({ session, hint }) {
      const cacheKey = `skin:${session.photo.sha}:skin-analysis:${SKIN_ACTIONS.join(',')}`;
      const cached = session.skinCache?.[cacheKey] ?? (await demoCache.getJson(cacheKey));
      let results;
      let units = 0;
      let via = '';
      if (cached) {
        results = cached;
      } else {
        // SD skin analysis needs a short side of at least 480 px (docs); fail free, before upload.
        if (Math.min(session.photo.width || 0, session.photo.height || 0) < 480) {
          throw new ToolError('photo too small for skin analysis', { code: 'error_below_min_image_size', ...guidanceObj('error_below_min_image_size') });
        }
        budgetCheck('skin-analysis');
        const { fileId } = await ensureUploaded(session);
        try {
          const r = await youcam.runAndWait(
            'skin-analysis',
            { src_file_id: fileId, dst_actions: SKIN_ACTIONS, format: 'json', miniserver_args: { enable_mask_overlay: false } },
            { sessionId: session.id, hint },
          );
          if (r.taskId) session.taskIds.push(r.taskId);
          units = r.units;
          via = r.via === 'mcp' ? ' over MCP' : '';
          // Keep only the scores and skin-type labels: no mask URLs.
          results = { output: (r.data.results?.output ?? []).map(({ type, region, raw_score, ui_score, skin_type }) => ({ type, region, raw_score, ui_score, skin_type })) };
        } catch (e) {
          if (e.taskId) session.taskIds.push(e.taskId);
          if (e instanceof YouCamError) {
            const g = guidanceFor(e.code);
            throw new ToolError(`skin-analysis failed: ${e.code}`, { code: e.code, guidance: g.message, retake: g.retake });
          }
          throw e;
        }
        session.skinCache = { ...(session.skinCache ?? {}), [cacheKey]: results };
        await demoCache.setJson(cacheKey, results);
      }
      const skin = readSkin(results);
      if (skin.scores.oiliness == null && skin.scores.moisture == null && !skin.skinType) {
        throw new ToolError('skin-analysis returned no scores', { code: 'no_result', guidance: guidanceFor('no_result').message });
      }
      const g = skinSignals(skin);
      const flags = Object.entries(g).filter(([, v]) => v).map(([k]) => k);
      return {
        data: { skin },
        units,
        cached: Boolean(cached),
        summary: `skin-analysis SD (${SKIN_ACTIONS.length} concerns): type ${skin.skinType ?? 'n/a'}, signals ${flags.join(', ') || 'none'}${cached ? ' [cache]' : via}`,
      };
    },

    /** Deterministic: the in-stock lipstick that suits the shopper AND the chosen dress colourway. */
    async pair_lip_with_dress({ profile, dress }) {
      const ranked = lipsForDress({ profile, dress, products: catalog.products, limit: 3 });
      if (!ranked.length) throw new ToolError('No lipstick in stock to pair', { code: 'no_pairing' });
      return {
        data: { pick: ranked[0], ranked },
        summary: `lips for ${dress.shadeName}: ${ranked.map((r) => `${r.product.shadeName} ${r.score}`).join(', ')} → ${ranked[0].product.shadeName}`,
      };
    },

    /** Deterministic: a blush colour that pairs with the chosen lipstick and the undertone. */
    async pair_blush_with_lip({ profile, lip }) {
      const blush = blushForLip({ lip, profile });
      return { data: blush, summary: `blush for ${lip.shadeName}: ${blush.name} (${profile.undertone} undertone)` };
    },

    /**
     * One makeup-vto call (1 unit) for a "complete the look" preview: lip colour on the
     * clothes try-on render (uploaded as a new file), or lip colour + blush on the selfie.
     */
    async render_look({ session, kind, lip, blush, sourceBuffer, sourceType, label }) {
      if (lookBudget(session.looksUsed) <= 0) throw new ToolError('Look preview limit reached for this return', { code: 'look_cap' });
      const effects = [
        { category: 'skin_smooth', skinSmoothStrength: 0, skinSmoothColorIntensity: 0 },
        lipEffect(lip),
        ...(blush ? [{ category: 'blush', pattern: { name: '1color1' }, palettes: [{ color: blush.hex, texture: 'matte', colorIntensity: blush.intensity }] }] : []),
      ];
      const srcSha = sourceBuffer ? sha(sourceBuffer) : session.photo.sha;
      const cacheKey = `look:${srcSha}:makeup-vto:${kind}:${paramsKey(effects)}`;
      const inSession = session.renderCache?.[cacheKey];
      const hit = inSession ?? (await demoCache.getBinary(cacheKey));
      const renderId = randomUUID().slice(0, 8);
      if (hit) {
        return { data: { renderId, buffer: hit.buffer, contentType: hit.contentType, cached: true }, units: 0, cached: true, summary: `${label} via makeup-vto [cache, 0 units]` };
      }
      budgetCheck('makeup-vto');
      let fileId;
      if (sourceBuffer) {
        // The clothes try-on render becomes a new YouCam file (0 units), so lips go on the new dress look.
        const png = /png/.test(sourceType || '') || (sourceBuffer[0] === 0x89 && sourceBuffer[1] === 0x50);
        fileId = await youcam.uploadImage(sourceBuffer, { contentType: png ? 'image/png' : 'image/jpeg', fileName: png ? 'look.png' : 'look.jpg' });
      } else {
        ({ fileId } = await ensureUploaded(session));
      }
      session.looksUsed = (session.looksUsed ?? 0) + 1; // counts even if it fails, to bound spend
      let r;
      try {
        r = await youcam.runAndWait('makeup-vto', { src_file_id: fileId, version: '1.0', effects }, { sessionId: session.id });
      } catch (e) {
        if (e.taskId) session.taskIds.push(e.taskId);
        const g = guidanceFor(e.code);
        throw new ToolError(`makeup-vto failed: ${e.code}`, { code: e.code, guidance: g.retake ? 'We could not make this preview from that photo.' : g.message });
      }
      if (r.taskId) session.taskIds.push(r.taskId);
      const url = resultUrl(r.data);
      if (!url) throw new ToolError('Look preview returned no image', { code: 'no_result' });
      const dl = await youcam.download(url);
      session.renderCache = { ...(session.renderCache ?? {}), [cacheKey]: dl };
      await demoCache.setBinary(cacheKey, dl);
      return {
        data: { renderId, buffer: dl.buffer, contentType: dl.contentType, cached: false },
        units: r.units,
        summary: `${label} via makeup-vto (${effects.length - 1 === 1 ? 'lip colour' : 'lip colour + blush'} in one call)${r.via === 'mcp' ? ' over MCP' : ''} (${r.units} unit${r.units === 1 ? '' : 's'})`,
      };
    },

    async create_exchange({ session, order, returned, alternative, price, addOn }) {
      if (addOn && !(catalog.product(addOn.id)?.stock > 0)) throw new ToolError('Add-on out of stock', { code: 'out_of_stock' });
      if (!catalog.reserve(alternative.id)) throw new ToolError('Out of stock', { code: 'out_of_stock' });
      if (addOn) catalog.reserve(addOn.id);
      const exchange = {
        id: catalog.nextExchangeId(),
        originalOrderId: order.id,
        fromId: returned.id,
        fromName: `${returned.productLine} · ${returned.shadeName}`,
        toId: alternative.id,
        toName: `${alternative.productLine} · ${alternative.shadeName}`,
        price,
        ships: 'today',
        returnLabel: `RL-${session.id.slice(0, 6).toUpperCase()}`,
        createdAt: new Date().toISOString(),
        mock: true,
      };
      if (addOn) {
        // Opt-in, paid separately: never folded into the free exchange.
        exchange.addOn = { id: addOn.id, name: `${addOn.productLine} · ${addOn.shadeName}`, customerPays: addOn.price, note: addOnPrice(addOn).note };
      }
      events.add('exchange_created', {
        sessionId: session.id,
        productId: returned.id,
        toProductId: alternative.id,
        value: returned.price,
        refundDifference: price.refundToCustomer,
        ...(addOn ? { addOnProductId: addOn.id, addOnValue: addOn.price } : {}),
      });
      return { data: exchange, summary: `mock exchange ${exchange.id}: ${returned.shadeName} → ${alternative.shadeName} (${price.type})${addOn ? ` + paid add-on ${addOn.shadeName} $${addOn.price}` : ''}` };
    },

    async escalate_to_human({ session, why, code }) {
      const ticket = `ST-${session.id.slice(0, 5).toUpperCase()}`;
      events.add('escalated', { sessionId: session.id, productId: session.returnedId, code });
      return { data: { ticket, why, code }, summary: `ticket ${ticket} (${code})` };
    },
  };
}

function summarizeExcluded(list) {
  const counts = {};
  for (const e of list) counts[e.why] = (counts[e.why] ?? 0) + 1;
  return Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(', ') || 'none';
}

/** Short, stable digest of request params for cache keys (photo hash + feature + params). */
function paramsKey(obj) {
  return createHash('sha256').update(JSON.stringify(obj)).digest('hex').slice(0, 12);
}

/** AI Hair Color palette for a hair-colour kit (full pattern, exact catalogue hex). */
export function hairPalette(product) {
  return { color: product.hex, color_intensity: 70, shine_intensity: 40 };
}

/** The same lip_color effect the lipstick try-on uses, so looks match the core previews. */
export function lipEffect(product) {
  return { category: 'lip_color', shape: { name: 'original' }, style: { type: 'full' }, palettes: [{ color: product.hex, texture: 'matte', colorIntensity: 75 }] };
}

export { publicProduct, sha256 };
function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex');
}
