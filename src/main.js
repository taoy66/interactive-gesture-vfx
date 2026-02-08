import * as THREE from 'three';
import './style.css';
import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';

let scene, camera, renderer, particles;
let handPoints = null;

// Gesture/control state
let groupScale = 1.25;
let groupSpread = 1.25;
let groupCenter = { x: 0, y: 0, z: 0 };

// Left-hand fist => heart mode
let leftHandPoints = null;
let leftFist = false;
let heartMorph = 0;        // 0..1
let heartTargets = null;   // Float32Array(count*3)
let textMorph = 0;         // 0..1
let textTargets = null;          // "Would you"
let textTargetsBeMy = null;      // "Would you\nbe my"
let textTargetsValentine = null; // "Would you\nbe my\nValentine?"
let idleTargets = null;    // Float32Array(count*3)

// Right-hand gestures => particle text
let rightOneFinger = false;
let rightTwoFingers = false;
let rightThreeFingers = false;

// Right-hand fist => firework burst
let rightFist = false;
let prevRightFist = false;

let fireworks = [];
let lastFireworkMs = 0;
const FIREWORK_COOLDOWN_MS = 700;
let lastRenderMs = performance.now();

let gestureTextEl = null;

function ensureGestureText() {
    if (gestureTextEl) return;
    gestureTextEl = document.createElement('div');
    gestureTextEl.id = 'gesture-text';
    gestureTextEl.textContent = 'Would you';
    gestureTextEl.style.position = 'fixed';
    gestureTextEl.style.left = '50%';
    gestureTextEl.style.top = '18%';
    gestureTextEl.style.transform = 'translate(-50%, -50%)';
    gestureTextEl.style.padding = '10px 14px';
    gestureTextEl.style.borderRadius = '10px';
    gestureTextEl.style.background = 'rgba(0,0,0,0.45)';
    gestureTextEl.style.color = '#ffffff';
    gestureTextEl.style.fontFamily = 'system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif';
    gestureTextEl.style.fontSize = '28px';
    gestureTextEl.style.letterSpacing = '0.5px';
    gestureTextEl.style.userSelect = 'none';
    gestureTextEl.style.pointerEvents = 'none';
    gestureTextEl.style.display = 'none';
    gestureTextEl.style.zIndex = '9999';
    document.body.appendChild(gestureTextEl);
}

function setGestureTextVisible(v) {
    if (!gestureTextEl) return;
    gestureTextEl.style.display = v ? 'block' : 'none';
}

function heart2DField(x, y) {
    // 2D implicit heart: inside if <= 0
    // (x^2 + y^2 - 1)^3 - x^2 y^3 <= 0
    const a = x * x + y * y - 1.0;
    return a * a * a - x * x * y * y * y;
}

function buildHeartTargets(count) {
    // 3D heart made of particles: fill a 2D heart silhouette and add Z thickness.
    const out = new Float32Array(count * 3);

    // Bounds for sampling the 2D implicit heart
    const minX = -1.6, maxX = 1.6;
    const minY = -1.8, maxY = 1.8;

    // Scale in scene units (bigger number => bigger heart)
    const S = 4.5;

    let i = 0;
    let attempts = 0;
    const maxAttempts = count * 400;

    while (i < count && attempts < maxAttempts) {
        attempts++;

        const x = minX + Math.random() * (maxX - minX);
        const y = minY + Math.random() * (maxY - minY);

        const f = heart2DField(x, y);
        if (f <= 0) {
            // Thickness: thicker near the interior
            const inside = Math.min(1.0, Math.max(0.0, -f));
            const t = Math.pow(inside, 0.25);
            const z = (Math.random() * 2 - 1) * (0.55 * t);

            const ix = i * 3;
            out[ix]     = x * S + (Math.random() - 0.5) * 0.05;
            out[ix + 1] = y * S + (Math.random() - 0.5) * 0.05;
            out[ix + 2] = z * S + (Math.random() - 0.5) * 0.05;
            i++;
        }
    }

    // Fallback if sampling didn't fill all points
    for (; i < count; i++) {
        const ix = i * 3;
        out[ix]     = (Math.random() - 0.5) * 0.8;
        out[ix + 1] = (Math.random() - 0.5) * 0.8;
        out[ix + 2] = (Math.random() - 0.5) * 0.8;
    }

    return out;
}

