// Small heads-up display: mic meter, calibrate button, sensitivity slider, toast.

const hud = document.getElementById("hud");
const meterFill = document.getElementById("meter-fill");
const meterThreshold = document.getElementById("meter-threshold");
const micStatus = document.getElementById("mic-status");
const handStatus = document.getElementById("hand-status");
const calibrateBtn = document.getElementById("calibrate-btn");
const sensitivity = document.getElementById("sensitivity");
const hint = document.getElementById("hint");
const toast = document.getElementById("toast");

let toastTimer;

export function showHud() {
  hud.classList.remove("hidden");
}

export function setMeter(level, threshold) {
  meterFill.style.width = `${Math.min(1, level) * 100}%`;
  meterThreshold.style.left = `${Math.min(1, threshold) * 100}%`;
}

export function setMicStatus(text) {
  micStatus.textContent = text;
}

export function setHandStatus(text) {
  handStatus.textContent = text;
}

// Persistent instruction near the bottom. Pass null to hide it.
export function setHint(text) {
  if (text) hint.textContent = text;
  hint.classList.toggle("show", Boolean(text));
}

// Brief message near the top of the screen.
export function flash(text) {
  toast.textContent = text;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 1200);
}

export function onCalibrate(fn) {
  calibrateBtn.addEventListener("click", fn);
}

// Slider gives 0..100; we pass 0..1.
export function onSensitivity(fn) {
  sensitivity.addEventListener("input", () => fn(sensitivity.value / 100));
  fn(sensitivity.value / 100);
}
