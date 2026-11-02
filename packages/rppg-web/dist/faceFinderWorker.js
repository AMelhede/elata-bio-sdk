/** The oldest worker result still used to place the regions, ms: LANDMARK_STILL_REUSE_MAX_MS. */
export const FACE_WORKER_MAX_AGE_MS = 300;
const DEFAULT_VISION_CDN = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18";
const DEFAULT_MODEL_ASSET = "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";
/**
 * The worker's own code: a CLASSIC worker. tasks-vision's wasm loader calls importScripts(), which a module worker
 * forbids ("Module scripts don't support importScripts()", Chromium, 2026-11-02), so the worker loads the package's
 * CommonJS bundle (vision_bundle.cjs, the same release as vision_bundle.mjs) with importScripts and a module shim.
 */
export function faceWorkerSource(cdn, wasmBase, modelAssetPath) {
    return `
self.module = { exports: {} }; self.exports = self.module.exports;
let landmarker = null, failed = null;
const ready = (async () => {
  try {
    importScripts(${JSON.stringify(`${cdn}/vision_bundle.cjs`)});
    const mod = self.module.exports;
    const fileset = await mod.FilesetResolver.forVisionTasks(${JSON.stringify(wasmBase)});
    landmarker = await mod.FaceLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: ${JSON.stringify(modelAssetPath)} },
      runningMode: "VIDEO", numFaces: 1, outputFaceBlendshapes: true, outputFacialTransformationMatrixes: false,
    });
    postMessage({ ready: true });
  } catch (e) { failed = String(e && e.message || e); postMessage({ error: failed }); }
})();
let lastT = -Infinity;
onmessage = async (ev) => {
  const { image, atMs } = ev.data;
  await ready;
  if (!landmarker) { image && image.close && image.close(); postMessage({ atMs, landmarks: null, error: failed }); return; }
  try {
    const t = Math.max(atMs, lastT + 1); lastT = t;
    const r = landmarker.detectForVideo(image, t);
    const lm = r && r.faceLandmarks && r.faceLandmarks[0];
    const cats = r && r.faceBlendshapes && r.faceBlendshapes[0] && r.faceBlendshapes[0].categories;
    postMessage({ atMs, landmarks: lm ? lm.map((p) => ({ x: p.x, y: p.y, z: p.z })) : null,
      blendshapes: cats ? cats.map((c) => ({ categoryName: c.categoryName, score: c.score })) : undefined });
  } catch (e) { postMessage({ atMs, landmarks: null, error: String(e && e.message || e) }); }
  finally { image && image.close && image.close(); }
};`;
}
/**
 * A worker-backed finder, or null where a worker cannot be made (no Worker, no Blob URLs, a CSP that forbids
 * it): the session then keeps the main-thread finder, so the option can never leave a page without a face finder.
 * Resolves once the worker has loaded the model, so a failed load also falls back.
 */
export async function createWorkerFaceFinder(options = {}, timeoutMs = 30000) {
    if (typeof Worker === "undefined" || typeof Blob === "undefined" || typeof URL === "undefined")
        return null;
    const cdn = (options.visionCdnBase ?? DEFAULT_VISION_CDN).replace(/\/+$/, "");
    const src = faceWorkerSource(cdn, options.wasmBase ?? `${cdn}/wasm`, options.modelAssetPath ?? DEFAULT_MODEL_ASSET);
    let worker;
    let url = "";
    try {
        url = URL.createObjectURL(new Blob([src], { type: "text/javascript" }));
        worker = new Worker(url);
    }
    catch {
        if (url)
            URL.revokeObjectURL(url);
        return null;
    }
    const results = [];
    let busy = false;
    let error = null;
    const ok = await new Promise((resolve) => {
        const timer = setTimeout(() => resolve(false), timeoutMs);
        worker.onerror = () => {
            clearTimeout(timer);
            resolve(false);
        };
        worker.onmessage = (ev) => {
            if (ev.data?.ready) {
                clearTimeout(timer);
                resolve(true);
            }
            else if (ev.data?.error) {
                clearTimeout(timer);
                error = String(ev.data.error);
                resolve(false);
            }
        };
    });
    if (!ok) {
        worker.terminate();
        URL.revokeObjectURL(url);
        return null;
    }
    worker.onmessage = (ev) => {
        busy = false;
        const d = ev.data ?? {};
        if (d.error)
            error = String(d.error);
        if (typeof d.atMs === "number")
            results.push({ atMs: d.atMs, landmarks: d.landmarks ?? null, blendshapes: d.blendshapes });
    };
    worker.onerror = (e) => {
        busy = false;
        error = String(e.message ?? e);
    };
    return {
        get busy() {
            return busy;
        },
        get error() {
            return error;
        },
        request(image, atMs) {
            busy = true;
            try {
                if (typeof ImageBitmap !== "undefined" && image instanceof ImageBitmap)
                    worker.postMessage({ image, atMs }, [image]);
                else
                    worker.postMessage({ image, atMs });
            }
            catch (e) {
                busy = false;
                error = String(e.message ?? e);
            }
        },
        take() {
            return results.splice(0, results.length);
        },
        close() {
            worker.terminate();
            URL.revokeObjectURL(url);
        },
    };
}
