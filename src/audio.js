// Microphone input + blow detection.
//
// How blow detection works:
//   Breath hitting a mic makes a low rumble (wind buffeting), mostly below ~400 Hz.
//   Each frame we measure the loudness of that low band. If it stays above a
//   threshold for a short time, we call it a blow. The threshold is set relative to
//   the room's background noise, which we measure during calibration.

const FFT_SIZE = 2048;          // frequency resolution (bins = FFT_SIZE / 2)
const LOW_MAX_HZ = 400;         // "blow" band: 0..400 Hz
const MID_MIN_HZ = 1000;        // "speech" band: 1..4 kHz, used to tell blowing from talking
const MID_MAX_HZ = 4000;
const LOW_TO_MID_RATIO = 1.0;   // blowing has at least as much low energy as mid energy
const HOLD_MS = 250;            // must stay loud this long to count
const COOLDOWN_MS = 2000;       // ignore new blows right after one fires
const CALIBRATE_MS = 1500;      // how long we listen to room noise

// Sensitivity slider (0..1) -> how far above room noise the blow must be.
const MARGIN_LOW_SENS = 0.35;
const MARGIN_HIGH_SENS = 0.08;

// Average loudness (0..1) of the bins between two frequencies.
function bandLevel(bins, fromHz, toHz, binHz) {
  const from = Math.max(1, Math.floor(fromHz / binHz));
  const to = Math.ceil(toHz / binHz);
  let sum = 0;
  for (let i = from; i < to; i++) sum += bins[i];
  return sum / (to - from) / 255;
}

export function createAudio({ onBlow }) {
  let analyser = null;
  let bins = null;
  let binHz = 0;

  let sensitivity = 0.5;
  let baseline = 0;       // room noise level in the low band
  let threshold = 0.5;    // low-band level that counts as blowing

  let calibrating = false;
  let calibrateStart = 0;
  let calibrateSamples = [];

  let loudSince = null;   // when the current loud stretch began
  let lastBlow = -Infinity;

  function updateThreshold() {
    const margin = MARGIN_LOW_SENS + (MARGIN_HIGH_SENS - MARGIN_LOW_SENS) * sensitivity;
    threshold = Math.min(0.95, baseline + margin);
  }

  async function start() {
    // Browser "voice call" processing would suppress the very noise we want to hear.
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
    const audioCtx = new AudioContext();
    await audioCtx.resume(); // allowed because the user clicked Start
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = FFT_SIZE;
    analyser.smoothingTimeConstant = 0.5;
    // Not connected to the speakers on purpose (would cause feedback).
    audioCtx.createMediaStreamSource(stream).connect(analyser);
    bins = new Uint8Array(analyser.frequencyBinCount);
    binHz = audioCtx.sampleRate / FFT_SIZE;
    calibrate();
  }

  function calibrate() {
    calibrating = true;
    calibrateStart = performance.now();
    calibrateSamples = [];
  }

  function setSensitivity(value) {
    sensitivity = value;
    updateThreshold();
  }

  // Call once per frame. Returns the current readings for the UI.
  function update(now = performance.now()) {
    if (!analyser) return { ready: false, low: 0, threshold, calibrating: false };

    analyser.getByteFrequencyData(bins);
    const low = bandLevel(bins, 0, LOW_MAX_HZ, binHz);
    const mid = bandLevel(bins, MID_MIN_HZ, MID_MAX_HZ, binHz);

    if (calibrating) {
      calibrateSamples.push(low);
      if (now - calibrateStart >= CALIBRATE_MS) {
        baseline = calibrateSamples.reduce((a, b) => a + b, 0) / calibrateSamples.length;
        calibrating = false;
        updateThreshold();
      }
      return { ready: true, low, threshold, calibrating: true };
    }

    const looksLikeBlow = low > threshold && low >= mid * LOW_TO_MID_RATIO;
    if (looksLikeBlow) {
      if (loudSince === null) loudSince = now;
      const heldLongEnough = now - loudSince >= HOLD_MS;
      if (heldLongEnough && now - lastBlow >= COOLDOWN_MS) {
        lastBlow = now;
        onBlow();
      }
    } else {
      loudSince = null;
    }

    return { ready: true, low, threshold, calibrating: false };
  }

  return { start, calibrate, setSensitivity, update };
}
