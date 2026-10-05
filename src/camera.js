// Opens the webcam and plays it into a hidden <video> element.

const VIDEO_CONSTRAINTS = {
  width: { ideal: 1280 },
  height: { ideal: 720 },
  facingMode: "user",
};

// Turn the browser's cryptic error names into a message a person can act on.
function friendlyError(err) {
  switch (err.name) {
    case "NotAllowedError":
      return "Camera access was blocked. Click the camera icon in the address bar, allow access, then try again.";
    case "NotFoundError":
      return "No camera found. Plug one in or check System Settings, then try again.";
    case "NotReadableError":
      return "The camera is busy. Close other apps using it (Zoom, Meet, Photo Booth) and try again.";
    default:
      return `Could not start the camera (${err.name}).`;
  }
}

export async function startCamera(video) {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("This browser cannot access the camera. Use Chrome on localhost or HTTPS.");
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: VIDEO_CONSTRAINTS });
    video.srcObject = stream;
    await video.play();
    return stream;
  } catch (err) {
    throw new Error(friendlyError(err));
  }
}