function spawnFirework(origin) {
    const now = performance.now();
    if (now - lastFireworkMs < FIREWORK_COOLDOWN_MS) return;
    lastFireworkMs = now;

    const count = 2400;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);
    const vel = new Float32Array(count * 3);

    const baseR = 0.75 + Math.random() * 0.25;
    const baseG = 0.75 + Math.random() * 0.25;
    const baseB = 0.75 + Math.random() * 0.25;

    for (let i = 0; i < count; i++) {
        const ix = i * 3;

        pos[ix] = origin.x + (Math.random() - 0.5) * 0.10;
        pos[ix + 1] = origin.y + (Math.random() - 0.5) * 0.10;
        pos[ix + 2] = origin.z + (Math.random() - 0.5) * 0.10;

        const u = Math.random();
        const v = Math.random();
        const theta = 2 * Math.PI * u;
        const phi = Math.acos(2 * v - 1);

        const dx = Math.sin(phi) * Math.cos(theta);
        const dy = Math.sin(phi) * Math.sin(theta);
        const dz = Math.cos(phi);

        const speed = 4.0 + Math.random() * 3.6;
        vel[ix] = dx * speed;
        vel[ix + 1] = dy * speed;
        vel[ix + 2] = dz * speed;

        const jitter = 0.15;
        col[ix] = Math.min(1, Math.max(0, baseR + (Math.random() - 0.5) * jitter));
        col[ix + 1] = Math.min(1, Math.max(0, baseG + (Math.random() - 0.5) * jitter));
        col[ix + 2] = Math.min(1, Math.max(0, baseB + (Math.random() - 0.5) * jitter));
    }

    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));

    const mat = new THREE.PointsMaterial({
        size: 0.030,
        transparent: true,
        opacity: 1.0,
        blending: THREE.AdditiveBlending,
        vertexColors: true,
        depthWrite: false,
    });

    const pts = new THREE.Points(geo, mat);
    pts.userData = { bornMs: now, lifeMs: 1400, vel };

    scene.add(pts);
    fireworks.push(pts);
}

function updateFireworks(dt) {
    if (!fireworks.length) return;

    const now = performance.now();
    const gravity = -2.2;

    for (let i = fireworks.length - 1; i >= 0; i--) {
        const fw = fireworks[i];
        const age = now - fw.userData.bornMs;
        const life = fw.userData.lifeMs;
        const t = age / life;

        const positions = fw.geometry.attributes.position.array;
        const vel = fw.userData.vel;

        fw.material.opacity = Math.max(0, 1 - t);

        for (let p = 0; p < positions.length; p += 3) {
            vel[p + 1] += gravity * dt;

            positions[p] += vel[p] * dt;
            positions[p + 1] += vel[p + 1] * dt;
            positions[p + 2] += vel[p + 2] * dt;

            vel[p] *= 0.985;
            vel[p + 1] *= 0.985;
            vel[p + 2] *= 0.985;
        }

        fw.geometry.attributes.position.needsUpdate = true;

        if (age >= life) {
            scene.remove(fw);
            fw.geometry.dispose();
            fw.material.dispose();
            fireworks.splice(i, 1);
        }
    }
}

