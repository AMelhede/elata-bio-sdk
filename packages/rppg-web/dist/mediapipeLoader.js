// MediaPipe FaceLandmarker (tasks-vision) loader.
//
// Replaces the legacy global-script FaceMesh: FaceLandmarker additionally emits
// ARKit-style blendshape coefficients (outputFaceBlendshapes), which are the
// input to valence/arousal affect estimation. Like the previous loader we keep
// the package dependency-free by loading tasks-vision from a CDN at runtime;
// asset locations are configurable for self-hosting.
//
// You can disable face tracking entirely by setting
// `window.__ELATA_DISABLE_FACEMESH = true` on the page.
import { FINDER_DELEGATE_ORDER, TrialFaceFinder } from "./faceFinderTrial.js";
const DEFAULT_VISION_CDN = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18";
const DEFAULT_MODEL_ASSET = "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";
/**
 * Load a FaceLandmarker (with blendshape output) from CDN. Returns null when
 * face tracking is disabled or unavailable so callers can fall back to the
 * plain video-frame source.
 */
export async function loadFaceLandmarker(options = {}) {
    const win = window;
    if (win.__ELATA_DISABLE_FACEMESH)
        return null;
    const cdn = (options.visionCdnBase ?? DEFAULT_VISION_CDN).replace(/\/+$/, "");
    const wasmBase = options.wasmBase ?? `${cdn}/wasm`;
    const modelAssetPath = options.modelAssetPath ?? DEFAULT_MODEL_ASSET;
    // Runtime ESM import of the CDN bundle. The dynamic URL keeps bundlers from
    // trying to resolve tasks-vision at build time (the package stays dep-free).
    const mod = await import(
    /* @vite-ignore */ /* webpackIgnore: true */ `${cdn}/vision_bundle.mjs`);
    const FilesetResolver = mod.FilesetResolver;
    const FaceLandmarker = mod.FaceLandmarker;
    if (!FilesetResolver || !FaceLandmarker)
        return null;
    const fileset = await FilesetResolver.forVisionTasks(wasmBase);
    const landmarker = await FaceLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath },
        runningMode: "VIDEO",
        numFaces: 1,
        outputFaceBlendshapes: true,
        outputFacialTransformationMatrixes: false,
    });
    return landmarker;
}
/**
 * Every delegate that builds, in `order` (GPU first, then CPU), each with what TrialFaceFinder needs:
 * the GPU one draws on a canvas made here, so its context loss can be seen (MediaPipe draws on its own
 * OffscreenCanvas unless handed one, and does not rebuild after losing it). A delegate that throws is
 * simply absent; none at all is empty. `delegates` restricts the order (for tests and diagnostics).
 */
export async function loadFaceFinderCandidates(options = {}, delegates = FINDER_DELEGATE_ORDER) {
    const win = window;
    if (win.__ELATA_DISABLE_FACEMESH)
        return [];
    const cdn = (options.visionCdnBase ?? DEFAULT_VISION_CDN).replace(/\/+$/, "");
    const wasmBase = options.wasmBase ?? `${cdn}/wasm`;
    const modelAssetPath = options.modelAssetPath ?? DEFAULT_MODEL_ASSET;
    const mod = await import(
    /* @vite-ignore */ /* webpackIgnore: true */ `${cdn}/vision_bundle.mjs`);
    if (!mod.FilesetResolver || !mod.FaceLandmarker)
        return [];
    const fileset = await mod.FilesetResolver.forVisionTasks(wasmBase);
    const out = [];
    let lastError = null;
    for (const delegate of delegates) {
        try {
            const built = await buildFinder(mod, fileset, modelAssetPath, delegate);
            if (built)
                out.push(built);
        }
        catch (error) {
            // This delegate does not build here; the trial runs over the rest.
            lastError = error;
        }
    }
    // None built: fail as loudly as the published loader (the session reports face_mesh_init_failed), never
    // fall back in silence to reading the middle of the picture.
    if (!out.length && lastError != null)
        throw lastError;
    return out;
}
/** One finder on `delegate`, with its own canvas on the GPU (Safari: MediaPipe's own choice). */
export async function buildFinder(mod, fileset, modelAssetPath, delegate) {
    const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
    const safari = ua.includes("Safari") && !ua.includes("Chrome");
    const canvas = delegate !== "GPU" || safari
        ? undefined
        : typeof OffscreenCanvas !== "undefined"
            ? new OffscreenCanvas(1, 1)
            : typeof document !== "undefined"
                ? document.createElement("canvas")
                : undefined;
    let lost = false;
    if (canvas) {
        const onLost = () => {
            lost = true;
        };
        canvas.addEventListener("webglcontextlost", onLost);
        canvas.addEventListener("contextlost", onLost);
    }
    const finder = await mod.FaceLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath, delegate },
        ...(canvas ? { canvas } : {}),
        runningMode: "VIDEO",
        numFaces: 1,
        outputFaceBlendshapes: true,
        outputFacialTransformationMatrixes: false,
    });
    if (!finder)
        return null;
    return { finder: finder, delegate, isLost: () => lost };
}
/**
 * The face finder on the faster delegate for this device, chosen on the live video, and rebuilt when it
 * dies (TrialFaceFinder). Null when no delegate builds or face tracking is disabled.
 */
export async function loadTrialFaceFinder(options = {}, onEvent) {
    const candidates = await loadFaceFinderCandidates(options);
    if (!candidates.length)
        return null;
    const cdn = (options.visionCdnBase ?? DEFAULT_VISION_CDN).replace(/\/+$/, "");
    return new TrialFaceFinder(candidates, {
        onEvent,
        rebuild: async (delegate) => (await loadFaceFinderCandidates({ ...options, visionCdnBase: cdn }, [delegate]))[0] ?? null,
        visibility: typeof document !== "undefined" ? document : undefined,
    });
}
