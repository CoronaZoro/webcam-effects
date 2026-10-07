// Entry point: starts camera + mic and runs the render loop.
// Later steps plug effects into draw() and into the trigger functions below.
import { startCamera } from "./camera.js";
import { createAudio } from "./audio.js";
import { createHands } from "./hands.js";
import { createSegmenter } from "./segmenter.js";
import { bindKeys } from "./keys.js";
import { createFog } from "./effects/fog.js";
import { createInvisibility } from "./effects/invisibility.js";
import * as hud from "./ui/hud.js";

const video = document.getElementById("video");
const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");
const card = document.getElementById("card");
const cardText = document.getElementById("card-text");
const startBtn = document.getElementById("start-btn");

const DEFAULT_CARD_TEXT = cardText.textContent;

// ---- Triggers: called by the detector AND by the keyboard fallback ----
let fog = null;   // created once we know the camera's resolution
let hands = null; // created in the background (the model takes a moment to load)
let invisibility = null;
let segmenter = null;
let showMask = false; // debug view: tint the detected person green

function triggerFog() {
  fog?.trigger();
}

// Detectors call these. They respect the "Audio triggers" switch; the keyboard keys always work.
const onBlowDetected = () => hud.audioTriggersOn() && triggerFog();

// ---- Snap ----
const HAND_RECENT_MS = 700; // a snapping hand is often blurry, so accept a hand seen a moment ago
let lastHandSeen = -Infinity;

function toggleInvisible() {
  if (!invisibility) return;
  // Only block turning it ON; turning it off must always work.
  if (!invisibility.isInvisible()) {
    if (!invisibility.hasBackground()) return hud.flash("Capture the background first (B)");
    if (!segmenter) return hud.flash("Person model still loading…");
  }
  const on = invisibility?.toggle();
  hud.setInvisibleStatus(on);
  hud.flash(on ? "Poof! Invisible" : "Back again");
}

function onSnap() {
  if (!hud.audioTriggersOn()) return;
  const handRecent = performance.now() - lastHandSeen < HAND_RECENT_MS;
  if (hud.snapNeedsHandChecked() && !handRecent) {
    hud.flash("Snap heard, but no hand seen");
    return;
  }
  toggleInvisible();
}

const audio = createAudio({ onBlow: onBlowDetected, onSnap });

bindKeys({
  f: triggerFog,
  c: () => fog?.clear(),
  d: toggleMaskDebug,
  a: hud.toggleAudioTriggers,
  b: captureBackground,
  " ": toggleInvisible,
  h: hud.toggleClean,
});

const COUNTDOWN_SECONDS = 3;

// Give the presenter time to step out of the frame, then save what the camera sees.
function captureBackground() {
  if (!invisibility) return;
  hud.startCountdown(COUNTDOWN_SECONDS, () => {
    invisibility.captureBackground(video);
    hud.setBackgroundPreview(invisibility.background);
    hud.flash("Background captured");
  });
}

function toggleMaskDebug() {
  if (!segmenter) return hud.flash("Person model still loading…");
  showMask = !showMask;
  hud.flash(showMask ? "Mask view on" : "Mask view off");
}

hud.onCapture(captureBackground);
hud.onCalibrate(() => {
  audio.calibrate();
});
hud.onSensitivity((value) => audio.setSensitivity(value));
hud.onSnapSensitivity((value) => audio.setSnapSensitivity(value));
hud.onVanishStrength((value) => invisibility?.setStrength(value));
hud.onMaskEdge((value) => segmenter?.setEdge(value));

// ---- Startup ----
async function start() {
  startBtn.disabled = true;
  startBtn.textContent = "Starting…";
  try {
    await startCamera(video);
    // Canvas uses the camera's real resolution. CSS scales it to the window.
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    fog = createFog(canvas.width, canvas.height);
    invisibility = createInvisibility(canvas.width, canvas.height);
    hud.applyVanishStrength();
    card.classList.add("hidden");
    hud.showHud();
    requestAnimationFrame(draw);
  } catch (err) {
    cardText.textContent = err.message;
    cardText.classList.add("error");
    startBtn.disabled = false;
    startBtn.textContent = "Try again";
    return;
  }

  // Hand tracking loads in the background; the fog works without it until it's ready.
  hud.setHandStatus("Loading hand tracking…");
  createHands()
    .then((h) => { hands = h; })
    .catch(() => hud.setHandStatus("Hand tracking failed"));

  // Person segmentation also loads in the background.
  createSegmenter(canvas.width, canvas.height)
    .then((s) => { segmenter = s; hud.applyMaskEdge(); })
    .catch((err) => console.error("Segmenter failed", err));

  // Mic is optional: if it fails, the camera still works and F still triggers fog.
  try {
    await audio.start();
  } catch {
    hud.setMicStatus("Mic unavailable (use F)");
  }
}

// Instruction shown at the bottom of the screen. One step at a time, in the order of the demo.
function currentHint() {
  if (!fog.isActive()) return "Blow into the mic to fog the glass (or press F)";
  if (!hasWiped) return "Now draw with your index finger";
  if (!invisibility.hasBackground()) return "Press B and step out of the frame to capture the background";
  return invisibility.isInvisible() ? "Snap again to reappear" : "Snap your fingers to vanish (or press Space)";
}

// Runs every frame (~60x per second).
let lastFrame = 0;
let hasWiped = false; // hide the "draw" hint once the user has drawn

function draw(now) {
  const dt = Math.min((now - lastFrame) / 1000, 0.1); // seconds since last frame
  lastFrame = now;

  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  // Finger position in canvas pixels (the canvas has the camera's resolution).
  let cursor = null;
  if (hands) {
    const hand = hands.detect(video);
    if (hand.visible) lastHandSeen = performance.now();
    if (hand.visible && hand.pointing) {
      cursor = { x: hand.x * canvas.width, y: hand.y * canvas.height };
      fog.wipe(cursor.x, cursor.y);
      if (fog.isActive()) hasWiped = true;
    } else {
      fog.endStroke();
    }
    hud.setHandStatus(hand.visible ? (hand.pointing ? "Pointing" : "Hand seen") : "No hand");
  }

  hud.setHint(currentHint());

  // Invisibility goes on top of the video, fog goes on top of that.
  invisibility.update(dt);
  if (segmenter && (showMask || invisibility.needsMask())) segmenter.update(video);
  invisibility.render(ctx, segmenter?.mask, video);

  fog.update(dt);
  fog.render(ctx, canvas, cursor);

  if (showMask) segmenter.drawDebug(ctx);

  const mic = audio.update(now);
  if (mic.ready) {
    hud.setMeter(mic.low, mic.threshold);
    hud.setSnapMeter(mic.high, mic.snapThreshold);
    hud.setMicStatus(mic.calibrating ? "Calibrating… stay quiet" : "Listening");
  }

  requestAnimationFrame(draw);
}

startBtn.addEventListener("click", () => {
  cardText.textContent = DEFAULT_CARD_TEXT;
  cardText.classList.remove("error");
  start();
});
