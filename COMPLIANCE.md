# Hackathon compliance checklist

Source pages, read 2026-11-02:
- Overview: https://youcam-api-skin-ai-ecommerce.devpost.com/
- Rules: https://youcam-api-skin-ai-ecommerce.devpost.com/rules
- Resources: https://youcam-api-skin-ai-ecommerce.devpost.com/resources

**Deadline:** Nov 2 2026, 11:45am EST (Nov 3, 01:45 JST). Our target is Nov 2, 21:00 JST.
**Track:** eCommerce VTO. Per the rules, "bring Virtual Try-On together into one seamless, intuitive experience". MirrorMatch chains makeup VTO and clothes VTO in one returns flow.

Legend: ✅ done in the repo · 🟡 partly done or needs a manual step · ⬜ to do

## Submission requirements (Rules §4, "Submission Requirements")

| # | Requirement (paraphrased from the rules) | Where it lives | Status |
|---|---|---|---|
| 1 | The project integrates at least one YouCam API in a functional web or mobile prototype | `server/youcam/*`: skin-tone analysis, makeup VTO, clothes VTO, file API, credit API, task delete | ✅ |
| 2 | A code repository URL with **all** source, assets and instructions needed to run it. Public with a relevant licence, or private and shared with the sponsor | Public repo `sarthak-1111/mirrormatch`, `LICENSE` (MIT), `README.md` setup, `ASSETS.md` | ✅ |
| 3 | A text description of the features and functionality that shows **clear consumer or retail value** | `DESCRIPTION.md` (paste into the Devpost form) | ✅ |
| 4 | Screenshots of the project | `docs/screenshots/*.png` (14 images: workspace, hair colour, lips on the dress, skin analysis, offer, lipstick and dress try-on, before/after, colour passport, agent trace, dashboard, shade-fit matrix, agent suggestions, story page), embedded in the README | ✅ |
| 5 | A 1 to 3 minute demo video showing the experience end-to-end | Produced: 2:55, the story opening, then the workspace on autopilot with live runs of lipstick, hair-colour, foundation (skin analysis) and dress returns, then the merchant dashboard and the agent's suggestions. `VIDEO.md` has the timeline, narration and how it was made | ✅ |
| 5a | The video explains which YouCam APIs are used | All five named in the narration (tone 0:36, makeup 0:51, hair colour 1:16, skin analysis 1:28, clothes 1:42, MCP 2:27) and listed with feature names and units on the end card | ✅ |
| 5b | The video shows the project working on its target device | The shopper app in a phone frame inside the desktop workspace (the same app runs standalone at phone size), the dashboard on desktop | ✅ |
| 5c | Uploaded publicly to YouTube (preferred) or Vimeo, with the link in the form | Manual | ⬜ manual |
| 5d | No third-party trademarks and no copyrighted music | Fictional store "Hue & Hem" and fictional product names; YouCam named only as the API provider; an original CC0 music score; YouCam's official sample photos | ✅ |
| 6 | Judges get access to a working project: a website link, functioning demo or test build. Free and unrestricted until judging ends | **Live demo: https://sarthak-1111.github.io/mirrormatch/** (stable link to a Cloudflare tunnel on the author's workstation; sample-model runs replay real results at 0 units, own photos are live with a daily cap). Also runs locally with only `YOUCAM_API_KEY`, or in mock mode with no key | ✅ (depends on the workstation staying on through judging) |
| 7 | All materials in English | ✅ | ✅ |
| 8 | New project, or significantly updated during the submission period | Built from scratch on 2026-11-02 (see git history) | ✅ |
| 9 | Third-party SDKs, APIs and data used within their licences | YouCam API under its ToS. No other paid API. Optional LLM via any OpenAI-compatible endpoint, configured by the user | ✅ |
| 10 | Original work that doesn't infringe IP or **privacy** rights | Self-made SVG product art. Garment references from the YouCam template catalogue or self-made recolours (`ASSETS.md`). The only people shown are YouCam's official sample images (in screenshots, the story page and the video); no source photos are committed | ✅ |

## Winner obligations (Overview "What to Submit" and Rules §7)

| Requirement | Status |
|---|---|
| Must take part in an exit interview if chosen as a winner | ⬜ Entrant agrees on the form (manual) |
| Must agree to be included in a blog article | ⬜ Entrant agrees on the form (manual) |
| Prize affidavit and forms within 10 business days | n/a until winning |

## Quality bar stated on the overview page

| Expectation | How MirrorMatch meets it | Status |
|---|---|---|
| "Fresh, unexpected solutions to real-world pain points… **not surface-level wrappers**" | The YouCam calls sit inside a returns workflow: deterministic CIELAB/CIEDE2000 matching, an exchange policy engine, an agent with tool calls, escalation, render caps, unit metering, and a merchant analytics loop (product × tone-profile heatmap). The API output feeds decisions; it isn't just displayed | ✅ |
| "Intuitive enough that a first-time user instantly grasps its value" | One question per screen, plain-language copy, ~30-second promise, refund always one tap away, friendly retake guidance | ✅ |
| "Show us real impact beyond a simple API call" | Exchange instead of refund, logged to the merchant dashboard as retained revenue (live events only; synthetic history is labelled) | ✅ |
| Agentic AI workflows (encouraged, not required) | Tool-using agent (`server/agent/*`) with a live trace panel. The LLM is optional and only rewords text | ✅ |

## Judging criteria (Rules §6, equally weighted, after a Stage One pass/fail viability check)

| Criterion | Evidence we point judges to |
|---|---|
| **Technological Implementation:** thorough, skilful YouCam integration; consumer or eCommerce value; non-trivial working code | Six YouCam endpoints across the Skin, Beauty and Fashion categories; full V2 file→task→poll flow with retries and error mapping; ΔE2000 matching; unit metering; unit tests and an e2e test |
| **Design:** a complete, coherent product, not a proof of concept | End-to-end shopper flow (orders → reason → selfie → tone → matches → try-on → exchange → confirmation) plus a merchant dashboard |
| **Potential Impact:** a credible, specific case for a real problem and audience, solved by what's shown | Colour-driven returns of shade-sensitive beauty and fashion items. Demo shows a refund converted into an exchange, end to end |
| **Quality of Idea:** a creative, non-obvious use of a YouCam API from the Skin, Beauty, Fashion… categories; understanding of the problem space | Try-on placed at the *return*, not the product page. That's the moment the shopper has already learned the colour was wrong, and the merchant is about to lose the sale |

Tie-break order is the criteria order above, so Technological Implementation matters most in a tie.

## Our own constraints (from the brief)

| Constraint | Status |
|---|---|
| `YOUCAM_API_KEY` is server-side only, never in the browser or the repo | ✅ (`server/config.js`; secret scan in `scripts/secret-scan.mjs`) |
| Credit balance checked at startup; units logged per call; max 3 renders per return; renders cached per session | ✅ |
| LLM optional; all decisions deterministic; templated fallback | ✅ |
| Fictional store and product names; no real brands or logos | ✅ |
| Selfies processed transiently and deleted at session end (memory only, plus YouCam `task/delete`) | ✅ |
| Synthetic demo data clearly labelled and visually separate from live events | ✅ |

## Social Sharing Bonus (optional, no effect on judging)

500 API units per platform, up to 2. The post must tag @YouCam API, name the APIs used, include "Received API credits for sharing", stay public for 30+ days, and come from an account created before Sep 29 2026. Claim form: https://forms.gle/JwMFYMpaExckupEk7. Deadline is the end of the submission period.