function buildTextTargets(text, count) {
    // Build a 3D particle text volume by rasterizing 2D text and adding Z thickness.
    const out = new Float32Array(count * 3);

    const canvas = document.createElement('canvas');
    canvas.width = 1400;
    canvas.height = 360;
    const ctx = canvas.getContext('2d');

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = 'black';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = 'white';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';

    // Auto-fit font so long phrases don't get cropped
    const fontFamily = 'system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif';
    let fontPx = 170;
    while (fontPx >= 90) {
        ctx.font = `700 ${fontPx}px ${fontFamily}`;
        const w = ctx.measureText(text).width;
        if (w <= canvas.width * 0.86) break;
        fontPx -= 6;
    }

    const lines = String(text).split('\n');

// Re-fit for multi-line: max line width + total height must fit
const lineGap = 0.12;
let fontPx2 = fontPx;

while (fontPx2 >= 90) {
  ctx.font = `700 ${fontPx2}px ${fontFamily}`;

  let maxW = 0;
  for (const ln of lines) {
    const w = ctx.measureText(ln).width;
    if (w > maxW) maxW = w;
  }

  const lineH = fontPx2 * (1 + lineGap);
  const totalH = lines.length * lineH;

  if (maxW <= canvas.width * 0.86 && totalH <= canvas.height * 0.70) break;
  fontPx2 -= 6;
}

ctx.font = `700 ${fontPx2}px ${fontFamily}`;
const lineH = fontPx2 * (1 + lineGap);
const startY = (canvas.height / 2) - ((lines.length - 1) * lineH) / 2;

for (let li = 0; li < lines.length; li++) {
  ctx.fillText(lines[li], canvas.width / 2, startY + li * lineH);
}

    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = img.data;

    const pts = [];
    const step = 1;
    for (let y = 0; y < canvas.height; y += step) {
        for (let x = 0; x < canvas.width; x += step) {
            const idx = (y * canvas.width + x) * 4;
            const a = data[idx + 3];
            const r = data[idx];
            if (a > 10 && r > 200) pts.push([x, y]);
        }
    }

    // Fallback
    if (pts.length < 10) {
        for (let i = 0; i < count; i++) {
            const ix = i * 3;
            out[ix] = (Math.random() - 0.5) * 2;
            out[ix + 1] = (Math.random() - 0.5) * 1;
            out[ix + 2] = (Math.random() - 0.5) * 1;
        }
        return out;
    }

    // Bounding box of the drawn text pixels (prevents wasted space and cropping)
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < pts.length; i++) {
        const x = pts[i][0];
        const y = pts[i][1];
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
    }
    const spanX = Math.max(1, maxX - minX);
    const spanY = Math.max(1, maxY - minY);

    // Map into scene units
    const long = text.length > 10;
    const sx = long ? 11 : 12;  // width
    const sy = 5;               // height
    const sz = 1.2;             // thickness

    for (let i = 0; i < count; i++) {
        const p = pts[(Math.random() * pts.length) | 0];
        const px = p[0];
        const py = p[1];

        // Normalize based on the actual text bounds, not the whole canvas
        const nx = ((px - minX) / spanX) - 0.5;
        const ny = ((py - minY) / spanY) - 0.5;

        const ix = i * 3;
        out[ix] = nx * sx + (Math.random() - 0.5) * 0.01;
        out[ix + 1] = -ny * sy + (Math.random() - 0.5) * 0.01;

        // Slightly thicker near the center
        const c = Math.max(0, 1 - Math.min(1, Math.abs(nx) * 1.2));
        const z = (Math.random() * 2 - 1) * (0.25 + 0.75 * c);
        out[ix + 2] = z * (sz * 0.18) + (Math.random() - 0.5) * 0.01;
    }

    return out;
}

function v3From(points, idx) {
    const i = idx * 3;
    return { x: points[i], y: points[i + 1], z: points[i + 2] };
}

