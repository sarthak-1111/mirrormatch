// Templated shopper-facing text. This is the default voice; the optional LLM may reword
// some of it, but these templates are complete on their own.
import { toneSummaryText } from '../color/tone.js';

const money = (n) => `$${Number(n).toFixed(2)}`;
const CAT_NOUN = { lipstick: 'shade', foundation: 'shade', dress: 'colour' };

export const copy = {
  reasonPrompt: (product) =>
    `Sorry ${product.shadeName} didn't work out. What went wrong?`,
  offerSecondTry: (product) =>
    `Want to see a better match on you before you decide? It takes about 30 seconds. Your refund stays one tap away.`,
  notEligible: (why) =>
    why === 'outside_return_window'
      ? 'This order is outside the 30-day return window, so we can only help through support.'
      : "No problem. We'll process your refund.",
  consent: () =>
    'We use your photo only for this return. It is processed to measure your skin tone and show try-on previews, then deleted when this return ends.',
  capture: (category) =>
    category === 'dress'
      ? 'One photo from the waist up: face the camera, shoulders and arms visible, in soft even light. We use it for your skin tone and the dress preview.'
      : 'Take a selfie facing the camera, in soft even light, with your hair away from your face.',
  analyzing: () => 'Measuring your skin tone…',
  toneSummary: (profile) => toneSummaryText(profile),
  matchesIntro: (returned, picks) => {
    const noun = CAT_NOUN[returned.category];
    if (!picks.length) return `We couldn't find a better ${noun} in stock right now.`;
    return `Here are ${picks.length === 1 ? 'the closest in-stock ' + noun : `the ${picks.length} closest in-stock ${noun}s`} for you, next to ${returned.shadeName}.`;
  },
  rendering: () => 'Creating previews on your photo…',
  tryonLabel: () => 'Visual preview, not a guarantee',
  offer: (pick, price) => {
    const base = `Swap for ${pick.shadeName}: free, ships today.`;
    if (price?.type === 'refund_difference') return `${base} ${price.note}`;
    if (price?.type === 'merchant_absorbs') return `${base} ${price.note}`;
    return base;
  },
  exchanged: (exchange) =>
    `Done! ${exchange.toName} ships today on order ${exchange.id}. Send ${exchange.fromName} back with the prepaid label; there's no rush.`,
  refunded: (amount) =>
    `Your refund of ${money(amount)} is on its way to your original payment method (3–5 business days).`,
  escalated: (ticket, why) =>
    `${why} A shade specialist will follow up by email within one business day (ticket ${ticket}). Your refund is still available any time.`,
  lowConfidence: (returned) =>
    `We couldn't find an in-stock ${CAT_NOUN[returned.category]} that's a clearly better match than ${returned.shadeName}.`,
  analysisFailed: () => "We couldn't measure your skin tone from the photos.",
  photoDeleted: () => 'Your photo and previews have been deleted.',
};
