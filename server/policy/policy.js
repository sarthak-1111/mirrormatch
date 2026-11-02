// Exchange policy for the fictional store. Pure, deterministic and unit-tested.
// The agent asks the policy before offering anything, and again before creating an exchange.

export const POLICY = {
  returnWindowDays: 30,
  secondTryReasons: ['wrong_shade', 'colour_didnt_suit'],
  // Opened cosmetics can be exchanged for a different shade under the store's shade promise.
  openedCosmeticsExchangeable: true,
  // Price differences: the merchant absorbs small top-ups; larger differences are not offered
  // as a "free" exchange. Cheaper alternatives refund the difference to the original payment.
  absorbUpToAmount: 5,
  refundDifferenceAbove: 2,
  maxRendersPerReturn: 3,
  maxPhotoAttempts: 3,
  maxAnalysisFailures: 2,
  shipsToday: true,
};

export const REASONS = {
  wrong_shade: { label: "The shade didn't match", secondTry: true },
  colour_didnt_suit: { label: "The colour didn't suit me", secondTry: true },
  damaged: { label: 'It arrived damaged', secondTry: false },
  other: { label: 'Something else', secondTry: false },
};

export function daysBetween(fromIso, toDate = new Date()) {
  const from = new Date(`${fromIso}T00:00:00Z`).getTime();
  return Math.floor((toDate.getTime() - from) / 86400000);
}

/** Is SecondTry offered for this return at all? */
export function secondTryEligibility({ reason, order, now = new Date() }) {
  if (!REASONS[reason]) return { eligible: false, why: 'unknown_reason' };
  if (!REASONS[reason].secondTry) return { eligible: false, why: 'reason_not_colour_related' };
  const age = daysBetween(order.deliveredOn, now);
  if (age > POLICY.returnWindowDays) return { eligible: false, why: 'outside_return_window', age };
  return { eligible: true, why: 'colour_related_return', age };
}

/**
 * Price-difference rule for exchanging `from` (returned) to `to` (alternative).
 * @returns {{ allowed:boolean, type:string, customerPays:number, refundToCustomer:number, merchantAbsorbs:number, note:string }}
 */
export function priceDifference(from, to) {
  const diff = Math.round((to.price - from.price) * 100) / 100;
  if (diff > POLICY.absorbUpToAmount) {
    return {
      allowed: false,
      type: 'upgrade_requires_payment',
      customerPays: diff,
      refundToCustomer: 0,
      merchantAbsorbs: 0,
      note: `This shade costs $${diff.toFixed(2)} more, so it can't be a free exchange.`,
    };
  }
  if (diff > 0) {
    return {
      allowed: true,
      type: 'merchant_absorbs',
      customerPays: 0,
      refundToCustomer: 0,
      merchantAbsorbs: diff,
      note: `We'll cover the $${diff.toFixed(2)} difference.`,
    };
  }
  if (-diff > POLICY.refundDifferenceAbove) {
    return {
      allowed: true,
      type: 'refund_difference',
      customerPays: 0,
      refundToCustomer: -diff,
      merchantAbsorbs: 0,
      note: `We'll refund the $${(-diff).toFixed(2)} difference to your original payment.`,
    };
  }
  return { allowed: true, type: 'even', customerPays: 0, refundToCustomer: 0, merchantAbsorbs: 0, note: 'Even exchange.' };
}

/** Full check before offering or creating an exchange. */
export function checkStockAndPolicy({ order, returned, alternative, reason, now = new Date() }) {
  const checks = [];
  const elig = secondTryEligibility({ reason, order, now });
  checks.push({ rule: 'colour-related reason within return window', ok: elig.eligible, detail: elig.why });
  if (alternative.category !== returned.category) {
    checks.push({ rule: 'same category', ok: false, detail: `${alternative.category} vs ${returned.category}` });
  } else {
    checks.push({ rule: 'same category', ok: true });
  }
  if (alternative.id === returned.id) checks.push({ rule: 'different item', ok: false, detail: 'same item' });
  const inStock = alternative.stock > 0;
  checks.push({ rule: 'in stock', ok: inStock, detail: `${alternative.stock} available` });
  const opened = returned.category === 'lipstick' || returned.category === 'foundation';
  if (opened) {
    checks.push({
      rule: 'opened cosmetics exchangeable (shade promise)',
      ok: POLICY.openedCosmeticsExchangeable,
    });
  }
  const price = priceDifference(returned, alternative);
  checks.push({ rule: 'price difference', ok: price.allowed, detail: price.type });
  const allowed = checks.every((c) => c.ok);
  return { allowed, checks, price, shipsToday: allowed && POLICY.shipsToday };
}

/** Render budget for one return: how many more try-on renders may run. */
export function renderBudget(rendersUsed) {
  return Math.max(0, POLICY.maxRendersPerReturn - rendersUsed);
}