function dist(a, b) {
    const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

// Convert 21 landmarks into a few stable signals
function getHandSignals(points) {
    if (!points || points.length < 63) return null;

    const wrist = v3From(points, 0);
    const thumb = v3From(points, 4);
    const index = v3From(points, 8);
    const middle = v3From(points, 12);
    const ring = v3From(points, 16);
    const pinky = v3From(points, 20);

    // Normalise by hand size (wrist to middle tip)
    const handSize = Math.max(1e-6, dist(wrist, middle));

    // Pinch metric: smaller means more pinched
    const pinch = dist(thumb, index) / handSize;

    // Spread metric: larger means more open
    const spread = (dist(index, pinky) + dist(thumb, pinky)) / (2 * handSize);

    return {
        handSize,
        pinch,
        spread,
        pointer: index,
    };
}

function isFingerExtended(points, tipIdx, mcpIdx) {
    const wrist = v3From(points, 0);
    const tip = v3From(points, tipIdx);
    const mcp = v3From(points, mcpIdx);

    const handSize = Math.max(1e-6, dist(wrist, v3From(points, 12))); // wrist->middle tip
    const tipD = dist(wrist, tip) / handSize;
    const mcpD = dist(wrist, mcp) / handSize;

    // Tip should be meaningfully farther from wrist than MCP
    return (tipD - mcpD) > 0.28;
}

function isOneFingerGesture(points) {
    if (!points || points.length < 63) return false;

    // Index finger
    const indexUp = isFingerExtended(points, 8, 5);

    // Other fingers down
    const middleUp = isFingerExtended(points, 12, 9);
    const ringUp = isFingerExtended(points, 16, 13);
    const pinkyUp = isFingerExtended(points, 20, 17);

    return indexUp && !middleUp && !ringUp && !pinkyUp;
}

function isTwoFingerGesture(points) {
    if (!points || points.length < 63) return false;

    const indexUp = isFingerExtended(points, 8, 5);
    const middleUp = isFingerExtended(points, 12, 9);
    const ringUp = isFingerExtended(points, 16, 13);
    const pinkyUp = isFingerExtended(points, 20, 17);

    // Two-finger: index + middle up, ring + pinky down
    return indexUp && middleUp && !ringUp && !pinkyUp;
}

function isThreeFingerGesture(points) {
    if (!points || points.length < 63) return false;

    const indexUp = isFingerExtended(points, 8, 5);
    const middleUp = isFingerExtended(points, 12, 9);
    const ringUp = isFingerExtended(points, 16, 13);
    const pinkyUp = isFingerExtended(points, 20, 17);

    // Three-finger: index + middle + ring up, pinky down
    return indexUp && middleUp && ringUp && !pinkyUp;
}

function isFistGesture(points) {
    if (!points || points.length < 63) return false;

    const wrist = v3From(points, 0);
    const middleTip = v3From(points, 12);
    const handSize = Math.max(1e-6, dist(wrist, middleTip));

    // Finger tips
    const tips = [8, 12, 16, 20];

    // Use the palm center as a reference (average of MCP joints)
    const mcpIds = [5, 9, 13, 17];
    let px = 0, py = 0, pz = 0;
    for (const id of mcpIds) {
        const p = v3From(points, id);
        px += p.x; py += p.y; pz += p.z;
    }
    const palm = { x: px / mcpIds.length, y: py / mcpIds.length, z: pz / mcpIds.length };

    // A fist means fingertips are close to the palm (relative to hand size)
    let closeCount = 0;
    for (const tipIdx of tips) {
        const tip = v3From(points, tipIdx);
        const d = dist(tip, palm) / handSize;
        if (d < 0.45) closeCount++;
    }

    // Optional: thumb also tucked (thumb tip 4 close to palm)
    const thumbD = dist(v3From(points, 4), palm) / handSize;
    const thumbTucked = thumbD < 0.55;

    return closeCount >= 3 && thumbTucked;
}

function clamp01(x) {
    return Math.min(1, Math.max(0, x));
}

// MediaPipe Tasks Vision (main-thread) setup
const WASM_BASE = '/mediapipe/tasks/wasm/';
const MODEL_PATH = '/mediapipe/tasks/models/hand_landmarker.task';
let landmarker = null;
let lastTs = 0;

async function initLandmarker() {
    if (landmarker) return landmarker;

    const vision = await FilesetResolver.forVisionTasks(WASM_BASE);
    landmarker = await HandLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath: MODEL_PATH },
        runningMode: 'VIDEO',
        numHands: 2,
    });

    return landmarker;
}

function flattenLandmarks(lms) {
    const out = new Float32Array(21 * 3);
    for (let i = 0; i < 21; i++) {
        const p = lms[i];
        out[i * 3] = p.x;
        out[i * 3 + 1] = p.y;
        out[i * 3 + 2] = p.z ?? 0;
    }
    return out;
}

