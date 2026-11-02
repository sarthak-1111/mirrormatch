# YouCam API notes (hour-1 verification)

Sources:
- Docs v1.17: https://docs.perfectcorp.com/develop/introduction. OpenAPI bundles downloaded from `https://docs.perfectcorp.com/_bundle/reference/<api>.json`.
- Live checks with `scripts/verify-api.mjs` and `scripts/check-mcp.mjs`.

Raw API outputs are **not** committed. They go to `./raw/`, which is gitignored.

Status legend: **D** = confirmed in the official docs/OpenAPI · **L** = confirmed with a live call from this repo

## Base URL and auth

| Item | Value | Status |
|---|---|---|
| API server | `https://yce-api-01.makeupar.com` (same host for all regions in the docs) | D |
| Auth | `Authorization: Bearer <YOUCAM_API_KEY>`. The key stays server-side only | D |
| Rate limit | 250 requests per 300 s per IP **and** per token (~5 QPS). Returns 429 when exceeded | D |
| File retention | Uploaded files and `file_id` last 30 days. `task_id` lasts 30 days (the OpenAPI text says results are queryable for 24 h). **Result download URLs are valid for 2 hours**; re-query the task for a fresh URL | D |
| Units | Charged only when a task reaches `success`. No charge while `running` or on `error`. Units nearest expiry are used first | D |
| Polling | Mandatory. A task you don't poll times out (units are still consumed) and later returns `InvalidTaskId` | D |

## V2 server-to-server flow

1. `POST /s2s/v2.0/file` with body `{"files":[{"content_type":"image/jpeg","file_name":"x.jpg","file_size":<bytes>}]}`. Returns `data.files[0].file_id` plus `requests[0].{url, method:"PUT", headers}`. **D**
2. `PUT <requests[0].url>` with exactly the returned headers (`Content-Type`, `Content-Length`) and the raw bytes. Skipping this step gives a 500/404 later. **D**
3. `POST /s2s/v2.0/task/<feature>` with `src_file_id` (or a public `src_file_url`) and feature params. Returns `data.task_id`. **D**
4. `GET /s2s/v2.0/task/<feature>/<task_id>`. Poll until `data.task_status` is `success` or `error`. Results are in `data.results`. **D**
5. Optional cleanup: `POST /s2s/v2.0/task/delete` with `{"task_id": "..."}` deletes the task **and its input and output files**. SecondTry calls this when a return ends (privacy). **D**

Implementation: `server/youcam/client.js` (`uploadImage`, `runTask`, `pollTask`, `runAndWait`, `deleteTask`).

## Endpoints used by SecondTry

| API | Endpoint | Units (docs) | What it powers in SecondTry | Status |
|---|---|---|---|---|
| Credit balance | `GET /s2s/v1.0/client/credit` → `results[].amount_dec` | 0 | Balance check at startup and after each return; unit floor | D |
| Feature cost | `GET /s2s/v2.0/credit/feature-cost` → `result.skus[].{amount, unit, run_task_url}` | 0 | Loads the real per-call cost at startup to meter units | D |
| File | `POST /s2s/v2.0/file` | 0 | Uploading the selfie and garment references | D |
| **AI Facial Color Tones Analyzer** | `POST/GET /s2s/v2.0/task/skin-tone-analysis` | **20** | Measures skin, lip, eye, eyebrow and hair colour, plus face-quality flags | D |
| **AI Makeup VTO** | `POST/GET /s2s/v2.0/task/makeup-vto` | **1** | Lipstick and foundation try-on in the exact catalogue hex | D |
| **AI Clothes VTO** | `POST/GET /s2s/v2.0/task/cloth-v4` (current; `cloth`/`cloth-v3` older) | **2** documented for V2/V3; V4 cost read from feature-cost at startup | Dress colourway try-on | D |
| Clothes templates | `GET /s2s/v2.0/task/template/cloth` | 0 | Garment template catalogue (checked; references are self-made, see ASSETS.md) | D |
| Look templates | `GET /s2s/v2.0/task/template/look-vto` + `POST /s2s/v2.0/task/look-vto` | 2 | Not used: looks are preset makeup templates, and we need exact catalogue shades | D |
| Task delete | `POST /s2s/v2.0/task/delete` | 0 | Deletes the selfie and renders on YouCam's side at session end | D |
| Skin analysis (optional) | `POST /s2s/v2.0/task/skin-analysis` (v2.1 also exists) | 9–22 | Not used: skin concerns aren't needed for shade matching, and it would cost units | D |

### skin-tone-analysis: request and response

Request: `{ "src_file_id": "...", "face_angle_strictness_level": "strict|high|medium|low|flexible" }`. The default is `high` (≤10° pitch/yaw/roll). SecondTry uses `medium` (≤15°) so phone selfies pass.

Response `data.results`:

