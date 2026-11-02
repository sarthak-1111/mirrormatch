# SecondTry: Devpost submission text

**Tagline (≤ 200 chars):** The returns desk that gets it right the second time. SecondTry measures your skin tone, finds the right shade or colourway, shows it on you, and offers an exchange instead of a refund.

**Track:** eCommerce VTO (makeup try-on + clothes try-on in one flow)

---

## Inspiration

Alex ordered a lipstick called Shell for a friend's wedding. On the product page it looked like a soft rose. In the mirror, on Alex, it looked grey.

So Alex opened the returns form and ticked *"the shade didn't match"*. Every beauty and fashion store has that box, and it marks a very specific moment:
- **The shopper still wants the product.** They just got the colour wrong, through a screen.
- **They now know what *didn't* work on them.** No pre-purchase quiz ever has that signal.
- **The store is about to lose the sale** and pay for the round trip, and nobody learns why.

Virtual try-on usually lives on the product page, *before* the purchase. We asked what happens if you put it at the return instead: the one point where the shopper has a real reason to try again, and the merchant has a real reason to help.

## What it does

SecondTry is a returns desk for a demo store, "Hue & Hem" (fictional, no real brands). The demo opens with Alex's one-minute story (`/story.html`). When a shopper starts a return for a colour reason:

1. **The offer.** It opens with empathy ("Colour is hard to judge through a screen, and that's on us, not you"), then asks: "See a better match on you before you decide? About 30 seconds." "Continue to refund" is a full-width button on every screen. No dark patterns.
2. **The photo.** A selfie for lipstick or foundation, or one waist-up photo for a dress, with a clear consent note. A free pre-check catches bad lighting before any units are spent. If YouCam reports no face, a bad angle or poor light, the shopper gets friendly, specific guidance and retakes.
3. **The tone summary.** YouCam's **AI Facial Color Tones Analyzer** measures skin, lip, eye and hair colour. SecondTry turns that into a kind summary of depth and undertone in plain words. A "Read my results aloud" button speaks the summary, picks and reasons.
4. **The matching.** Deterministic code ranks in-stock alternatives in the same category and price band by **CIEDE2000 colour distance** in CIELAB, plus undertone rules. The returned item is excluded, and every pick gets a one-line reason. A "Why Shell may not have worked" card explains the miss: "that's about the colour, not about you."
5. **The try-on.** The returned item and the top two alternatives are rendered on the shopper's own photo. **YouCam AI Makeup Virtual Try-On** renders the exact catalogue hex for lipstick and foundation. **YouCam AI Clothes Virtual Try-On** (cloth-v4) renders the dress colourways.
6. **"That's me."** A before/after slider puts the returned shade and the chosen pick on the same photo, so only the colour changes. It can be dragged or used from the keyboard. Every image is labelled "Visual preview, not a guarantee".
7. **The exchange.** "Exchange for Bare Honey: free, ships today" creates the exchange order and deletes the photo, here and on YouCam's side. A short timeline says what happens next. Or the shopper takes the refund, no questions asked.
8. **Next time, skip the guesswork.** The shopper can opt in to a **colour passport**: tone numbers and the shade they chose, never the photo, saved only on their own device. The orders page then shows "Picked for you" from the same matcher. One tap forgets it.

**For merchants:**
- **Live:** returns started, exchanges accepted, refund value kept, an event feed, and a product × tone-profile return heatmap.
- **"Who is each shade for?"** Every product is scored against nine reference tone profiles by the shopper matcher itself. Gap cards flag where the range has no good in-stock option for a profile, where it's one stock-out away from a gap, and where live returns had to be escalated because nothing was clearly better.
- **Insight cards** from the same matcher, e.g. *"3W Sand is returned most by deep · cool profiles. Recommend 7C Cocoa on the product page for them."*
- Any seeded history is labelled **synthetic demo data** and kept visually separate from live events.
- **A returns-portal webhook** (`POST /api/integrations/return-started`), so an existing returns portal can hand colour-reason returns to SecondTry and send the shopper a link.

