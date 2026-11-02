# SecondTry: Devpost submission text

**Tagline (≤ 200 chars):** The returns desk that gets it right the second time. SecondTry measures your skin tone, finds the right shade or colourway, shows it on you, and offers an exchange instead of a refund.

**Track:** eCommerce VTO (makeup try-on + clothes try-on in one flow)

---

## Inspiration

Every beauty and fashion store has a returns form with a box that says *"wrong shade"* or *"the colour didn't suit me."* That box marks a very specific moment:
- The shopper still wants the product.
- They've just learned which colour *doesn't* work on them.
- The store is about to refund them and pay for the round trip.

Virtual try-on usually lives on the product page, *before* the purchase. We asked what happens if you put it at the return instead. That's the one point where the shopper has a real reason to try again, and the merchant has a real reason to help.

## What it does

SecondTry is a returns desk for a demo store, "Hue & Hem" (fictional, no real brands). When a shopper starts a return for a colour reason:

1. **The offer.** "See a better match on you before you decide? (about 30 seconds)". "Continue to refund" is a full-width button on every screen. No dark patterns.
2. **The photo.** A selfie for lipstick or foundation, or one waist-up photo for a dress, with a clear consent note. A free pre-check catches bad lighting before any units are spent. If YouCam reports no face, a bad angle or poor light, the shopper gets specific, friendly guidance ("tilt your head down slightly") and retakes.
3. **The tone summary.** YouCam's **AI Facial Color Tones Analyzer** measures skin, lip, eye and hair colour. SecondTry turns that into a kind summary: depth and undertone in plain words.
4. **The matching.** Deterministic code ranks in-stock alternatives in the same category and price band by **CIEDE2000 colour distance** in CIELAB, plus undertone rules. The returned item is excluded, and every pick gets a one-line reason ("A warm nude, deeper and warmer than Shell: close to your natural lip tone, just richer.").
5. **The try-on.** The returned item and the top two alternatives are rendered side by side on the shopper's own photo. **YouCam Makeup VTO** renders the exact catalogue hex for lipstick and foundation. **YouCam Clothes VTO** (cloth-v4) renders the dress colourways. Every image is labelled "Visual preview, not a guarantee".
6. **The exchange.** "Exchange now: free, ships today" creates the exchange order and deletes the photo, here and on YouCam's side. Or the shopper takes the refund, no questions asked.

**For merchants:**
- A live dashboard: returns started, exchanges accepted, and refund value retained.
- A **product × tone-profile heatmap** and insight cards, e.g. *"3W Sand is returned most by deep · cool profiles. Recommend 7C Cocoa on the product page for them."* The insights are computed by the same matcher the shopper flow uses.
- Any seeded history is labelled **synthetic demo data** and kept visually separate from live events.

## How we built it (Technological Implementation)

- **Three YouCam AI APIs plus the platform APIs, end to end on the V2 server-to-server flow.** The flow is: File API registration, PUT to the pre-signed URL, create the task, poll, download the result, then `task/delete`.
  - Credit and feature-cost endpoints check the balance at startup and meter every call. Costs were verified live: 20 units for tone, 1 for makeup try-on, 2 for clothes try-on.
  - **The agent's YouCam calls run through YouCam's hosted MCP servers** (beauty and fashion): `AI-Facial-Color-Tones-Analyzer`, `AI-Makeup-Virtual-Try-On` and `AI-Clothes-Virtual-Try-On` as tool calls. A REST fallback means an MCP hiccup never reaches the shopper. Verified live end to end.
  - The clothes and look template catalogues were also checked.
  - We verified the API live before building on it: latency, error codes, and which photo framing works for both tone analysis and cloth-v4. One waist-up photo works at `low` strictness. A close-up selfie fails cloth-v4 with `error_pose`.
- **A tool-using agent with a deterministic planner.** It has eight tools: `get_order`, `check_photo_quality`, `analyze_skin_tone`, `find_alternatives`, `render_tryon`, `check_stock_and_policy`, `create_exchange` and `escalate_to_human`.
  - It decides the next step from tool results and escalates to a human when confidence is low. For example, if nothing in stock is clearly better than what you bought, it says so instead of guessing.
  - A live **agent trace panel** shows each step, tool, timing and YouCam units, with no photos or colour values logged.