```text
face_quality: { has_face: bool, area: "good"|…, frontal: "good"|…, lighting: "good"|…, faceangle: "good"|… }
color: {
  skin_color:      "#rrggbb"
  lip_color:       "#rrggbb"
  eye_color:       "#rrggbb",  eye_color_name:  Amber|Brown|Green|Blue|Gray|Other
  eyebrow_color:   "#rrggbb"
  hair_color:      one of 7 fixed hexes,  hair_color_name: Auburn|Black|Blonde|Brown|Grey/White|Red
}
```

**No undertone or depth label is returned.** SecondTry derives them deterministically (`server/color/tone.js`):
- **depth** from the Individual Typology Angle, `ITA° = atan2(L* − 50, b*)`, using Chardon's six bands, grouped into light, medium and deep for the heatmap.
- **undertone** from the CIELAB hue angle `h_ab` of `skin_color`: below 52° is cool, 52–60° neutral, 60° and up warm. Thresholds shift down 3° when L* < 45.
- **contrast** from |L*(hair) − L*(skin)|. It sets how bold a garment colour can be.

Image rules: jpg/png, < 10 MB, long side ≤ 4096 (auto-resized above 1080), at least 320 px, single person. **The face should be wider than 60% of the image.**

Errors: `error_below_min_image_size`, `error_face_position_invalid`, `error_face_position_too_small`, `error_face_position_out_of_boundary`, `error_face_not_forward_facing`, `error_face_angle_{upward,downward,leftward,rightward,left_tilt,right_tilt}`, plus the general codes. Each maps to friendly guidance in `server/youcam/errors.js`.

### makeup-vto: shade and intensity

Request: `{ src_file_id, version: "1.0", effects: [ … ] }`. Each effect has a `category`:
- `lip_color`: `shape.name` (from `lipshape.json`, e.g. `"original"`), `style.type` (`full|ombre|twoTone`), and `palettes[]` with `{ color: "#RRGGBB", texture: matte|gloss|holographic|metallic|satin|sheer|shimmer, colorIntensity: 0–100, … }`. `gloss`/`shimmer*`/`transparencyIntensity` are required for some textures.
- `foundation`: `palettes[]` with `{ color, colorIntensity, glowIntensity, coverageIntensity }`. No pattern.
- `blush`: `pattern.name` (from `blush.json`) and `palettes[]` with `{ color, texture: matte|satin|shimmer, colorIntensity, … }`.
- `skin_smooth`: `{ skinSmoothStrength, skinSmoothColorIntensity }`. **The engine applies 50 by default if you omit it.** SecondTry sends 0/0 so previews show the shade without retouching the shopper.
- Also available: bronzer, concealer, contour, eyebrows, eye_liner, eye_shadow, eyelashes, highlighter, lip_liner.

Response: `data.results.url`, valid 2 h. Image limits: long side < 1920 (the error text says `width < 1920, height < 1080`) and face width ≥ 100 px. The client downsizes to a 1024 px long side.

Errors: `error_below_min_image_size`, `error_exceed_max_image_size`, `error_face_position_*`, `error_face_angle_invalid`, plus general codes.

### Clothes try-on (cloth-v4)

Request: `src_file_id|src_file_url` + (`ref_file_id|ref_file_url` + `garment_category: full_body|upper_body|lower_body|shoes|auto`) **or** `template_id`. Also `change_shoes` (bool) and, on v4, `filter_multi_person` (`off|normal|strict`).

Response: `data.results.url`, valid 2 h.

Source image: 1024×768 recommended (512×384 minimum, max side 4096). One person, filling at least 80% of the frame, **chest up with shoulders visible**, face unobstructed, standing and facing forward.

Reference image: a front-facing product shot of one garment, or a one-person photo whose clothing covers the try-on area.

Errors: `error_pose`, `error_invalid_ref`, `error_apply_region_mismatch`, `error_invalid_src`, `error_multi_person`, `error_editing_failed`, `error_nsfw_content_detected`, plus general codes.

### Error codes we handle

| Code | Where | Shopper sees | Agent action |
|---|---|---|---|
| `error_no_face`, `error_face_parsing` | analysis | "We couldn't find a face…" | retake |
| `error_face_position_*`, `error_face_angle_*`, `error_large_face_angle` | analysis, VTO | specific "move closer / tilt your head…" | retake |
| face_quality `lighting` ≠ good (or our pre-check: mean luma < 55 or > 225) | analysis | "Find soft, even light…" | retake (pre-check costs 0 units) |
| `error_multiple_people` / `error_multi_person` | all | "Make sure only you are in the photo." | retake |
| `CreditInsufficiency` (HTTP 400 `error_code`) / unit floor | any task | matches still shown; previews paused | degrade, or escalate if it hits analysis |
| `InvalidTaskId`, `TaskTimeout`, 429, 5xx | polling | "Something went wrong on our side…" | retry with backoff; 2 analysis failures → escalate to a human |
| 401 `InvalidApiKey` / `InactiveApiKey` / `ExpiredApiKey` | any | generic error | logged; mock mode suggested |