## Why not just do this before purchase?

Pre-purchase shade finders make a guess. A return is the only time a store finds out what actually failed: *this shade, on this tone profile, didn't work*. That changes three things:
- **The ranking knows what went wrong.** The returned shade is scored too, and an alternative is only offered if it scores clearly better for this shopper. Otherwise the agent hands over to a person instead of guessing. Picks stay in the returned item's price band and, for lipstick, lean towards its colour family: the shopper liked the idea, just not the result.
- **Every return becomes catalogue data.** The heatmap, the gap cards and the insights all come from failures, which pre-purchase tools never see.
- **It reaches people when they're paying attention.** The shopper is already in the returns flow, and the merchant already has the exact product, shade and price band.

SecondTry also covers the pre-purchase side for returning customers through the opt-in colour passport, so the next order starts from what worked.

## How we built it (Technological Implementation)

- **Three YouCam AI APIs plus the platform APIs, end to end on the V2 server-to-server flow.** The flow is: File API registration, PUT to the pre-signed URL, create the task, poll, download the result, then `task/delete`.
  - Credit and feature-cost endpoints check the balance at startup and meter every call. Costs were verified live: 20 units for tone, 1 for makeup try-on, 2 for clothes try-on.
  - **The agent's YouCam calls run through YouCam's hosted MCP servers** (beauty and fashion): `AI-Facial-Color-Tones-Analyzer`, `AI-Makeup-Virtual-Try-On` and `AI-Clothes-Virtual-Try-On` as tool calls. A REST fallback means an MCP hiccup never reaches the shopper. Verified live end to end.
  - We verified the API live before building on it: latency, error codes, and which photo framing works for both tone analysis and cloth-v4. One waist-up photo works at `low` strictness; a close-up selfie fails cloth-v4 with `error_pose`.
- **A tool-using agent with a deterministic planner.** It has eight tools: `get_order`, `check_photo_quality`, `analyze_skin_tone`, `find_alternatives`, `render_tryon`, `check_stock_and_policy`, `create_exchange` and `escalate_to_human`.
  - It decides the next step from tool results and escalates to a human when confidence is low. If nothing in stock is clearly better than what you bought, it says so instead of guessing.
  - A live **agent trace panel** shows each step, tool, timing and YouCam units, with no photos or colour values logged.
- **Colour science, not vibes.**
  - sRGB → CIELAB (D65), and CIEDE2000 tested against the published Sharma et al. reference pairs.
  - Skin depth from the Individual Typology Angle, and undertone from the CIELAB hue angle. YouCam returns colours, not undertone labels, so we derive them.
  - Separate scoring for foundation (match the skin), lipstick (a richer version of your own lip tone) and clothing (contrast and temperature harmony).
  - The merchant matrix reuses the shopper matcher's own scorer and confidence thresholds. Its reference lip colours are calibrated against what YouCam actually measured on our test photos.
- **Unit budgeting:** a cap of 3 renders per return, per-session caching, a unit floor, an optional daily cap for hosted demos, and a free pre-check before the 20-unit analysis.
- **An optional LLM, for wording only.** It works with any OpenAI-compatible endpoint (we used a local `gpt-oss:120b`). It only rewords the tone summary; its output is validated (facts kept, no judgemental words) and it never blocks the flow. The app works fully with templated text and only a YouCam key.
- **Quality:**
  - 52 unit tests covering colour maths, matching, the exchange policy, every agent decision path, the MCP transport, the shade-fit matrix and gaps, the webhook and the colour passport.
  - 3 Playwright end-to-end tests: the happy path (with the slider, passport and dashboard), the story page, and a damaged-item refund.
  - A mock mode so judges can run everything without spending units.
  - Plain Node + Express with no build step. MIT licensed.

## Design

