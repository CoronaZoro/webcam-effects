// Hand tracking with MediaPipe. Finds the index fingertip in each video frame.
//
// MediaPipe returns 21 landmarks per hand, as x/y between 0 and 1.
// We use: 0 = wrist, 6 = index middle joint, 8 = index fingertip.
import { FilesetResolver, HandLandmarker } from "@mediapipe/tasks-vision";

const WASM_PATH = "/mediapipe/wasm";
const MODEL_PATH = "/mediapipe/hand_landmarker.task";

const WRIST = 0;
const INDEX_PIP = 6;
const INDEX_TIP = 8;

const SMOOTHING = 0.5; // 0 = frozen, 1 = no smoothing. Steadies the jittery fingertip.

export async function createHands() {
  const vision = await FilesetResolver.forVisionTasks(WASM_PATH);
  const landmarker = await HandLandmarker.createFromOptions(vision, {
    baseOptions: { modelAssetPath: MODEL_PATH, delegate: "GPU" },
    runningMode: "VIDEO",
    numHands: 1,
  });

  let lastVideoTime = -1;
  let result = { visible: false, pointing: false, x: 0, y: 0 };

  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

  // Call once per frame. Returns the latest result (reuses the old one if the video hasn't advanced).
  // x and y are fractions of the video width/height (0..1).
  function detect(video) {
    if (video.currentTime === lastVideoTime) return result;
    lastVideoTime = video.currentTime;

    const { landmarks } = landmarker.detectForVideo(video, performance.now());
    const hand = landmarks[0];
    if (!hand) {
      result = { visible: false, pointing: false, x: 0, y: 0 };
      return result;
    }

    const tip = hand[INDEX_TIP];
    // Index counts as "extended" when the tip is farther from the wrist than the joint below it.
    const pointing = dist(tip, hand[WRIST]) > dist(hand[INDEX_PIP], hand[WRIST]);

    // Smooth only while the hand stays visible; jump straight to the new position on first sight.
    const x = result.visible ? result.x + (tip.x - result.x) * SMOOTHING : tip.x;
    const y = result.visible ? result.y + (tip.y - result.y) * SMOOTHING : tip.y;
    result = { visible: true, pointing, x, y };
    return result;
  }

  return { detect };
}