## Live verification (2026-11-02, `scripts/verify-api.mjs`, YouCam official sample photos)

| Call | Result | Latency | Units (measured by balance delta) |
|---|---|---|---|
| `GET /client/credit` | `results[0] = {type: ApiPaygToken, amount_dec: 1000}` | 0.6 s | 0 |
| `GET /credit/feature-cost` | 22 SKUs. **skin-tone-analysis 20, makeup-vto 1, cloth-v4 2**, cloth/cloth-v3 2, look-vto 2, skin-analysis 9–22 | 1.9 s | 0 |
| `GET /task/template/cloth` | 120 templates in 14 categories (e.g. Feminine 21, Sports 20). One plain dress (`flowy_black_dress_feminine`) | 0.8 s | 0 |
| `GET /task/template/look-vto` | Themed looks (Animals, Horoscope, …). Not usable for exact catalogue shades | 0.8 s | 0 |
| File register + PUT (770×1024 JPEG) | `file_id` returned; PUT 200 | 0.3–1.1 s | 0 |
| skin-tone-analysis, close-up selfie | `face_quality` all `good`; all 7 colour fields returned | **6.5 s** | **20** |
| skin-tone-analysis, **waist-up** photo, strictness `high` | `error_face_angle_downward` | 9.8 s | 0 |
| skin-tone-analysis, **waist-up** photo, strictness `low` | success, all colours | 6.7 s | 20 |
| skin-tone-analysis, full-length photo (tiny face) | `error_no_face` | 9.7 s | 0 |
| skin-tone-analysis, image with no face | `error_no_face`, "No face was detected in the source image." | 6.6 s | 0 |
| makeup-vto `lip_color` (matte, intensity 75) | `results.url`; realistic | **6.8–17.8 s** (first call slower) | **1** |
| makeup-vto `foundation` | `results.url`; natural, no retouch with `skin_smooth` 0/0 | 6.8 s | 1 |
| cloth-v4, close-up selfie + dress | `error_pose`: "No body pose was detected in the user image" | 2.4 s | 0 |
| cloth-v4, full-length photo + self-made dress PNG, `full_body` | success, very convincing | **13.4 s** | **2** |
| cloth-v4, **waist-up** photo + dress PNG, `full_body` | success (renders the visible part of the dress) | 14.0 s | 2 |
| `POST /task/delete` | `{status:200}` for each finished task | 0.3–0.7 s | 0 |

Total for this verification: 1000 → 954 units (46 spent, matching the meter).

**Design decisions from these results**
- **Lipstick and foundation returns:** a close-up selfie, tone strictness `medium`. Same photo for makeup-vto.
- **Dress returns:** **one waist-up photo** serves both skin-tone-analysis (strictness `low`) and cloth-v4. A close-up selfie fails cloth-v4 with `error_pose`.
- **Error and failure cost:** errors cost 0 units, so a failed photo is free to retry. Only successes are metered.
- **Expected wait:** one return takes about 7 s for analysis plus about 7–18 s for previews (3 run in parallel). That's within the "about 30 seconds" promise.
- **Garment references:** self-made product PNGs work well as `ref_file_id`. Each one is uploaded once and its `file_id` reused for 25 days.

## MCP servers (live check: `node scripts/check-mcp.mjs beauty`)

- `https://mcp-api-01.makeupar.com/mcp/beauty`: `initialize` → "YouCam for Beauty & Skin Care" v1.0.1, streamable HTTP, Bearer auth. `tools/list` → **50 tools**, including `AI-Facial-Color-Tones-Analyzer`, `AI-Makeup-Virtual-Try-On`, `AI-Look-Virtual-Try-On`, `AI-Skin-Analysis`, `Get-Running-Task-Status`, `Get-Feature-Cost`, `upload_file` (base64 → `file_id`) and `File-Upload` (interactive widget).
- Every task tool takes `{ request: <same body as REST>, polling: bool }`.
- `https://mcp-api-01.makeupar.com/mcp/fashion`: `AI-Clothes-Virtual-Try-On`, `AI-Fabric-Virtual-Try-On`, and the same utility tools.

## MCP decision

The MCP servers **work** and could carry the agent's two YouCam tools: `upload_file`, then `AI-Facial-Color-Tones-Analyzer` / `AI-Makeup-Virtual-Try-On` / `AI-Clothes-Virtual-Try-On` with `polling: true`.

SecondTry's agent still calls **REST directly** by default, for three reasons:
1. The agent's planner is deterministic code, not an LLM choosing tools, so MCP's tool-discovery benefit doesn't apply.
2. REST gives us exact control over metering, retries, timeouts and `task/delete` for privacy.
3. Shopper-facing latency is lower without an extra hop.

The YouCam client sits behind one interface (`server/youcam/client.js`), so an MCP transport can be swapped in. See the roadmap in the README.
