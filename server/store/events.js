// Event log for the merchant dashboard. Only live events from real demo sessions go here
// (data/events.jsonl, gitignored). Synthetic history lives in a separate file and is never
// mixed into these numbers. Events carry no photos, colours or other personal data:
// just the product, the coarse tone-profile key (e.g. "deep-warm") and amounts.
import { appendFileSync, existsSync, readFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export class EventLog {
  constructor({ path, persist = true } = {}) {
    this.path = path;
    this.persist = persist && Boolean(path);
    this.events = [];
    this.subscribers = new Set();
    if (this.persist && existsSync(path)) {
      for (const line of readFileSync(path, 'utf8').split('\n')) {
        if (!line.trim()) continue;
        try {
          this.events.push(JSON.parse(line));
        } catch {
          /* skip corrupt line */
        }
      }
    }
  }

  add(type, fields = {}) {
    const ev = { type, at: new Date().toISOString(), ...fields };
    this.events.push(ev);
    if (this.persist) {
      mkdirSync(dirname(this.path), { recursive: true });
      appendFileSync(this.path, JSON.stringify(ev) + '\n');
    }
    for (const fn of this.subscribers) {
      try {
        fn(ev);
      } catch {
        /* ignore subscriber errors */
      }
    }
    return ev;
  }

  subscribe(fn) {
    this.subscribers.add(fn);
    return () => this.subscribers.delete(fn);
  }

  clear() {
    this.events = [];
  }
}

/** Aggregate a list of return records (live or synthetic) into dashboard numbers.
 *  A "return record" = { sessionId, productId, category, price, profileKey, secondTry, outcome, exchangeValue } */
export function aggregate(records) {
  const k = {
    returnsStarted: records.length,
    secondTryOffered: 0,
    secondTryAccepted: 0,
    exchanges: 0,
    refunds: 0,
    escalations: 0,
    refundValueRetained: 0,
    refundValuePaid: 0,
  };
  const heat = {}; // productId -> profileKey -> count
  const exchangesTo = {}; // productId -> toProductId -> count
  for (const r of records) {
    if (r.secondTryOffered) k.secondTryOffered++;
    if (r.secondTry) k.secondTryAccepted++;
    if (r.outcome === 'exchange') {
      k.exchanges++;
      k.refundValueRetained += r.price ?? 0;
      if (r.toProductId) {
        exchangesTo[r.productId] ??= {};
        exchangesTo[r.productId][r.toProductId] = (exchangesTo[r.productId][r.toProductId] ?? 0) + 1;
      }
    } else if (r.outcome === 'refund') {
      k.refunds++;
      k.refundValuePaid += r.price ?? 0;
    } else if (r.outcome === 'escalated') {
      k.escalations++;
    }
    if (r.profileKey) {
      heat[r.productId] ??= {};
      heat[r.productId][r.profileKey] = (heat[r.productId][r.profileKey] ?? 0) + 1;
    }
  }
  const decided = k.exchanges + k.refunds;
  k.exchangeRate = decided ? k.exchanges / decided : null;
  k.refundValueRetained = Math.round(k.refundValueRetained * 100) / 100;
  k.refundValuePaid = Math.round(k.refundValuePaid * 100) / 100;
  return { kpis: k, heat, exchangesTo };
}

/** Fold the live event stream into one record per return session. */
export function recordsFromEvents(events) {
  const bySession = new Map();
  for (const e of events) {
    if (!e.sessionId) continue;
    let r = bySession.get(e.sessionId);
    if (!r) {
      r = { sessionId: e.sessionId, at: e.at, outcome: null, secondTry: false, secondTryOffered: false };
      bySession.set(e.sessionId, r);
    }
    switch (e.type) {
      case 'return_started':
        Object.assign(r, { productId: e.productId, category: e.category, price: e.price });
        break;
      case 'secondtry_offered':
        r.secondTryOffered = true;
        break;
      case 'secondtry_accepted':
        r.secondTry = true;
        break;
      case 'tone_analyzed':
        r.profileKey = e.profileKey;
        break;
      case 'exchange_created':
        r.outcome = 'exchange';
        r.toProductId = e.toProductId;
        break;
      case 'refund_chosen':
        r.outcome = 'refund';
        break;
      case 'escalated':
        if (!r.outcome) r.outcome = 'escalated';
        break;
      default:
        break;
    }
  }
  return [...bySession.values()].filter((r) => r.productId);
}
