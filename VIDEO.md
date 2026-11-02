# SecondTry: demo video script (2:40)

**Format:** screen recording. Shopper flow on a phone (or Chrome DevTools at iPhone size); the dashboard on desktop. Use your own face.

**Audio:** voiceover only. **No music**, or a royalty-free track you have rights to. **No third-party brands** on screen: the store and every product are fictional, and the YouCam name appears only as the API provider.

**Before recording:**
- Start the server in **live** mode with `DEMO_CACHE=1`, so retakes reuse cached results and cost 0 units.
- Do one warm-up run so the renders are cached.
- Open `/merchant` in a second window.
- Clear old live events with `rm data/events.jsonl` before the final take if you want the dashboard to start clean.

Each section below lists its shots, then the voiceover.

---

## 0:00–0:15: The problem

**Shots:**
- 0:00: the Hue & Hem order history on a phone (3 orders: a lipstick, a foundation, a dress).
- 0:08: tap "Start a return" on Velvet Lip Matte · Shell.

> "Buying lipstick or a dress online, you can't hold the colour up to your face. So when it's wrong, you start a return. That's the moment a store is about to lose the sale. SecondTry turns that moment into a second chance."

## 0:15–1:20: The lipstick return (selfie → matches → try-on → exchange)

**Shots:**
- **0:15:** reason picker. Tap "The shade didn't match" → Continue.
- **0:20:** the offer: "See a better match on you before you decide? About 30 seconds." Point at "No thanks, continue to refund".
- **0:28:** consent screen. Tap "I agree".
- **0:32:** camera with the oval guide and the "Lighting looks good" hint. Take the selfie, then "Use this photo".
- **0:38:** "Measuring your skin tone…"
- **0:45:** tone card: Medium depth · Warm undertone, with the summary.
- **0:52:** the try-on row fills in: Shell (returned) | Bare Honey (best match) | Coral Bay. Zoom on the label "Visual preview, not a guarantee".
- **1:00:** swipe between previews. Show the reason lines under each pick.
- **1:08:** tap Bare Honey, then "Exchange for Bare Honey: free, ships today".
- **1:14:** confirmation with the exchange order number and "Your photo has been deleted."

**Voiceover:**

> **0:15** "I pick 'the shade didn't match'. Only colour reasons trigger SecondTry; a damaged item goes straight to a refund. And the refund button never goes away."
>
> **0:28** "I agree to a selfie that's used only for this return. We run a free check first: if the light is bad, you get a friendly retake tip before we spend a single API unit."
>
> **0:38** "The server sends it to YouCam's **AI Facial Color Tones Analyzer**, which measures my skin, lip, eye and hair colour. YouCam gives us colours, so SecondTry derives depth and undertone itself, using CIELAB colour science, and tells me in plain, kind words: medium, warm."
>
> **0:52** "Then deterministic code ranks every in-stock lipstick in the same price band by CIEDE2000 colour distance to a richer version of my own lip colour, plus undertone rules. YouCam's **AI Makeup Virtual Try-On** renders the shade I returned next to the top two, in the exact catalogue colour, on my own face. Each one says why it was picked, and it's labelled as a preview, not a guarantee."
>
> **1:08** "I take Bare Honey: free exchange, ships today. My photo is deleted, on our server and on YouCam's, with their task-delete API."

## 1:20–1:50: The dress colourway with clothes try-on

**Shots:**
- **1:20:** back to orders. Hem Wrap Dress · Camel → "The colour didn't suit me" → Show me my match.
- **1:27:** capture screen: "One photo from the waist up". Take or upload a waist-up photo.
- **1:35:** try-on row: Camel | Marigold | Plum on your own photo.
- **1:42:** the "Why Camel may not have worked" card ("sits close to your skin tone…").
- **1:46:** tap Exchange.

**Voiceover:**

> **1:20** "Same flow for clothes. For a dress I take one waist-up photo; we tested that it works for both the tone analysis and YouCam's **AI Clothes Virtual Try-On**, cloth version 4."
>
> **1:35** "For clothing the goal isn't matching your skin, it's contrast and temperature. Camel sat too close to my skin tone; Marigold and Plum don't. Makeup try-on and clothes try-on, one flow, one decision: exchange."

## 1:50–2:20: Merchant dashboard and agent trace

**Shots:**
- **1:50:** desktop `/merchant`. The live KPI tiles update: returns started, exchanges accepted, refund value retained. The event feed scrolls.
- **1:58:** live heatmap (product × tone profile) and an insight card.
- **2:04:** scroll to the dashed **Synthetic demo data** section. Point at the label.
- **2:08:** agent traces: expand the lipstick session showing `analyze_skin_tone` 20 units, `find_alternatives`, `check_stock_and_policy`, `render_tryon` ×3 (1 unit each), `create_exchange`, and "deleted 4/4 YouCam tasks".
- **2:16:** the unit budget card: balance from the credit API and the per-feature costs.

**Voiceover:**

> **1:50** "The merchant sees it live: returns started, exchanges accepted, refund value kept."
>
> **1:58** "And a heatmap of which products get returned by which tone profiles, with a recommendation from the same matcher. This section is synthetic demo data, clearly labelled; the live numbers only come from real sessions."
>
> **2:08** "Under the hood it's an agent with eight tools. Every step, tool, timing and YouCam unit is traced, with no photos logged. Decisions are code; an optional LLM only polishes wording. Renders are capped at three per return and cached, and the credit API is checked at startup."

## 2:20–2:40: Close

**Shots:**
- **2:20:** split screen: phone confirmation + dashboard.
- **2:30:** end card: "SecondTry · github.com/sarthak-1111/secondtry · YouCam Facial Color Tones Analyzer · Makeup VTO · Clothes VTO".

> **2:20** "SecondTry: try-on at the moment that matters, the return. The shopper gets the right colour, the store keeps the sale, and next time the product page knows better. Built with YouCam's tone analyzer, makeup try-on and clothes try-on. Thanks for watching."

---

## Shot checklist

- [ ] Phone-sized shopper flow, recorded in live mode (the "Live" chip is visible)
- [ ] The refund button visible on the offer, capture and try-on screens
- [ ] "Visual preview, not a guarantee" readable
- [ ] Agent trace with units
- [ ] Synthetic demo data label visible
- [ ] YouCam APIs named in the voiceover: Facial Color Tones Analyzer, Makeup VTO, Clothes VTO (and the File, Credit and Task delete APIs if time allows)
- [ ] Under 3:00, uploaded **public** to YouTube, link pasted in the Devpost form
