import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';

// Some builds of Tasks Vision expect a `self.import()` helper in worker scope.
// In some builds the loader is an ES module that *exports* the factory instead of
// attaching it to `self`, which leads to: "ModuleFactory not set".
// This shim imports the module and copies the factory onto `self` if it exists.
if (typeof self.import !== 'function') {
    self.import = async (p) => {
        const m = await import(/* @vite-ignore */ p);

        // Common export patterns we’ve seen
        const factory = m?.ModuleFactory || m?.default || m?.createWasmModule || m?.createModule;
        if (typeof factory === 'function') {
            self.ModuleFactory = factory;
        }

        // Some builds use different global names
        if (typeof m?.WasmModuleFactory === 'function') {
            self.ModuleFactory = m.WasmModuleFactory;
        }

        return m;
    };
}

// Serve these from Vite's /public directory:
//   public/mediapipe/tasks/wasm/   (all wasm files from @mediapipe/tasks-vision/wasm)
//   public/mediapipe/tasks/models/hand_landmarker.task
const WASM_BASE = new URL('/mediapipe/tasks/wasm/', self.location.href).toString();
const MODEL_PATH = '/mediapipe/tasks/models/hand_landmarker.task';

let landmarker = null;
let lastTs = 0;

async function assertFetch(url, label) {
    const r = await fetch(url, { method: 'GET' });
    if (!r.ok) {
        throw new Error(`${label} fetch failed (${r.status}) at ${r.url}`);
    }
}

async function init() {
    if (landmarker) return landmarker;

    // Preflight checks so missing files show up clearly
    const wasmJs = new URL('vision_wasm_internal.js', WASM_BASE).toString();
    const wasmBin = new URL('vision_wasm_internal.wasm', WASM_BASE).toString();
    await assertFetch(wasmJs, 'Tasks wasm JS');
    await assertFetch(wasmBin, 'Tasks wasm');
    await assertFetch(MODEL_PATH, 'Hand model');

    const vision = await FilesetResolver.forVisionTasks(WASM_BASE);
    landmarker = await HandLandmarker.createFromOptions(vision, {
        baseOptions: {
            modelAssetPath: MODEL_PATH,
        },
        runningMode: 'VIDEO',
        numHands: 1,
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

self.onmessage = async (e) => {
    const image = e?.data?.image;
    if (!image) return;

    try {
        const lm = await init();

        // VIDEO mode needs a monotonically increasing timestamp
        const ts = Math.max(lastTs + 1, performance.now());
        lastTs = ts;

        const res = lm.detectForVideo(image, ts);
        const firstHand = res?.landmarks?.[0];

        if (firstHand && firstHand.length === 21) {
            const flat = flattenLandmarks(firstHand);
            self.postMessage({ landmarks: flat.buffer }, [flat.buffer]);
        } else {
            self.postMessage({ landmarks: null });
        }
    } catch (err) {
        self.postMessage({ error: String(err?.message || err) });
    } finally {
        if (typeof image.close === 'function') image.close();
    }
};