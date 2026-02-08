# interactive-gesture-vfx

Interactive gesture VFX built with **Three.js** and **MediaPipe Tasks Vision**. The camera tracks both hands in real time and maps gestures to a 15,000 particle swarm to create a 3D heart, 3D text, and continuous fireworks.

## Demo
- GitHub Pages: https://taoy66.github.io/interactive-gesture-vfx/

## How it works
- **Webcam input**
  - Uses `getUserMedia()` to capture the camera stream.
- **Hand tracking**
  - MediaPipe **HandLandmarker** detects up to 2 hands and returns **21 3D landmarks per hand** per frame.
  - Distances get normalized by hand size for stable gestures.
- **Gesture logic**
  - **Left hand fist** → morph particles into a **3D heart**
  - **Right hand gestures** → morph particles into **3D text**
    - 1 finger → “Would you”
    - 2 fingers → “Would you” + “be my”
    - 3 fingers → “Would you” + “be my” + “Valentine?”
  - **Right hand fist** → fireworks; keeps spawning until the right hand leaves the camera view
- **Particle rendering**
  - Three.js renders **15,000 points** with `BufferGeometry` for performance.
  - Each frame interpolates particles toward different “target” layouts (swarm, heart, text).
- **Text and heart made from particles**
  - Text is rasterized on an offscreen `<canvas>`, sampled into points, then given a thin 3D depth.
  - Heart is generated from a mathematical heart field with added Z thickness.

## Tech stack
**Languages**
- JavaScript
- HTML
- CSS

**Libraries and tools**
- Three.js
- @mediapipe/tasks-vision
- Vite
- GitHub Actions + GitHub Pages

## Run locally
```bash
npm install
npm run dev