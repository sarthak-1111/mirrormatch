# SecondTry: demo video (2:33)

**The final cut is 2:33**, 1920×1080, with captions burned in. Everything shown is a real run of this repo in **live** mode against the YouCam API, called through YouCam's hosted MCP servers. The video file is not in the repo. It is uploaded to YouTube, and the link is in the Devpost submission.

## How it was made (and what is not literal)

- **Footage.** The shopper flows were recorded in Chrome at iPhone size (390×844, touch emulation), and the dashboard on desktop (1440×900). The recordings are scripted with Playwright and captured frame by frame over the Chrome DevTools screencast. A small ring shows each tap.
- **Live calls, real numbers.** The tone analysis, the makeup renders and the clothes renders on screen are the actual YouCam results for those sessions. The agent panel next to the phone is built from the same session's trace (`GET /api/merchant/traces`): tool names, timings, units and the "deleted 4/4 YouCam tasks" line. Nothing in it is typed by hand.
- **Shortened waits, labelled.** Each wait for YouCam is shortened in the edit, and a badge says so with the real duration: "Live YouCam call · 9.3 s · the wait is shortened here", "3 live renders in parallel · 13.4 s …", and the dress scene's equivalent. Taps sped up ×1.5 are labelled the same way.
- **Synthetic demo data** on the dashboard is shown with its on-screen label, and the video says it is synthetic. The live tiles and the event feed come only from the filmed sessions.
- **People and brands.** The model photos are YouCam's official sample images. Hue & Hem and every product are fictional. No third-party brands appear.
- **Audio.** The narrator is a synthetic voice (Bark, open source, MIT). Each line was generated several times, every take was transcribed with Whisper, and the most accurate take was kept. The music is an original score synthesised for this video and released as CC0. There is no copyrighted music.
- **Tools.** Remotion lays out the scenes (the phone frame, agent panel, badges, and the opening and closing cards), and FFmpeg does the mix, captions and loudness (EBU R128, −15 LUFS). The final audio was transcribed again and checked against the script and captions.

## Timeline and narration

The YouCam APIs are named in **bold**.

### 0:00–0:14: The problem

**On screen:**
- "Shopping for colour online: you can't hold the colour up to your face."
- Then the SecondTry wordmark.

> **0:00.6** Buy a lipstick or a dress online, and you can't hold the colour up to your face.
> **0:05.5** So when the shade is wrong, you start a return, and the store is about to lose the sale.
> **0:09.9** SecondTry turns that moment into a second chance.

### 0:14–1:11: The lipstick return

**On screen:**
- The phone is on the left. The live agent panel is on the right, with each tool call, its timing and its units.
- The reason picker, then the offer with "No thanks, continue to refund", the consent screen, and the photo.
- The tone card: Medium · Warm.
- The try-on row: Shell (returned), Bare Honey (best match) and Coral Bay, each labelled "Visual preview, not a guarantee".
- Exchange for Bare Honey, then the confirmation: order HH-X1003, "Your photo has been deleted".

> **0:14.6** A shopper is returning a lipstick, because the shade didn't match.
> **0:18.5** Only colour reasons start SecondTry, and the refund stays one tap away.
> **0:23.3** They agree to one selfie, used only for this return, and deleted when it ends.
> **0:29.0** YouCam's **AI Facial Color Tones Analyzer** measures their skin, lip, eye and hair colour.
> **0:36.9** SecondTry works out depth and undertone itself, and says it kindly: medium, warm.
> **0:44.7** Plain code ranks the lipsticks in stock by colour distance to a richer version of their own lip colour.
> **0:51.9** YouCam's **AI Makeup Virtual Try-On** shows the returned shade and the top two picks, on their own face.
> **0:59.8** Each one is labelled as a preview, not a guarantee.
> **1:02.9** They take Bare Honey: a free exchange that ships today. The photo is deleted, here and at YouCam.

### 1:11–1:38: The dress, with clothes try-on

**On screen:**
- The Hem Wrap Dress · Camel return, and one waist-up photo.
- Camel next to Marigold and Plum, rendered on the model.
- The "Why Camel may not have worked" card, then the exchange (order HH-X1004).

> **1:11.4** Clothes work the same way. One waist-up photo is enough for the tone analysis and for YouCam's **AI Clothes Virtual Try-On**.
> **1:22.8** For a dress, the goal is contrast and warmth, not a skin match. For this deep, warm profile, Marigold and Plum score ahead of Camel.
> **1:32.0** Makeup and clothes try-on, in one flow, ending in one decision: exchange.

### 1:38–2:14: The merchant dashboard and the agent trace

**On screen:**
- `/merchant` on desktop. The live tiles tick up as the filmed exchange lands.
- The live heatmap and insight cards.
- The dashed **Synthetic demo data** section, with a badge.
- The agent traces "over MCP", with units per call, and the unit budget from the credit API.

> **1:38.0** The merchant sees it live: returns started, exchanges accepted, and refund value kept.
> **1:46.1** And which products get returned by which tone profiles, with a fix from the same matcher.
> **1:51.8** This history is synthetic demo data, and it is labelled that way.
> **1:58.3** Under the hood, an agent with eight tools calls YouCam through its **MCP servers**.
> **2:04.5** Every step, timing and unit is traced, with no photos logged. Renders are capped at three per return.

### 2:14–2:33: Close

**On screen:** the end card shows:
- the SecondTry wordmark;
- the three YouCam APIs with feature names and units (skin-tone-analysis 20, makeup-vto 1, cloth-v4 2);
- github.com/sarthak-1111/secondtry;
- two phones showing the lipstick and dress renders.

> **2:14.6** SecondTry: try-on at the moment that matters, the return.
> **2:19.0** The shopper gets the right colour, and the store keeps the sale.
> **2:22.9** Built with YouCam's tone analyzer, makeup try-on and clothes try-on. The code is linked below.

## Checklist (against the rules)

- [x] Between 1 and 3 minutes (2:33)
- [x] Shows the app working on its target devices: a phone for shoppers, desktop for merchants
- [x] Names the YouCam APIs used: AI Facial Color Tones Analyzer, AI Makeup Virtual Try-On, AI Clothes Virtual Try-On, and the MCP servers. The end card lists the feature names and units.
- [x] No copyrighted music: an original CC0 score
- [x] No third-party trademarks: a fictional store, and YouCam named only as the API provider
- [x] "Visual preview, not a guarantee", the refund button and the synthetic-data label are all visible
- [ ] Uploaded **public** to YouTube, with the link pasted in the Devpost form (manual)

## Re-recording it yourself

To make your own take, run the server in live mode with `DEMO_CACHE=1`. Retakes then reuse the cached YouCam results and cost 0 units, and the cache is per photo and product. Use your own photo or YouCam's sample images. Open `/merchant` in a second window. Delete `data/events.jsonl` first if you want the live tiles to start from zero.
