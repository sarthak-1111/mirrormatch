// The agent's tools. Each tool is a plain async function with a name, so the orchestrator
// can call it, time it, meter its units and record a PII-free trace line.
// Tools: get_order, check_photo_quality, analyze_skin_tone, find_alternatives,
//        render_tryon, check_stock_and_policy, create_exchange, escalate_to_human
import { createHash, randomUUID } from 'node:crypto';
import { buildToneProfile } from '../color/tone.js';
import { findAlternatives } from '../color/match.js';
import { checkStockAndPolicy, renderBudget } from '../policy/policy.js';
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
    const fileId = await youcam.uploadImage(session.photo.buffer, {
      contentType: session.photo.mime,
      fileName: session.photo.mime === 'image/png' ? 'photo.png' : 'photo.jpg',
    });
    session.youcamFileId = fileId;
    session.youcamFileSha = session.photo.sha;
    return { fileId, uploaded: true };
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
      if (!color?.skin_color) issues.push('error_no_face');
      if (issues.length) {
        const g = guidanceFor(issues[0]);
        throw new ToolError(`face quality: ${issues.join(', ')}`, { code: issues[0], guidance: g.message, retake: true });
      }
      const profile = buildToneProfile(color);
      return {
        data: { profile, faceQuality, cached: cachedHit, taskId },
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
      const feature = product.category === 'dress' ? config.youcam.clothFeature : 'makeup-vto';
      const cacheKey = `render:${session.photo.sha}:${feature}:${product.id}`;
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

    async create_exchange({ session, order, returned, alternative, price }) {
      if (!catalog.reserve(alternative.id)) throw new ToolError('Out of stock', { code: 'out_of_stock' });
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
      events.add('exchange_created', {
        sessionId: session.id,
        productId: returned.id,
        toProductId: alternative.id,
        value: returned.price,
        refundDifference: price.refundToCustomer,
      });
      return { data: exchange, summary: `mock exchange ${exchange.id}: ${returned.shadeName} → ${alternative.shadeName} (${price.type})` };
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

export { publicProduct, sha256 };
function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex');
}
