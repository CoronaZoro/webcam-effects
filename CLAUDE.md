# Webcam Effects Demo

Browser-only, real-time computer vision demo for an internship show-and-tell. No backend. Runs in Chrome on a MacBook, demoed live through Google Meet via OBS Virtual Camera.

## Goal

Two effects on the live webcam feed:

1. **Foggy window whiteboard.** Blow into the mic and the feed fogs over (blurred + white tint, like breath on glass). Then draw on the fog with the index finger; fog is wiped where the fingertip moves. Fog slowly regrows on its own. Blowing again re-fogs fully.
2. **Snap to vanish.** Snap fingers and the person disappears, leaving only the empty background (soft feathered edge). Snap again to reappear.

Audience: mixed (engineers + designers). Presenter is a UX/UI design intern, so the visuals and the small UI must look clean and intentional. Presenter must be able to explain the code, so keep it simple and readable.

## Stack

- **Vite + vanilla JS** (ES modules). No framework: the app is one canvas render loop plus a few detectors; React adds nothing here.
- **MediaPipe Tasks Vision** (`@mediapipe/tasks-vision`)
  - Hand Landmarker: index fingertip tracking, "pointing" pose, hand-visible check for snap.
  - Image Segmenter (selfie segmenter model): person mask for invisibility.
- **Web Audio API** (`AnalyserNode`): blow detection and snap detection.
- **Canvas 2D** for compositing (WebGL only if 2D is too slow).
- **Vercel** for deploy (static site).
- WASM + model files are **self-hosted in `public/mediapipe/`** so the demo does not depend on a CDN or venue wifi.

## How it is shown in Meet

Browser tabs cannot replace Meet's camera directly. Plan (Option A):
1. Run the web app (Vercel link or localhost).
2. OBS Studio captures the browser window and exposes it as **OBS Virtual Camera**.
3. In Meet, select "OBS Virtual Camera" as the camera.
4. Press `H` to hide all UI so only the video canvas is visible.

Fallback: share the browser tab in Meet instead. Stretch goal (only if all else is done): Chrome extension patching `getUserMedia` on meet.google.com.

macOS notes: OBS needs a one-time system extension approval (do it before demo day). Chrome needs Camera + Microphone permission for the site. Both `localhost` and Vercel (HTTPS) count as secure contexts, so `getUserMedia` works; plain `http://` on a LAN IP does not.

## Controls (manual fallbacks are mandatory for live demo)

| Key | Action |
|---|---|
| `1` / `2` | Switch to Fog mode / Invisibility mode |
| `F` | Trigger fog (same as blowing) |
| `C` | Clear fog |
| `Space` | Toggle invisible/visible (same as snap) |
| `B` | Capture background (3s countdown, step out of frame) |
| `H` | Hide/show all UI (clean mode for OBS) |
| `D` | Debug: tint the detected person green (mask view) |

## Design direction

- Minimal, clean, **dark** control layer: semi-transparent dark panels, one accent colour, system/Inter-style font.
- The video fills the window (mirrored, selfie view). UI floats on top and is fully hideable.
- UI pieces: mode switcher, short hint text ("Blow into the mic"), small audio level + hand-detected indicators, calibration/sensitivity control, countdown overlay for background capture.
- Most polish effort goes into the effects themselves: fog blur/tint/texture, soft wipe edge, feathered vanish transition.

## Detection approach

- **Blow:** sustained low-frequency energy on the mic above a calibrated threshold for ~250 ms. Needs a quick calibration (measure room noise) and a sensitivity slider.
- **Snap:** short, sharp audio transient AND a hand visible in frame at that moment. Audio-only mode available behind a toggle. Spacebar always works.
- **Wipe:** only the index fingertip position, drawn as a soft brush into a fog-alpha mask. Fog alpha regrows slowly each frame.
- **Invisibility:** segmentation mask (feathered) decides, per pixel, between live frame and stored background frame.

## Folder structure (planned)

```
webcam_ai/
  CLAUDE.md
  index.html
  package.json
  vite.config.js
  public/
    mediapipe/          # self-hosted wasm + .task/.tflite models
  src/
    main.js             # entry: wires everything, render loop
    camera.js           # getUserMedia, video element
    audio.js            # mic stream, AnalyserNode, blow + snap detectors
    hands.js            # Hand Landmarker wrapper, fingertip + pose helpers
    segmenter.js        # Image Segmenter wrapper, person mask
    effects/
      fog.js            # fog mask, regrow, wipe, draw to canvas
      invisibility.js   # background capture, mask compositing, toggle
    ui/
      ui.js             # mode switcher, hints, indicators, hide toggle
      styles.css
    keys.js             # keyboard shortcuts / manual fallbacks
```

