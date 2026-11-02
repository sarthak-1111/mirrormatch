// Unit metering: known cost per feature, live balance, and a per-call ledger.
// Costs come from GET /s2s/v2.0/credit/feature-cost at startup (fallback: documented values).
// Units are only charged when a task succeeds (per the YouCam docs).

export const DOCUMENTED_COSTS = {
  'skin-tone-analysis': 20,
  'makeup-vto': 1,
  cloth: 2,
  'cloth-v3': 2,
  'cloth-v4': 2,
  'look-vto': 2,
  'skin-analysis': 9, // SD, 1–4 concerns (5–8 concerns cost 12; HD costs more)
  'hair-color': 1,
};

export class UnitMeter {
  constructor() {
    this.costs = { ...DOCUMENTED_COSTS };
    this.costSource = 'documented';
    this.balance = null; // number, from the credit endpoint
    this.balanceCheckedAt = null;
    this.startupBalance = null;
    this.ledger = []; // { at, feature, units, ok, ms, sessionId }
    this.today = new Date().toISOString().slice(0, 10);
    this.spentToday = 0;
  }

  setCostsFromSkus(skus) {
    let n = 0;
    const seen = new Set();
    for (const s of skus ?? []) {
      const m = /\/task\/([^/?#]+)$/.exec(s.run_task_url || '');
      if (!m || typeof s.amount !== 'number') continue;
      const feature = m[1];
      // Several SKUs can share an endpoint (e.g. skin analysis tiers): keep the lowest.
      this.costs[feature] = seen.has(feature) ? Math.min(this.costs[feature], s.amount) : s.amount;
      seen.add(feature);
      n++;
    }
    if (n) this.costSource = 'api';
    return n;
  }

  setBalance(total) {
    this.balance = total;
    this.balanceCheckedAt = new Date().toISOString();
    if (this.startupBalance === null) this.startupBalance = total;
  }

  costOf(feature) {
    return this.costs[feature] ?? DOCUMENTED_COSTS[feature] ?? 0;
  }

  record({ feature, ok, ms, sessionId }) {
    const day = new Date().toISOString().slice(0, 10);
    if (day !== this.today) {
      this.today = day;
      this.spentToday = 0;
    }
    const units = ok ? this.costOf(feature) : 0;
    this.spentToday += units;
    if (this.balance !== null) this.balance = Math.round((this.balance - units) * 100) / 100;
    const entry = { at: new Date().toISOString(), feature, units, ok, ms, sessionId: sessionId ?? null };
    this.ledger.push(entry);
    if (this.ledger.length > 500) this.ledger.shift();
    return entry;
  }

  snapshot() {
    return {
      balance: this.balance,
      balanceCheckedAt: this.balanceCheckedAt,
      startupBalance: this.startupBalance,
      spentThisRun: this.ledger.reduce((s, e) => s + e.units, 0),
      spentToday: this.spentToday,
      costs: this.costs,
      costSource: this.costSource,
      calls: this.ledger.length,
    };
  }
}