function initStage() {
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.z = 5;

    renderer = new THREE.WebGLRenderer({ canvas: document.getElementById('stage'), antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);

    const count = 15000;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count * 3; i++) pos[i] = (Math.random() - 0.5) * 12;

    // Save an idle “home” shape (copy of initial positions)
    idleTargets = new Float32Array(pos);

    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({
        color: 0x00f3ff,
        size: 0.010,
        transparent: true,
        blending: THREE.NormalBlending,
        opacity: 0.95,
        depthWrite: false,
    });

    particles = new THREE.Points(geo, mat);
    scene.add(particles);

    // Build template targets once (uses all particles)
    heartTargets = buildHeartTargets(count);
    textTargets = buildTextTargets('Would you', count);
    textTargetsBeMy = buildTextTargets('Would you\nbe my', count);
    textTargetsValentine = buildTextTargets('Would you\nbe my\nValentine?', count);

    // UI overlay (kept hidden when particle text is active)
    ensureGestureText();

    render();
}

function render() {
    requestAnimationFrame(render);

    const nowMs = performance.now();
    const dt = Math.min(0.05, (nowMs - lastRenderMs) / 1000);
    lastRenderMs = nowMs;
    updateFireworks(dt);

    if (handPoints && handPoints.length >= 63) {
        const positions = particles.geometry.attributes.position.array;

        // Derive gesture signals from landmarks
        const s = getHandSignals(handPoints);
        if (!s) {
            particles.rotation.y += 0.0005;
            renderer.render(scene, camera);
            return;
        }

        // Pinch to scale (pinch smaller => scale larger)
        // Tune these numbers if it feels too sensitive.
        const pinch01 = clamp01((0.35 - s.pinch) / 0.25);
        const targetScale = 1.0 + pinch01 * 2.5;
        groupScale += (targetScale - groupScale) * 0.15;

        // Open-hand spread to expand the swarm
        const spread01 = clamp01((s.spread - 0.35) / 0.35);
        const targetSpread = 1.0 + spread01 * 2.5;
        groupSpread += (targetSpread - groupSpread) * 0.15;

        // Keep particles visually readable as the swarm scale changes
        particles.material.size = 0.010 * groupScale;

        // Move the swarm with the index fingertip
        // Landmarks are in ~0..1 image space. Map into your scene space.
        const cx = (0.5 - s.pointer.x) * 10;
        const cy = (s.pointer.y - 0.5) * -10;
        const cz = (0.5 - s.pointer.z) * -5;
        groupCenter.x += (cx - groupCenter.x) * 0.2;
        groupCenter.y += (cy - groupCenter.y) * 0.2;
        groupCenter.z += (cz - groupCenter.z) * 0.2;

        // Heart morph smoothing (left-hand fist toggles heart mode)
        // If the left hand is not present, do not linger in heart mode.
        if (!leftHandPoints) heartMorph = 0;

        const targetMorph = leftFist ? 1 : 0;
        heartMorph += (targetMorph - heartMorph) * 0.12;

        // Text morph smoothing (right-hand one/three-finger toggles text mode)
        const textActive = rightOneFinger || rightTwoFingers || rightThreeFingers;
        const targetText = textActive ? 1 : 0;
        textMorph += (targetText - textMorph) * 0.12;

        // Hide DOM overlay; text is now made of particles
        setGestureTextVisible(false);

        // Update particles
        for (let i = 0; i < 15000; i++) {
            const ix = i * 3;
            const jointIndex = (i % 21) * 3;

            // Base target from the assigned landmark
            const baseX = (0.5 - handPoints[jointIndex]) * 10;
            const baseY = (handPoints[jointIndex + 1] - 0.5) * -10;
            const baseZ = (0.5 - handPoints[jointIndex + 2]) * -5;

            // Apply gesture-driven scale/spread and a movable center
            let tx = groupCenter.x + baseX * groupSpread * groupScale;
            let ty = groupCenter.y + baseY * groupSpread * groupScale;
            let tz = groupCenter.z + baseZ * groupSpread * groupScale;

            // Blend toward heart template when left hand is fist
            if (heartTargets && heartMorph > 0.001) {
                const hx = heartTargets[ix];
                const hy = heartTargets[ix + 1];
                const hz = heartTargets[ix + 2];

                const htx = groupCenter.x + hx;
                const hty = groupCenter.y + hy;
                const htz = groupCenter.z + hz;

                tx = tx * (1 - heartMorph) + htx * heartMorph;
                ty = ty * (1 - heartMorph) + hty * heartMorph;
                tz = tz * (1 - heartMorph) + htz * heartMorph;
            }

            // Blend toward 3D particle text when right hand gesture is active
            const activeTextTargets = rightThreeFingers
                ? textTargetsValentine
                : (rightTwoFingers ? textTargetsBeMy : textTargets);
            if (activeTextTargets && textMorph > 0.001) {
                const tx0 = activeTextTargets[ix];
                const ty0 = activeTextTargets[ix + 1];
                const tz0 = activeTextTargets[ix + 2];

                const ttx = groupCenter.x + tx0;
                const tty = groupCenter.y + ty0;
                const ttz = groupCenter.z + tz0;

                tx = tx * (1 - textMorph) + ttx * textMorph;
                ty = ty * (1 - textMorph) + tty * textMorph;
                tz = tz * (1 - textMorph) + ttz * textMorph;
            }

            positions[ix]     += (tx - positions[ix]) * 0.15;
            positions[ix + 1] += (ty - positions[ix + 1]) * 0.15;
            positions[ix + 2] += (tz - positions[ix + 2]) * 0.15;
        }

        particles.geometry.attributes.position.needsUpdate = true;
    } else {
        // No hand detected: return to a stable idle swarm
        leftFist = false;
        rightOneFinger = false;
        rightTwoFingers = false;
        rightThreeFingers = false;
        rightFist = false;
        prevRightFist = false;
        heartMorph = 0;
        textMorph = 0;
        setGestureTextVisible(false);

        // Ease control params back to defaults
        groupScale += (1.25 - groupScale) * 0.08;
        groupSpread += (1.25 - groupSpread) * 0.08;
        groupCenter.x += (0 - groupCenter.x) * 0.08;
        groupCenter.y += (0 - groupCenter.y) * 0.08;
        groupCenter.z += (0 - groupCenter.z) * 0.08;

        // Keep point size readable at idle
        particles.material.size = 0.010 * groupScale;

        // Move positions back toward the idle “home” shape
        const positions = particles.geometry.attributes.position.array;
        if (idleTargets) {
            for (let i = 0; i < 15000; i++) {
                const ix = i * 3;
                positions[ix]     += (idleTargets[ix]     - positions[ix]) * 0.02;
                positions[ix + 1] += (idleTargets[ix + 1] - positions[ix + 1]) * 0.02;
                positions[ix + 2] += (idleTargets[ix + 2] - positions[ix + 2]) * 0.02;
            }
            particles.geometry.attributes.position.needsUpdate = true;
        }

        // Gentle idle motion
        particles.rotation.y += 0.0006;
        particles.rotation.x += 0.00015;
    }
    renderer.render(scene, camera);
}

