# SecondTry: demo video (2:52)

**The final cut is 2:52**, 1920×1080, with captions burned in. Everything shown is a real run of this repo in **live** mode against the YouCam API, called through YouCam's hosted MCP servers. The video file is not in the repo. It is uploaded to YouTube, and the link is in the Devpost submission.

## How it was made (and what is not literal)

- **Footage.** The story page and the dashboard were recorded on desktop (1440×900). The shopper flows were recorded in Chrome at iPhone size (390×844, touch emulation). The recordings are scripted with Playwright and captured frame by frame over the Chrome DevTools screencast. A small ring shows each tap, and the before/after slider is dragged with a real pointer.
- **Live calls, real numbers.** The tone analysis, the makeup renders and the clothes renders on screen are the actual YouCam results for those sessions. The agent panel next to the phone is built from the same session's trace (`GET /api/merchant/traces`): tool names, timings, units and the "deleted YouCam tasks" line. Nothing in it is typed by hand.
- **Shortened waits, labelled.** Each wait for YouCam is shortened in the edit, and a badge gives the real duration from the trace: "Live YouCam call · 11.0 s · the wait is shortened here" and "3 live renders in parallel · 18.9 s …" for the lipstick, and the same two badges for the dress (the clothes renders took about 83 s in that session). Taps sped up ×1.5 are labelled the same way.
- **Synthetic demo data** on the dashboard is shown with its on-screen label, and the video says it is synthetic. The live tiles and the event feed come only from the filmed sessions. The "Who is each shade for?" grid is computed from the catalogue and the shopper matcher alone, with no customer data, and its badge says so.
- **People and brands.** Alex is a character in the demo story. The model photos are YouCam's official sample images. Hue & Hem and every product are fictional. No third-party brands appear.
- **Audio.** The narrator is a synthetic voice (Bark, open source, MIT). Each line was generated several times, every take was transcribed with Whisper, and the most accurate take was kept. The music is an original score synthesised for this video and released as CC0. There is no copyrighted music.
- **Tools.** Remotion lays out the scenes (the browser and phone frames, agent panel, badges, and the closing card), and FFmpeg does the mix, captions and loudness (EBU R128, −15 LUFS). The final audio was transcribed again and checked against the script and captions.

## Timeline and narration

The YouCam APIs are named in **bold**.

### 0:00–0:23: The problem, as a story

**On screen:** the story page (`/story.html`) in a desktop browser: Alex's order, "On the screen / In the mirror", the return about to happen. Then the SecondTry wordmark.

> **0:00.6** Alex ordered a lipstick called Shell, for a friend's wedding. On the screen, it looked like a soft rose.
> **0:07.3** In the mirror, it looked grey. So Alex starts a return, and the store is about to lose the sale.
> **0:18.4** SecondTry turns that moment into a second chance.

### 0:23–1:35: The lipstick return

**On screen:**
- The phone is on the left. The live agent panel is on the right, with each tool call, its timing and its units.
- The reason picker, then the offer: an apology, the progress bar, and "No thanks, continue to refund". Then the consent screen and the photo.
- The tone card: Medium · Warm, with the measured skin, lip, eye and hair colours.
- The try-on row: Shell (returned), Bare Honey (best match) and Coral Bay, each labelled "Visual preview, not a guarantee".
- The before/after card: Shell and Bare Honey on the same photo, with the slider dragged across.
- Exchange for Bare Honey, then the confirmation: "Your photo has been deleted".
- The opt-in colour passport, then the orders page with the "Picked for you" shelf and "Your pick".

> **0:23.0** Here is that return, live. Only colour reasons start SecondTry, and the refund stays one tap away.
> **0:31.0** It starts with an apology, then asks for one selfie, used only for this return, and deleted when it ends.
> **0:39.0** YouCam's **AI Facial Color Tones Analyzer** measures their skin, lip, eye and hair colour.
> **0:46.9** SecondTry works out depth and undertone itself, and says it kindly: medium, warm.
> **0:54.7** Plain code ranks the lipsticks in stock by colour distance to a richer version of their own lip colour.
> **1:01.9** YouCam's **AI Makeup Virtual Try-On** shows the returned shade and the top two picks, on their own face.
> **1:09.8** Then side by side, on the same photo: only the shade changes. Each one is labelled a preview, not a guarantee.
> **1:20.0** They take Bare Honey: a free exchange that ships today. The photo is deleted, here and at YouCam.
> **1:28.1** And if they want, a colour passport remembers what works for them: on their phone only, never the photo.

### 1:35–2:03: The dress, with clothes try-on

**On screen:**
- The Hem Wrap Dress · Camel return, and one waist-up photo.
- Camel next to Marigold and Plum, rendered on the model.
- The before/after card (Camel and Marigold), then the exchange.

> **1:35.5** Clothes work the same way. One waist-up photo is enough for the tone analysis and for YouCam's **AI Clothes Virtual Try-On**.
> **1:46.9** For a dress, the goal is contrast and warmth, not a skin match. For this deep, warm profile, Marigold and Plum score ahead of Camel.
> **1:56.8** Makeup and clothes try-on, in one flow, ending in one decision: exchange.

### 2:03–2:35: The merchant dashboard and the agent trace

**On screen:**
- `/merchant` on desktop. The live tiles tick up as the filmed exchange lands.
- The "Who is each shade for?" grid and its gap cards, with the badge "Catalogue × the shopper matcher · no customer data".
- The dashed **Synthetic demo data** section, with a badge.
- The agent traces "over MCP", with units per call, and the unit budget from the credit API.

> **2:02.9** The merchant sees it live: returns started, exchanges accepted, and refund value kept.
> **2:11.0** Every colour return is a lesson. This grid shows who each shade is for, and where the range has gaps, before more returns arrive.
> **2:21.6** This history is synthetic demo data, and it is labelled that way.
> **2:28.2** Under the hood, an agent with eight tools calls YouCam through its **MCP servers**.

### 2:35–2:52: Close

**On screen:** the end card shows:
- the SecondTry wordmark;
- the three YouCam APIs with feature names and units (skin-tone-analysis 20, makeup-vto 1, cloth-v4 2);
- github.com/sarthak-1111/secondtry;
- two phones showing the lipstick and dress before/after cards.

The tagline then changes to the last line.

> **2:34.9** SecondTry: try-on at the moment that matters, the return.
> **2:39.3** Built with YouCam's tone analyzer, makeup try-on and clothes try-on. The code is linked below.
> **2:47.5** Give the next return a second try.

## Checklist (against the rules)

- [x] Between 1 and 3 minutes (2:52)
- [x] Shows the app working on its target devices: a phone for shoppers, desktop for merchants
- [x] Names the YouCam APIs used: AI Facial Color Tones Analyzer, AI Makeup Virtual Try-On, AI Clothes Virtual Try-On, and the MCP servers. The end card lists the feature names and units.
- [x] No copyrighted music: an original CC0 score
- [x] No third-party trademarks: a fictional store, and YouCam named only as the API provider
- [x] "Visual preview, not a guarantee", the refund button and the synthetic-data label are all visible
- [ ] Uploaded **public** to YouTube, with the link pasted in the Devpost form (manual)

## Re-recording it yourself

To make your own take, run the server in live mode with `DEMO_CACHE=1`. Retakes then reuse the cached YouCam results and cost 0 units, and the cache is per photo and product. Use your own photo or YouCam's sample images. Open `/merchant` in a second window. Delete `data/events.jsonl` first if you want the live tiles to start from zero.