## Coding conventions

- Vanilla JS, ES modules, one responsibility per file, small functions.
- No TypeScript, no framework, minimal dependencies (only `@mediapipe/tasks-vision` + Vite).
- Short comments explaining *why*, plus a one-line header comment per file saying what it does (the presenter must be able to explain it).
- Constants (thresholds, fog speed, brush size) live at the top of the relevant file or in one `config.js`, never magic numbers inline.
- CSS custom properties for colours/spacing; dark theme tokens defined once.
- Each detector exposes a simple event/callback (`onBlow`, `onSnap`) so keyboard fallbacks call the same code path.

## Run and test

```bash
npm install
npm run dev        # http://localhost:5173 (camera/mic allowed on localhost)
npm run build      # production build to dist/
npm run preview    # serve the production build locally
```

Testing is manual in Chrome (laptop): grant camera + mic, check each step's "how to test" note. Gesture/audio cannot be verified headlessly, so the user tests; every feature must also work via its keyboard fallback.

## Build plan

Each step ends with: summary of what changed, how to test, and a pause for confirmation. Update this file as steps complete or decisions change.

- [x] **1. Project setup.** Vite vanilla scaffold, folder structure, dark base styles, dev server runs.
- [x] **2. Webcam feed.** Mirrored video drawn to a full-window canvas; permission and error states.
- [x] **3. Audio input + blow detection.** Mic stream, level meter, calibration, `onBlow`, `F` fallback.
- [x] **4. Fog overlay.** Blur + white tint layer fades in on blow; `C` clears; slow regrow.
- [x] **5. Hand tracking + finger wiping.** Hand Landmarker, index fingertip brush wipes fog; self-hosted model files.
- [x] **6. Polish effect 1.** Fog texture/grain, soft brush edge, re-blow behaviour, hint text, performance check.
- [x] **7. Person segmentation.** Image Segmenter, feathered mask (debug view to verify).
- [x] **8. Background capture.** `B` with 3s countdown, stored background frame.
- [x] **9. Snap detection.** Audio transient + hand-visible check, audio-only toggle, `Space` fallback.
- [ ] **10. Invisibility toggle.** Composite background vs live via mask, soft transition.
- [ ] **11. Polish effect 2.** Edge quality, transition animation, stability.
- [ ] **12. Mode switcher UI + `H` clean mode.** Final dark minimal UI, hints, indicators.
- [ ] **13. OBS test.** Verify OBS Virtual Camera in Google Meet on the MacBook.
- [ ] **14. Deploy.** Git + GitHub + Vercel, check HTTPS permissions on the live link.

Order note: effect 1 is fully finished (steps 1-6) before touching effect 2.

## Decisions log

- Snap detection: second AnalyserNode (no smoothing), 2-8 kHz band. Onset = level jumps above a slowly-tracked baseline; confirmed if it falls back within ~120 ms (sustained sounds rejected after 400 ms). Needs a hand seen in the last 700 ms unless "Snap needs hand" is unticked. `Space` calls the same toggle.

- Segmenter: `selfie_segmenter.tflite` (float16), self-hosted. Mask = soft confidence squashed with smoothstep (0.35..0.65) then blurred 6 px for a feathered edge. The model's output polarity is auto-detected from the top corners (should be background), so it works either way. Mask only computed while needed (debug view now; invisibility later).

- Wipe rule: brush follows the index fingertip whenever the index is extended (tip farther from wrist than the middle joint). A fist does not wipe. No strict "pointing" gesture, per presenter preference.
- Hand model + wasm are self-hosted in `public/mediapipe/` (hand_landmarker.task float16, ~7.8 MB; wasm folder copied from node_modules).

- Mirroring is done with CSS (`transform: scaleX(-1)` on the canvas), not in drawing code. The canvas always holds raw camera pixels, so hand/mask coordinates map 1:1 with no flipping math. Canvas is shown letterboxed (`object-fit: contain`).
- A "Start camera" card is the entry point (also gives us the user gesture needed later for the AudioContext).

- 2026-10-05: Vanilla JS over React. Option A (OBS Virtual Camera) over Chrome extension. Dark minimal UI. Snap = audio + hand visible by default. Background capture is manual (`B`). Fog regrows slowly and re-blow re-fogs fully. Mirrored selfie view.
