// Templated shopper-facing text. This is the default voice; the optional LLM may reword
// some of it, but these templates are complete on their own.
import { toneSummaryText } from '../color/tone.js';

const money = (n) => `$${Number(n).toFixed(2)}`;
const CAT_NOUN = { lipstick: 'shade', foundation: 'shade', dress: 'colour', hair: 'shade', skincare: 'texture' };

export const copy = {
  reasonPrompt: (product) =>
    `Sorry ${product.shadeName} didn't work out. What went wrong?`,
  offerMirrorMatch: (product) =>
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
      : category === 'skincare'
        ? 'Take a close selfie facing the camera, bare skin if you can, in soft even light. Your face should fill most of the frame.'
        : category === 'hair'
          ? 'Take a selfie facing the camera, in soft even light, with your hair visible around your face.'
          : 'Take a selfie facing the camera, in soft even light, with your hair away from your face.',
  analyzing: () => 'Measuring your skin tone…',
  toneSummary: (profile) => toneSummaryText(profile),
  matchesIntro: (returned, picks) => {
    const noun = CAT_NOUN[returned.category];
    if (!picks.length) return `We couldn't find a better ${noun} in stock right now.`;
    if (returned.category === 'skincare') {
      return picks.length === 1 ? `The texture that suits your skin today, instead of ${returned.shadeName}.` : `Textures that suit your skin today, instead of ${returned.shadeName}.`;
    }
    if (picks.length === 1) return `Here's the closest in-stock ${noun} for you, next to ${returned.shadeName}.`;
    return `Here are the ${picks.length} closest in-stock ${noun}s for you, next to ${returned.shadeName}.`;
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
    `Your refund of ${money(amount)} is on its way to your original payment method (3 to 5 business days).`,
  escalated: (ticket, why, category) =>
    `${why} A ${category === 'skincare' ? 'skincare' : category === 'hair' ? 'colour' : 'shade'} specialist will follow up by email within one business day (ticket ${ticket}). Your refund is still available any time.`,
  lowConfidence: (returned) =>
    `We couldn't find an in-stock ${CAT_NOUN[returned.category]} that's a clearly better match than ${returned.shadeName}.`,
  analysisFailed: () => "We couldn't measure your skin tone from the photos.",
  // The hosted demo's unit guard (daily cap or safety floor). Not the shopper's fault, so say so.
  demoBudget: () =>
    "Your photo is fine: this live demo has used its YouCam budget for today, so it can't read new photos right now. YouCam's sample model still works (it replays a real result at no cost), or try again tomorrow.",
  qualityNote: (issues) =>
    issues.includes('lighting')
      ? 'The light in this photo was uneven, so treat the match as a starting point. Daylight from a window gives the truest reading.'
      : 'Your face was small or turned in this photo, so treat the match as a starting point. A closer, straight-on selfie gives the truest reading.',
  skinAnalysisFailed: () => "We couldn't read your skin from the photos.",
  skincareLowConfidence: (returned) =>
    `Your skin reading suggests ${returned.shadeName} already suits your skin today, so a different texture may not be the fix.`,
  photoDeleted: () => 'Your photo and previews have been deleted.',
};
