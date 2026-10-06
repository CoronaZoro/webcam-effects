// Keyboard shortcuts. These are the manual fallbacks for the live demo:
// each key calls the same function the gesture/audio detector would call.

export function bindKeys(handlers) {
  const find = (e) => (e.metaKey || e.ctrlKey || e.altKey ? undefined : handlers[e.key.toLowerCase()]);

  window.addEventListener("keydown", (e) => {
    const handler = find(e);
    if (!handler) return;
    e.preventDefault();
    if (!e.repeat) handler();
  });

  // Space "clicks" whichever button has focus when the key is released; stop that.
  window.addEventListener("keyup", (e) => {
    if (find(e)) e.preventDefault();
  });
}
