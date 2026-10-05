// Keyboard shortcuts. These are the manual fallbacks for the live demo:
// each key calls the same function the gesture/audio detector would call.

export function bindKeys(handlers) {
  window.addEventListener("keydown", (e) => {
    if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
    const handler = handlers[e.key.toLowerCase()];
    if (handler) {
      e.preventDefault();
      handler();
    }
  });
}
