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
