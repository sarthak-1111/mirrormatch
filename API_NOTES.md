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

## Latency (live)

To be filled in from `scripts/verify-api.mjs` output (see the table below).

| Call | Measured | Notes |
|---|---|---|
| File register + PUT | pending live check | |
| skin-tone-analysis (task + poll) | pending live check | |
| makeup-vto (task + poll) | pending live check | |
| cloth-v4 (task + poll) | pending live check | |

## MCP servers

The docs list hosted MCP servers on streamable HTTP with Bearer auth:
- `https://mcp-api-01.makeupar.com/mcp/beauty`: tools include `AI_Facial_Color_Tones_Analyzer`, `AI_Makeup_Virtual_Try_On`, `AI_Skin_Analysis`, `AI_Look_Virtual_Try_On`, `File_Upload` (an *interactive* browser widget), `Get_Running_Task_Status`, `Get_Feature_Cost`.
- `https://mcp-api-01.makeupar.com/mcp/fashion`: tools include `AI_Clothes_Virtual_Try_On`, `AI_Fabric_Virtual_Try_On`, plus the same utility tools.

Assessment: see "MCP decision" below. Live `tools/list` check is pending.

## MCP decision

Pending live check (`node scripts/check-mcp.mjs beauty`).