- **Colour science, not vibes.**
  - sRGB → CIELAB (D65), and CIEDE2000 tested against the published Sharma et al. reference pairs.
  - Skin depth from the Individual Typology Angle, and undertone from the CIELAB hue angle. YouCam returns colours, not undertone labels, so we derive them.
  - Separate scoring rules for foundation (match the skin), lipstick (a richer version of your own lip tone) and clothing (contrast and temperature harmony).
- **Unit budgeting:**
  - A cap of 3 renders per return.
  - Per-session caching of tone and renders.
  - A unit floor, an optional daily cap for hosted demos, and a free pre-check before the 20-unit analysis.
- **An optional LLM, for wording only.** It works with any OpenAI-compatible endpoint (we used a local `gpt-oss:120b`). It only rewords the tone summary; its output is validated (facts kept, no judgemental words) and it never blocks the flow. The app works fully with templated text and only a YouCam key.
- **Quality:**
  - 40 unit tests covering colour maths, matching, the exchange policy, every agent decision path and the MCP transport.
  - A Playwright end-to-end happy path, and a mock mode so judges can run it without spending units.
  - Plain Node + Express with no build step. MIT licensed.

## Design

- **Mobile-first shopper flow** with one decision per screen, a 3-step progress cue, a camera with a face or waist-up guide and a live lighting hint, plus upload as a fallback.
- **Accessible:** real buttons and radio groups, keyboard navigation, focus moved to each new screen's heading, alt text on every preview, and reduced-motion support.
- **Kind language** about skin, everywhere.
- **A desktop dashboard for merchants,** with live updates over Server-Sent Events.

## Potential impact

**For the shopper:** a refund means starting the search again. SecondTry turns "that didn't work" into "here's what will", on their own face, in about 30 seconds, with the refund still one tap away.

**For the merchant:**
- A colour-related return becomes an exchange, so the revenue stays in the store and the reverse-logistics trip ends with a sale.
- Every analysed return feeds a product × tone-profile map that shows where the product page is misleading which shoppers.

We don't quote industry statistics. The dashboard reports only what actually happens in sessions, and synthetic illustration data is labelled as such.

## Quality of idea

Most try-on lives on the product page. SecondTry puts skin-tone analysis and virtual try-on at the **return**, a non-obvious moment with unusually clear intent. The shopper has told you what went wrong, and you have the exact product, shade and price band to work within.

It also closes the loop: the same matching engine explains the returns to the merchant, so the next shopper gets the right shade the first time.

## Challenges

- **No undertone label from the API.** YouCam's tone analyzer returns colours, not undertone or depth, so we derived both with documented colour-science formulas and made the thresholds explicit.
- **One photo for two models.** Tone analysis wants a close, frontal face; cloth-v4 needs a visible body pose. Live testing showed a waist-up photo works for both at `low` face-angle strictness, so the dress flow asks for exactly one photo.
- **Honest UX.**
  - Every preview is labelled as a preview.
  - The refund is never hidden.
  - Low-confidence matches go to a person instead of a guess.
  - Photos are deleted on YouCam's side too.

## What we learned

- Colour distance alone isn't enough. Lipstick, foundation and clothing each need a different target: your skin, a richer version of your lip, or contrast with your skin.
- Unit-aware engineering (pre-checks, caps, caching) matters as much as the AI calls themselves.

## What's next

- A returns-portal **webhook integration** for real stores: trigger on `return.created` with a colour reason, and write the exchange back via the store's order API.
- YouCam webhooks instead of polling.
- Publishing SecondTry's own tools as an MCP server, so a store's support assistant can run a SecondTry return.
- Catalogue import with swatch calibration.
- Pushing insights back to product pages.

## Built with

YouCam AI Facial Color Tones Analyzer · YouCam AI Makeup Virtual Try-On · YouCam AI Clothes Virtual Try-On (cloth-v4) · YouCam MCP servers (beauty, fashion) · YouCam File / Credit / Task APIs · Node.js · Express · vanilla JS · CIELAB / CIEDE2000 · Playwright · optional OpenAI-compatible LLM (local gpt-oss:120b)

**Try it:** `npm install && npm start` with a `YOUCAM_API_KEY` in `.env`, or `npm run mock` with no key. Repo: https://github.com/sarthak-1111/secondtry
