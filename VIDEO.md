# MirrorMatch: demo video (2:55)

**The final cut is 2:55**, 1920×1080, with captions burned in. Everything shown is a real run of this repo in **live** mode against the YouCam API, called through YouCam's hosted MCP servers. The video file is not in the repo. It is uploaded to YouTube, and the link is in the Devpost submission.

## How it was made (and what is not literal)

- **Footage.** The story page, the workspace and the dashboard were recorded on desktop (1440×900). In the workspace, the shopper app runs in a phone frame and **autopilot** plays each return through the real UI (the same buttons a shopper presses). Recordings are scripted with Playwright and captured frame by frame over the Chrome DevTools screencast. Every autopilot step is time-stamped from the app's own messages, so the edit follows the real run.
- **Live calls, real numbers.** The four returns were filmed one after another on one live server, using YouCam's official sample model. The agent console, the badges and the dashboard show that server's real trace: tool names, timings, units. The lipstick and dress tone analyses were live (11.2 s and 7.8 s); the hair-colour and foundation returns reuse the same selfie's tone result from the demo cache (0 units), and the console says `[cache]`. All renders, the skin analysis and the two "complete the look" previews were live (for example 3 clothes renders in parallel, 14.5 s; lips on the dress render, 23.5 s). The merchant's proposed-shade preview was served from the demo cache (0 units), and the page says so.
- **Shortened waits, labelled.** Each wait for YouCam is shortened in the edit, and a badge gives the real duration from the trace.
- **Synthetic demo data** on the dashboard keeps its on-screen label; the fit notes drafted from it say "Synthetic demo data". The live tiles and events come only from the filmed sessions.
- **People and brands.** Alex is a character in the demo story. The model photos are YouCam's official sample images. Hue & Hem and every product are fictional. No third-party brands appear.
- **Audio.** The narrator is a synthetic voice (Bark, open source, MIT). Each line was generated several times, every take was transcribed with Whisper, and the most accurate take was kept. The music is an original score synthesised for this video and released as CC0.
- **Tools.** Remotion lays out the scenes (browser frame, push-ins, badges, the closing card), and FFmpeg does the mix, captions and loudness (EBU R128, −15 LUFS). The final audio was transcribed again and checked against the script and captions.

## Timeline and narration

The YouCam APIs are named in **bold**.

### 0:00–0:23: The problem, as a story

**On screen:** the story page in a desktop browser: Alex's order, "On the screen / In the mirror", the dead end of a normal returns form. Then the MirrorMatch wordmark.

> **0:00.6** Alex ordered a lipstick called Shell, for a friend's wedding. On the screen, it looked like a soft rose.
> **0:07.3** In the mirror, it looked grey. So Alex starts a return, and the store is about to lose the sale.
> **0:18.4** MirrorMatch turns that return into a match.

### 0:23–1:16: The workspace, and the lipstick return on autopilot

**On screen:** the workspace (phone, agent console, merchant strip, environment). Autopilot opens the order, picks "The shade didn't match", accepts the offer (the refund button stays visible), gives consent and uses YouCam's sample model. The tone card (Medium · Warm) and the console rows. Shell, Bare Honey and Coral Bay rendered on the same face, the before/after slider, then Bare Honey with a matching blush in one makeup call. The exchange, and the merchant strip ticking up.

> **0:23.9** This is the MirrorMatch workspace: the shopper's phone, the agent and the store, all connected. On autopilot, the agent runs Alex's return by itself.
> **0:35.7** YouCam's **AI Facial Color Tones Analyzer** measures their skin, lip, eye and hair colour.
> **0:43.7** Plain code ranks the lipsticks in stock by colour distance to a richer version of their own lip colour.
> **0:50.9** YouCam's **AI Makeup Virtual Try-On** shows the returned shade and the top two picks, on their own face.
> **0:58.8** One more makeup call adds a matching blush, so the whole look is previewed, not just the lips.
> **1:07.8** They take Bare Honey: a free exchange that ships today. The photo is deleted, here and at YouCam.

