// Fog effect: a frosted, blurred copy of the video that fades in over the live feed.
//
// Two pieces:
//   1. A "mask" canvas. Its alpha at each pixel is how foggy that pixel is (0 = clear, 1 = fully fogged).
//   2. A "fog layer" built each frame: blurred video + white tint, cut to the shape of the mask.
// Blowing fills the mask in. Later steps will erase parts of it (finger wiping).

const FOG_IN_SECONDS = 1.5;      // how long the fog takes to roll in after a blow
const FOG_OUT_SECONDS = 0.5;     // how long it takes to fade away on Clear
const REGROW_SECONDS = 20;       // wiped patches slowly fill back in over about this long
const TINT = "rgba(240, 246, 252, 0.72)"; // cool white frost
const FOG_FILTER_EXTRA = "brightness(1.12) saturate(0.7)"; // paler, less colourful: wiped strokes pop more
const GRAIN_ALPHA = 0.07;        // strength of the frosted-glass speckle
const EDGE_SHADOW = "rgba(0, 0, 0, 0.4)"; // soft shadow inside wiped strokes, gives them depth
const EDGE_SHADOW_BLUR = 14;
const BLUR_PX = 8;
const BLUR_SCALE = 0.25;         // blur at quarter resolution: cheap, and looks softer
const BRUSH_RADIUS = 38;         // finger wipe size in video pixels
const BRUSH_SOFTNESS = 0.45;     // 0 = hard edge, 1 = fully feathered

// Turns "takes about N seconds" into a per-second rate for the exponential fill.
const rateFor = (seconds) => 3 / seconds;

export function createFog(width, height) {
  const mask = makeCanvas(width, height);
  const fogLayer = makeCanvas(width, height);
  const small = makeCanvas(Math.round(width * BLUR_SCALE), Math.round(height * BLUR_SCALE));
  const maskCtx = mask.getContext("2d");
  const grain = makeGrain(fogLayer.getContext("2d"));
  const fogCtx = fogLayer.getContext("2d");
  const smallCtx = small.getContext("2d");

  // "idle" = no fog yet, "in" = rolling in, "hold" = fogged (slowly regrowing), "out" = clearing
  let phase = "idle";
  let phaseTime = 0;

  function trigger() {
    phase = "in";
    phaseTime = 0;
  }

  function clear() {
    phase = "out";
    phaseTime = 0;
  }

  // Move the mask toward full fog (amount of fog added per second is `rate`).
  function fill(dt, rate) {
    maskCtx.globalCompositeOperation = "source-over";
    maskCtx.fillStyle = `rgba(255, 255, 255, ${1 - Math.exp(-rate * dt)})`;
    maskCtx.fillRect(0, 0, width, height);
  }

  function fadeOut(dt, rate) {
    maskCtx.globalCompositeOperation = "destination-out";
    maskCtx.fillStyle = `rgba(0, 0, 0, ${1 - Math.exp(-rate * dt)})`;
    maskCtx.fillRect(0, 0, width, height);
  }

  // ---- Wiping ----
  let lastPoint = null;

  // Erase fog under a soft round brush.
  function stamp(x, y) {
    const gradient = maskCtx.createRadialGradient(x, y, BRUSH_RADIUS * (1 - BRUSH_SOFTNESS), x, y, BRUSH_RADIUS);
    gradient.addColorStop(0, "rgba(0, 0, 0, 1)");
    gradient.addColorStop(1, "rgba(0, 0, 0, 0)");
    maskCtx.fillStyle = gradient;
    maskCtx.fillRect(x - BRUSH_RADIUS, y - BRUSH_RADIUS, BRUSH_RADIUS * 2, BRUSH_RADIUS * 2);
  }

  // Wipe a line from the previous fingertip position to this one (x, y in video pixels).
  function wipe(x, y) {
    if (phase === "idle") return;
    maskCtx.globalCompositeOperation = "destination-out";
    const from = lastPoint ?? { x, y };
    const distance = Math.hypot(x - from.x, y - from.y);
    // Stamp every few pixels so fast movement leaves a continuous line, not dots.
    const steps = Math.max(1, Math.ceil(distance / (BRUSH_RADIUS / 4)));
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      stamp(from.x + (x - from.x) * t, from.y + (y - from.y) * t);
    }
    lastPoint = { x, y };
  }

  // Call when the finger lifts so the next touch doesn't draw a line from the old spot.
  function endStroke() {
    lastPoint = null;
  }

  function update(dt) {
    phaseTime += dt;
    if (phase === "in") {
      fill(dt, rateFor(FOG_IN_SECONDS));
      if (phaseTime > FOG_IN_SECONDS) phase = "hold";
    } else if (phase === "hold") {
      fill(dt, rateFor(REGROW_SECONDS));
    } else if (phase === "out") {
      fadeOut(dt, rateFor(FOG_OUT_SECONDS));
      if (phaseTime > FOG_OUT_SECONDS * 2) {
        maskCtx.clearRect(0, 0, width, height);
        phase = "idle";
      }
    }
  }

  // Draw the fog on top of whatever is already on `ctx`.
  // `cursor` (optional, video pixels) draws a small ring showing where the brush is.
  function render(ctx, video, cursor) {
    if (phase === "idle") return;

    // Blurred, tinted video...
    smallCtx.drawImage(video, 0, 0, small.width, small.height);
    fogCtx.globalCompositeOperation = "source-over";
    fogCtx.filter = `blur(${BLUR_PX}px) ${FOG_FILTER_EXTRA}`;
    fogCtx.drawImage(small, 0, 0, width, height);
    fogCtx.filter = "none";
    fogCtx.fillStyle = TINT;
    fogCtx.fillRect(0, 0, width, height);
    fogCtx.globalAlpha = GRAIN_ALPHA;
    fogCtx.fillStyle = grain;
    fogCtx.fillRect(0, 0, width, height);
    fogCtx.globalAlpha = 1;

    // ...kept only where the mask says there is fog.
    fogCtx.globalCompositeOperation = "destination-in";
    fogCtx.drawImage(mask, 0, 0);

    // The shadow falls into the wiped areas next to the fog, so strokes look like cut-out glass.
    ctx.save();
    ctx.shadowColor = EDGE_SHADOW;
    ctx.shadowBlur = EDGE_SHADOW_BLUR;
    ctx.drawImage(fogLayer, 0, 0);
    ctx.restore();

    if (cursor) {
      ctx.beginPath();
      ctx.arc(cursor.x, cursor.y, BRUSH_RADIUS * 0.6, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(255, 255, 255, 0.7)";
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }

  const isActive = () => phase === "in" || phase === "hold";

  return { trigger, clear, wipe, endStroke, update, render, isActive };
}

function makeCanvas(w, h) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

// A small tile of random speckle, repeated over the fog like frost texture.
function makeGrain(ctx) {
  const size = 256;
  const tile = makeCanvas(size, size);
  const tileCtx = tile.getContext("2d");
  const image = tileCtx.createImageData(size, size);
  for (let i = 0; i < image.data.length; i += 4) {
    const v = Math.random() * 255;
    image.data[i] = image.data[i + 1] = image.data[i + 2] = v;
    image.data[i + 3] = 255;
  }
  tileCtx.putImageData(image, 0, 0);
  return ctx.createPattern(tile, "repeat");
}
