// Invisibility effect. For now: stores a picture of the empty background.
// Later steps composite this picture over the person using the segmentation mask.

export function createInvisibility(width, height) {
  const background = document.createElement("canvas");
  background.width = width;
  background.height = height;
  const backgroundCtx = background.getContext("2d");

  let captured = false;

  // Save the current video frame as the "empty room" picture.
  function captureBackground(video) {
    backgroundCtx.drawImage(video, 0, 0, width, height);
    captured = true;
  }

  const hasBackground = () => captured;

  return { captureBackground, hasBackground, background };
}