### 1:16–1:28: Hair colour

**On screen:** the Gloss Hair Colour · Ash Blonde return. The tone result comes from the cache (0 units). Ash Blonde next to Golden Brown on the same face, then the exchange.

> **1:16.3** Hair colour works the same way: YouCam's **AI Hair Color** tries the returned dye and two better matches, on the same selfie.

### 1:28–1:41: Foundation and Skin AI

**On screen:** the 3W Sand return. The "Your skin today" card (low shine, well hydrated, even tone → natural finish, light to medium coverage for 4W Honey), the console row for skin analysis (4 concerns, 9 units), then the shades on the same photo.

> **1:28.5** For foundation, YouCam's **AI Skin Analysis** gently reads oiliness, moisture and redness, so the exchange gets the right finish, not just the right shade.

### 1:41–2:01: The dress, then makeup on clothes

**On screen:** the Hem Wrap Dress · Camel return with one waist-up photo; Camel, Marigold and Plum rendered on the model; the before/after slider. Then "Complete the look: lips for Marigold": Bare Honey rendered by makeup try-on onto the Marigold try-on image. The exchange (the lipstick add-on stays unticked).

> **1:41.9** A dress works the same way, with YouCam's **AI Clothes Virtual Try-On** on one waist-up photo.
> **1:52.4** Then makeup meets clothes: a matching lipstick is tried on, right on top of the new dress.

### 2:01–2:36: The merchant, and the agent's suggestions

**On screen:** `/merchant` after the four filmed returns (4 exchanges). The "Who is each shade for?" grid and its gap cards. "What the agent suggests": a proposed new lipstick shade for an under-served profile with its preview on the sample model, approved (logged only). The agent traces with units per call.

> **2:01.4** The merchant sees it live: returns started, exchanges accepted, and refund value kept.
> **2:09.5** Every colour return is a lesson. This grid shows who each shade is for, and where the range has gaps, before more returns arrive.
> **2:20.1** And the agent drafts the fix: a proposed new shade for the gap, previewed on a model, waiting for a person to approve it.
> **2:27.3** Under the hood, every decision is plain code, and the agent calls YouCam through its **MCP servers**, with every unit traced.

### 2:36–2:55: Close

**On screen:** the MirrorMatch wordmark; the five YouCam APIs with feature names and units; the live demo link (sarthak-1111.github.io/mirrormatch) and the code (github.com/sarthak-1111/mirrormatch); two phones showing the hair-colour before/after and the lips on the new dress. The tagline then changes to the last line.

> **2:36.4** MirrorMatch: try-on at the moment that matters, the return.
> **2:42.6** Built with five YouCam AIs: tone and skin analysis, and makeup, hair and clothes try-on. The live demo is linked below.
> **2:50.1** Turn the next return into a match.

## Checklist (against the rules)

- [x] Between 1 and 3 minutes (2:55)
- [x] Shows the app working: the shopper app in a phone frame, the merchant dashboard on desktop
- [x] Names the YouCam APIs used: AI Facial Color Tones Analyzer, AI Skin Analysis, AI Makeup Virtual Try-On, AI Hair Color, AI Clothes Virtual Try-On, and the MCP servers. The end card lists the feature names and units.
- [x] No copyrighted music: an original CC0 score
- [x] No third-party trademarks: a fictional store, and YouCam named only as the API provider
- [x] "Visual preview, not a guarantee", the refund button and the synthetic-data label are all visible
- [ ] Uploaded **public** to YouTube, with the link pasted in the Devpost form (manual)

## Re-recording it yourself

Run the server in live mode with `DEMO_CACHE=1`, open `/workspace.html` and press a "Run a return for me" button. The first run of each flow calls YouCam; repeats replay the cache at 0 units. The pipeline used for this cut is `capture.py --flow workspace --autopilot <lipstick|hair|foundation|dress>` and `--flow merchant-tour`.
