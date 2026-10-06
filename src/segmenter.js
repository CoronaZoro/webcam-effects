// Person segmentation with MediaPipe. Produces a mask: opaque where a person is, transparent elsewhere.
// The invisibility effect (later steps) uses this mask to swap the person for the stored background.
import { FilesetResolver, ImageSegmenter } from "@mediapipe/tasks-vision";

const WASM_PATH = "/mediapipe/wasm";
const MODEL_PATH = "/mediapipe/selfie_segmenter.tflite";

// The model gives a soft 0..1 "person-ness" per pixel. We squash it so edges are
// clean but still soft: below EDGE_LOW = background, above EDGE_HIGH = person.
const EDGE_LOW = 0.35;
const EDGE_HIGH = 0.65;
const FEATHER_PX = 6;            // extra blur when scaling the mask up = soft edge
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

  // The model's own output is small (256x256). We fill this tile, then scale it up.
  let tile = null;
  let tileCtx = null;
  let tileImage = null;

  let lastVideoTime = -1;
  let cornerAverage = 0; // running average of the top corners, used to detect an inverted mask

  const smoothstep = (v) => {
    const t = Math.min(1, Math.max(0, (v - EDGE_LOW) / (EDGE_HIGH - EDGE_LOW)));
    return t * t * (3 - 2 * t);
  };

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

      if (!tile) {
        tile = makeCanvas(w, h);
        tileCtx = tile.getContext("2d");
        tileImage = tileCtx.createImageData(w, h);
      }
      const inverted = isInverted(values, w);
      const data = tileImage.data;
      for (let i = 0; i < values.length; i++) {
        const v = inverted ? 1 - values[i] : values[i];
        data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = 255;
        data[i * 4 + 3] = smoothstep(v) * 255;
      }
      tileCtx.putImageData(tileImage, 0, 0);
    });

    if (!tile) return;
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

  return { update, drawDebug, mask };
}

function makeCanvas(w, h) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}
