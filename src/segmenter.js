// Person segmentation with MediaPipe. Produces a mask: opaque where a person is, transparent elsewhere.
// The invisibility effect (later steps) uses this mask to swap the person for the stored background.
import { FilesetResolver, ImageSegmenter } from "@mediapipe/tasks-vision";

const WASM_PATH = "/mediapipe/wasm";
const MODEL_PATH = "/mediapipe/selfie_segmenter.tflite";

// The model gives a soft 0..1 "person-ness" per pixel. We squash it so edges are
// clean but still soft: below EDGE_LOW = background, above EDGE_HIGH = person.
// Lower values grow the mask outward a little, so hair wisps and clothing edges are covered.
const EDGE_LOW = 0.2;
const EDGE_HIGH = 0.5;
const FEATHER_PX = 3;            // light blur on the final mask = soft but crisp edge
const REFINED_WIDTH = 512;       // the mask is re-sampled at this width before the edge is cut (see update)
const TEMPORAL_SPEED = 0.5;      // 1 = use each new frame as-is, lower = steadier mask (less edge flicker)
const DEBUG_COLOR = "rgb(60, 255, 150)";
const DEBUG_ALPHA = 0.5;

export async function createSegmenter(width, height) {
  const vision = await FilesetResolver.forVisionTasks(WASM_PATH);
  const segmenter = await ImageSegmenter.createFromOptions(vision, {
    baseOptions: { modelAssetPath: MODEL_PATH, delegate: "GPU" },
    runningMode: "VIDEO",
    outputConfidenceMasks: true,
    outputCategoryMask: false,
  });

  // `mask` is full video size; alpha channel = how much "person" at each pixel.
  const mask = makeCanvas(width, height);
  const maskCtx = mask.getContext("2d");
  const debugLayer = makeCanvas(width, height);
  const debugCtx = debugLayer.getContext("2d");

  // The model's own output is small (256x256) and blocky when stretched to the full frame.
  // We first re-sample it to a finer grid (REFINED_WIDTH wide) with smooth interpolation, THEN
  // apply the threshold. Cutting the edge on the smooth version gives a curved contour instead
  // of stair-steps. `tile` is that finer grid.
  const refinedHeight = Math.round((REFINED_WIDTH * height) / width);
  const tile = makeCanvas(REFINED_WIDTH, refinedHeight);
  const tileCtx = tile.getContext("2d");
  const tileImage = tileCtx.createImageData(REFINED_WIDTH, refinedHeight);
  for (let i = 0; i < tileImage.data.length; i += 4) {
    tileImage.data[i] = tileImage.data[i + 1] = tileImage.data[i + 2] = 255; // white; only alpha changes
  }
  let grid = null; // where each refined pixel samples from in the model's output
  let edgeOffset = 0; // Mask edge slider: moves the threshold to grow (-) or shrink (+) the mask

  let smoothed = null; // the mask averaged over recent frames
  let lastVideoTime = -1;
  let cornerAverage = 0; // running average of the top corners, used to detect an inverted mask

  const smoothstep = (v) => {
    const low = EDGE_LOW + edgeOffset;
    const t = Math.min(1, Math.max(0, (v - low) / (EDGE_HIGH - EDGE_LOW)));
    return t * t * (3 - 2 * t);
  };

  // For every refined pixel, work out which 4 model pixels surround it and how much of each to mix.
  function buildGrid(w, h) {
    const columns = new Array(REFINED_WIDTH);
    for (let x = 0; x < REFINED_WIDTH; x++) {
      const at = Math.min(w - 1, Math.max(0, ((x + 0.5) * w) / REFINED_WIDTH - 0.5));
      const x0 = Math.floor(at);
      columns[x] = { x0, x1: Math.min(w - 1, x0 + 1), fx: at - x0 };
    }
    const rows = new Array(refinedHeight);
    for (let y = 0; y < refinedHeight; y++) {
      const at = Math.min(h - 1, Math.max(0, ((y + 0.5) * h) / refinedHeight - 0.5));
      const y0 = Math.floor(at);
      rows[y] = { y0, y1: Math.min(h - 1, y0 + 1), fy: at - y0 };
    }
    return { w, h, columns, rows };
  }

  // Which way round is the model's mask? Top corners of a webcam shot are almost always
  // background, so if they come out "person", the mask is inverted and we flip it.
  function isInverted(values, w) {
    const corner = 8;
    let sum = 0;
    for (let y = 0; y < corner; y++) {
      for (let x = 0; x < corner; x++) sum += values[y * w + x] + values[y * w + (w - 1 - x)];
    }
    const average = sum / (corner * corner * 2);
    cornerAverage += (average - cornerAverage) * 0.1;
    return cornerAverage > 0.5;
  }

  // Call once per frame while the mask is needed.
  function update(video) {
    if (video.currentTime === lastVideoTime) return;
    lastVideoTime = video.currentTime;

    segmenter.segmentForVideo(video, performance.now(), (result) => {
      const masks = result.confidenceMasks;
      // Two masks = [background, person]; one mask = person.
      const person = masks[masks.length > 1 ? 1 : 0];
      const w = person.width;
      const h = person.height;
      const values = person.getAsFloat32Array();

      if (!smoothed) smoothed = new Float32Array(values.length);
      if (!grid) grid = buildGrid(w, h);

      // 1. Average the model's output over the last few frames (steadier edge).
      const inverted = isInverted(values, w);
      for (let i = 0; i < values.length; i++) {
        const raw = inverted ? 1 - values[i] : values[i];
        smoothed[i] += (raw - smoothed[i]) * TEMPORAL_SPEED;
      }

      // 2. Re-sample to the finer grid with smooth interpolation, then cut the edge.
      const data = tileImage.data;
      let out = 3; // alpha byte of the first pixel
      for (let y = 0; y < refinedHeight; y++) {
        const { y0, y1, fy } = grid.rows[y];
        const top = y0 * w;
        const bottom = y1 * w;
        for (let x = 0; x < REFINED_WIDTH; x++) {
          const { x0, x1, fx } = grid.columns[x];
          const upper = smoothed[top + x0] * (1 - fx) + smoothed[top + x1] * fx;
          const lower = smoothed[bottom + x0] * (1 - fx) + smoothed[bottom + x1] * fx;
          data[out] = smoothstep(upper * (1 - fy) + lower * fy) * 255;
          out += 4;
        }
      }
      tileCtx.putImageData(tileImage, 0, 0);
    });

    if (!grid) return;
    maskCtx.clearRect(0, 0, width, height);
    maskCtx.filter = `blur(${FEATHER_PX}px)`;
    maskCtx.drawImage(tile, 0, 0, width, height);
    maskCtx.filter = "none";
  }

  // Debug view: tint the detected person green so we can check the mask.
  function drawDebug(ctx) {
    debugCtx.globalCompositeOperation = "source-over";
    debugCtx.fillStyle = DEBUG_COLOR;
    debugCtx.fillRect(0, 0, width, height);
    debugCtx.globalCompositeOperation = "destination-in";
    debugCtx.drawImage(mask, 0, 0);
    ctx.globalAlpha = DEBUG_ALPHA;
    ctx.drawImage(debugLayer, 0, 0);
    ctx.globalAlpha = 1;
  }

  const setEdge = (value) => { edgeOffset = value; };

  return { update, drawDebug, setEdge, mask };
}

function makeCanvas(w, h) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}
