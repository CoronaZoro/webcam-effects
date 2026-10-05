# Webcam Effects

Real-time webcam effects that run entirely in your browser. No backend, nothing is uploaded.

- **Foggy window:** blow into your mic (or press `F`) to fog the screen, then draw on it with your index finger.
- **Snap to vanish:** coming soon.

## Try it

Needs Node 18+ and Chrome.

```bash
npm install
npm run dev
```

Open http://localhost:5173, click **Start camera**, and allow camera + microphone.

## Controls

| Key | Action |
|---|---|
| `F` | Fog the screen (same as blowing) |
| `C` | Clear the fog |

Use the Sensitivity slider if blowing doesn't trigger (or talking does). Click Calibrate while quiet.

Built with Vite, vanilla JS, MediaPipe Tasks Vision and the Web Audio API. See [CLAUDE.md](CLAUDE.md) for the build plan.