- **A story first.** The story page walks through Alex's return in six short beats (the parcel, the dead end, the second try, "that's me", any colour, the store learns) and leads straight into the demo.
- **Mobile-first shopper flow** with one decision per screen and a four-step progress bar. The camera has a face or waist-up guide and a live lighting hint, with upload as a fallback.
- **Accessible:**
  - Real buttons and radio groups, and keyboard navigation, including the slider.
  - Focus moves to each new screen's heading.
  - Alt text on every preview, reduced-motion support, and read-aloud results.
- **Kind language** about skin, everywhere: "That's about the colour, not about you."
- **A desktop dashboard for merchants,** with live updates over Server-Sent Events, and text labels on every colour-coded cell.

## Potential impact

**For the shopper:** a refund means starting the search again, often against a deadline. SecondTry turns "that didn't work" into "here's what will", on their own face, in about 30 seconds, with the refund one tap away.

**For the merchant:**
- A colour-related return becomes an exchange, so the revenue stays in the store and the reverse-logistics trip ends with a sale.
- Every analysed return feeds a product × tone-profile map, and the shade-fit matrix shows which profiles the range serves badly before more returns arrive.
- The webhook means it slots into an existing returns portal instead of replacing it.

We don't quote industry statistics. The dashboard reports only what actually happens in sessions, and synthetic illustration data is labelled as such.

## Quality of idea

Most try-on lives on the product page. SecondTry puts skin-tone analysis and virtual try-on at the **return**, a non-obvious moment with unusually clear intent. The shopper has told you what went wrong, and you have the exact product, shade and price band to work within.

It closes the loop twice: the shopper's colour passport makes the next purchase right first time, and the same matching engine explains the returns to the merchant, so the next shopper gets the right shade too.

## Challenges

- **No undertone label from the API.** YouCam's tone analyzer returns colours, not undertone or depth, so we derived both with documented colour-science formulas and made the thresholds explicit.
- **One photo for two models.** Tone analysis wants a close, frontal face; cloth-v4 needs a visible body pose. Live testing showed a waist-up photo works for both at `low` face-angle strictness, so the dress flow asks for exactly one photo.
- **Keeping the merchant view honest.** Our first reference profiles used textbook lip colours, and the matrix disagreed with what real shoppers were offered. We recalibrated them to YouCam's measured lip colours, so the grid and the live flow now agree.
- **Honest UX.** Every preview is labelled as a preview, the refund is never hidden, low-confidence matches go to a person instead of a guess, and photos are deleted on YouCam's side too.

## What we learned

- Colour distance alone isn't enough. Lipstick, foundation and clothing each need a different target: your skin, a richer version of your lip, or contrast with your skin.
- Unit-aware engineering (pre-checks, caps, caching) matters as much as the AI calls themselves.
- A returns flow is an emotional moment. Small things like an apology, a clear "what happens next" and a visible refund do as much as the AI.

## What's next

- Adapters for specific returns platforms on top of the generic webhook, writing the exchange back via the store's order API.
- YouCam webhooks instead of polling.
- Publishing SecondTry's own tools as an MCP server, so a store's support assistant can run a SecondTry return.
- Catalogue import with swatch calibration.
- Pushing the "Who is each shade for?" results back to product pages.

## Built with

YouCam AI Facial Color Tones Analyzer · YouCam AI Makeup Virtual Try-On · YouCam AI Clothes Virtual Try-On (cloth-v4) · YouCam MCP servers (beauty, fashion) · YouCam File / Credit / Task APIs · Node.js · Express · vanilla JS · CIELAB / CIEDE2000 · Web Speech API · Playwright · optional OpenAI-compatible LLM (local gpt-oss:120b)

**Try it:** `npm install && npm start` with a `YOUCAM_API_KEY` in `.env`, or `npm run mock` with no key. Start at `/story.html`. Repo: https://github.com/sarthak-1111/secondtry