document.getElementById('start-btn').addEventListener('click', async () => {
    document.getElementById('overlay').style.display = 'none';
    initStage();

    const stream = await navigator.mediaDevices.getUserMedia({ video: true });
    const video = document.createElement('video');
    video.srcObject = stream;
    video.muted = true;
    video.playsInline = true;
    video.setAttribute('playsinline', '');
    // Keep video alive in some browsers by attaching it (hidden)
    video.style.position = 'fixed';
    video.style.left = '-9999px';
    video.style.top = '-9999px';
    video.style.width = '1px';
    video.style.height = '1px';
    document.body.appendChild(video);

    let _lastDetectMs = 0;
    let _fpsCount = 0;
    let _lastFpsLog = 0;
    let _lastHandSeenMs = 0;

    video.onloadedmetadata = async () => {
        try {
            await video.play();
        } catch (e) {
            console.error('video.play() failed:', e);
            return;
        }

        const lm = await initLandmarker();

        const loop = async () => {
            requestAnimationFrame(loop);

            // throttle hand detection to ~20 fps
            const now = performance.now();
            if (now - _lastDetectMs < 50) return;
            _lastDetectMs = now;

            if (video.readyState < 2) return;

            let bitmap;
            try {
                bitmap = await createImageBitmap(video);

                const ts = Math.max(lastTs + 1, now);
                lastTs = ts;

                const res = lm.detectForVideo(bitmap, ts);

                const hands = res?.landmarks || [];
                const handed = res?.handednesses || res?.handedness || [];

                let rightFlat = null;
                let leftFlat = null;

                for (let i = 0; i < hands.length; i++) {
                    const lms = hands[i];
                    if (!lms || lms.length !== 21) continue;

                    const cat = handed?.[i]?.[0];
                    const label = (cat?.categoryName || cat?.displayName || '').toLowerCase();

                    const flat = flattenLandmarks(lms);

                    if (label === 'left') leftFlat = flat;
                    else if (label === 'right') rightFlat = flat;
                }

                // Use right hand as the primary control if present, else left
                handPoints = rightFlat || leftFlat || null;
                leftHandPoints = leftFlat;

                // Right-hand gestures control particle text and fireworks
                if (rightFlat && rightFlat.length >= 63) {
                    rightFist = isFistGesture(rightFlat);

                    rightThreeFingers = isThreeFingerGesture(rightFlat);
                    rightTwoFingers = !rightThreeFingers && isTwoFingerGesture(rightFlat);
                    rightOneFinger = !rightThreeFingers && !rightTwoFingers && isOneFingerGesture(rightFlat);

                    // Fireworks keep going while fist is held (spawnFirework has cooldown)
                    if (rightFist) {
                        const sRight = getHandSignals(rightFlat);
                        if (sRight) {
                            const ox = (0.5 - sRight.pointer.x) * 10;
                            const oy = (sRight.pointer.y - 0.5) * -10;
                            const oz = (0.5 - sRight.pointer.z) * -5;
                            spawnFirework({ x: ox, y: oy, z: oz });
                        } else {
                            spawnFirework({ x: groupCenter.x, y: groupCenter.y, z: groupCenter.z });
                        }
                    }

                    // Keep for debugging/compat; no longer required for triggering
                    prevRightFist = rightFist;
                } else {
                    rightFist = false;
                    prevRightFist = false;
                    rightThreeFingers = false;
                    rightTwoFingers = false;
                    rightOneFinger = false;
                    textMorph = 0;
                }

                if (handPoints) {
                    _lastHandSeenMs = now;
                } else {
                    if (now - _lastHandSeenMs > 500) {
                        handPoints = null;
                        leftHandPoints = null;
                    }
                }

                // Left-hand fist detection
                if (leftHandPoints && leftHandPoints.length >= 63) {
                    leftFist = isFistGesture(leftHandPoints);
                } else {
                    leftFist = false;
                }

                if (!leftHandPoints) {
                    // Left hand not visible: exit heart mode immediately
                    leftFist = false;
                    heartMorph = 0;
                }

                // Debug once per second
                _fpsCount++;
                if (now - _lastFpsLog > 1000) {
                    const sig = handPoints ? getHandSignals(handPoints) : null;
                    const pinch = sig ? sig.pinch.toFixed(3) : 'NA';
                    const spread = sig ? sig.spread.toFixed(3) : 'NA';
                    console.log(`hand detect fps~${_fpsCount} len=${handPoints ? handPoints.length : 0} pinch=${pinch} spread=${spread} leftFist=${leftFist} heartMorph=${heartMorph.toFixed(2)} textMorph=${textMorph.toFixed(2)}`);
                    _fpsCount = 0;
                    _lastFpsLog = now;
                }
            } catch (err) {
                console.error('hand detect failed:', err);
            } finally {
                if (bitmap && typeof bitmap.close === 'function') bitmap.close();
            }
        };

        requestAnimationFrame(loop);
    };
});

