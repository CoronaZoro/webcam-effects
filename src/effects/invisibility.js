// Invisibility effect.
//   1. Store a picture of the empty background (captureBackground).
//   2. Cut that picture into the shape of the person (using the segmentation mask).
//   3. Draw the cut-out over the live video: the person is replaced by the background behind them.
// "amount" fades 0 -> 1 so you dissolve instead of popping out.
//
// Colour matching: webcams re-adjust exposure and white balance when you step into the shot,
// so the stored background can look slightly different from the live video. We compare the
// two on the parts of the frame where you are NOT, and tint the stored background to match.

const FADE_SECONDS = 0.5;
const DEFAULT_STRENGTH = 1;      // 1 = fully gone, lower = see-through ghost
const SAMPLE_WIDTH = 64;         // colour matching looks at a tiny 64-px-wide copy of the frame
const SAMPLE_EVERY_MS = 250;
const GAIN_SMOOTHING = 0.4;      // how quickly the colour match follows changes
const GAIN_MIN = 0.5;
const GAIN_MAX = 2;
const BACKGROUND_ALPHA_MAX = 8;  // mask alpha (0-255) below this counts as "definitely not the person"

export function createInvisibility(width, height) {
  const background = makeCanvas(width, height);
  const backgroundCtx = background.getContext("2d");
  const layer = makeCanvas(width, height); // background, cut to the person's shape
  const layerCtx = layer.getContext("2d");
  const extra = makeCanvas(width, height); // helper for brightening (see applyGains)
  const extraCtx = extra.getContext("2d");

  const sampleHeight = Math.round((SAMPLE_WIDTH * height) / width);
  const liveSample = makeSample(SAMPLE_WIDTH, sampleHeight);
  const backgroundSample = makeSample(SAMPLE_WIDTH, sampleHeight);
  const maskSample = makeSample(SAMPLE_WIDTH, sampleHeight);

  let gains = [1, 1, 1];          // per-channel (R, G, B) brightness correction for the stored background
  let gainsKnown = false;
  let lastSampleTime = -Infinity;
  let strength = DEFAULT_STRENGTH;

  let captured = false;
  let invisible = false; // where we are heading
  let amount = 0;        // where we are now (0 = visible, 1 = fully invisible)

  // Save the current video frame as the "empty room" picture.
  function captureBackground(video) {
    backgroundCtx.drawImage(video, 0, 0, width, height);
    captured = true;
    gainsKnown = false; // new picture, so re-measure the colour match from scratch
    lastSampleTime = -Infinity;
  }

  const hasBackground = () => captured;
  const isInvisible = () => invisible;
  const toggle = () => (invisible = !invisible);

  // The mask only needs computing while we are (becoming) invisible or fading back.
  const needsMask = () => invisible || amount > 0;
  const setStrength = (value) => { strength = value; };

  function update(dt) {
    const target = invisible ? strength : 0;
    const step = dt / FADE_SECONDS;
    amount = target > amount ? Math.min(target, amount + step) : Math.max(target, amount - step);
  }

  // Compare live video vs stored background on the pixels where the person is not,
  // and work out how much brighter/darker each colour channel of the background should be.
  function estimateGains(video, personMask, now) {
    if (now - lastSampleTime < SAMPLE_EVERY_MS) return;
    lastSampleTime = now;

    liveSample.ctx.drawImage(video, 0, 0, SAMPLE_WIDTH, sampleHeight);
    backgroundSample.ctx.drawImage(background, 0, 0, SAMPLE_WIDTH, sampleHeight);
    maskSample.ctx.clearRect(0, 0, SAMPLE_WIDTH, sampleHeight);
    maskSample.ctx.drawImage(personMask, 0, 0, SAMPLE_WIDTH, sampleHeight);

    const live = liveSample.read();
    const stored = backgroundSample.read();
    const mask = maskSample.read();

    const liveSum = [0, 0, 0];
    const storedSum = [0, 0, 0];
    let count = 0;
    for (let i = 0; i < mask.length; i += 4) {
      if (mask[i + 3] >= BACKGROUND_ALPHA_MAX) continue; // skip the person
      for (let c = 0; c < 3; c++) {
        liveSum[c] += live[i + c];
        storedSum[c] += stored[i + c];
      }
      count++;
    }
    if (count < 50) return; // person fills the frame; keep the old values

    for (let c = 0; c < 3; c++) {
      const wanted = (liveSum[c] + 1) / (storedSum[c] + 1);
      const clamped = Math.min(GAIN_MAX, Math.max(GAIN_MIN, wanted));
      gains[c] = gainsKnown ? gains[c] + (clamped - gains[c]) * GAIN_SMOOTHING : clamped;
    }
    gainsKnown = true;
  }

  // Draw the stored background into `layerCtx`, multiplied by the per-channel gains.
  // Canvas can only multiply colours down, so brightening is done in two steps:
  //   result = background x min(gain, 1)  +  background x max(gain - 1, 0)
  function applyGains() {
    const down = gains.map((g) => Math.min(g, 1));
    const up = gains.map((g) => Math.max(g - 1, 0));
    const color = (v) => `rgb(${v.map((x) => Math.round(x * 255)).join(",")})`;

    const needsUp = up.some((v) => v > 0.004);
    if (needsUp) {
      extraCtx.globalCompositeOperation = "source-over";
      extraCtx.drawImage(background, 0, 0);
      extraCtx.globalCompositeOperation = "multiply";
      extraCtx.fillStyle = color(up);
      extraCtx.fillRect(0, 0, width, height);
    }

    layerCtx.globalCompositeOperation = "source-over";
    layerCtx.drawImage(background, 0, 0);
    layerCtx.globalCompositeOperation = "multiply";
    layerCtx.fillStyle = color(down);
    layerCtx.fillRect(0, 0, width, height);
    if (needsUp) {
      layerCtx.globalCompositeOperation = "lighter";
      layerCtx.drawImage(extra, 0, 0);
    }
  }

  // Draw on top of the live video already on ctx. `personMask` is the segmenter's mask canvas.
  function render(ctx, personMask, video) {
    if (amount === 0 || !captured || !personMask) return;

    estimateGains(video, personMask, performance.now());

    layerCtx.globalCompositeOperation = "source-over";
    layerCtx.clearRect(0, 0, width, height);
    applyGains();
    layerCtx.globalCompositeOperation = "destination-in"; // keep background only where the person is
    layerCtx.drawImage(personMask, 0, 0);

    ctx.globalAlpha = amount;
    ctx.drawImage(layer, 0, 0);
    ctx.globalAlpha = 1;
  }

  return { captureBackground, hasBackground, background, toggle, isInvisible, needsMask, setStrength, update, render };
}

// A tiny canvas we can read pixels from quickly.
function makeSample(w, h) {
  const canvas = makeCanvas(w, h);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  return { ctx, read: () => ctx.getImageData(0, 0, w, h).data };
}

function makeCanvas(w, h) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}
