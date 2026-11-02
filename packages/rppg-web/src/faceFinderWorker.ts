/**
 * Session option faceFinderWorker (off unless set): the face finder (MediaPipe FaceLandmarker) runs in a Web
 * Worker, so the page's own thread reads every camera frame's face regions instead of waiting on the finder.
 *
 * Why: the finder is the largest share of a page's CPU on a slow device, and a phone that cannot keep up analyses
 * only part of the frames its camera delivers. A frame not analysed is signal lost. With the finder on another core,
 * the regions are placed from the newest landmarks the worker has returned, at most FACE_WORKER_MAX_AGE_MS old (the
 * age the still-face reuse already allows), and the frames between finds reuse them as landmark reuse does today.
 *
 * The worker loads the same tasks-vision bundle, wasm and model as loadFaceLandmarker, from the same URLs, with the
 * same options, so the landmarks are the finder's own; only where it runs changes.
 */
import type { LoadFaceLandmarkerOptions } from "./mediapipeLoader";

/** The oldest worker result still used to place the regions, ms: LANDMARK_STILL_REUSE_MAX_MS. */
export const FACE_WORKER_MAX_AGE_MS = 300;

export type FaceFinderPoint = { x: number; y: number; z?: number };
export type FaceFinderBlendshape = { categoryName: string; score: number };

/** One finder result, on the frame clock of the frame it was asked about. */
export interface FaceFinderResult {
	atMs: number;
	landmarks: FaceFinderPoint[] | null;
	blendshapes?: FaceFinderBlendshape[];
}

/** What the frame source needs of an asynchronous finder (a worker in a browser, a fake in tests). */
export interface AsyncFaceFinder {
	/** True while a frame is with the finder; the source asks again only when it is free. */
	readonly busy: boolean;
	/** Hand the finder one frame. The source calls it only when not busy. */
	request(image: ImageBitmap | HTMLCanvasElement, atMs: number): void;
	/** Results that came back since the last call, oldest first; each is returned once. */
	take(): FaceFinderResult[];
	close(): void;
	/** The last error from the worker, if any (the session falls back to the main-thread finder). */
	readonly error: string | null;
}

const DEFAULT_VISION_CDN = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18";
const DEFAULT_MODEL_ASSET =
	"https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

/**
 * The worker's own code: a CLASSIC worker. tasks-vision's wasm loader calls importScripts(), which a module worker
 * forbids ("Module scripts don't support importScripts()", Chromium, 2026-11-02), so the worker loads the package's
 * CommonJS bundle (vision_bundle.cjs, the same release as vision_bundle.mjs) with importScripts and a module shim.
 */
export function faceWorkerSource(cdn: string, wasmBase: string, modelAssetPath: string): string {
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
export async function createWorkerFaceFinder(
	options: LoadFaceLandmarkerOptions = {},
	timeoutMs = 30_000,
): Promise<AsyncFaceFinder | null> {
	if (typeof Worker === "undefined" || typeof Blob === "undefined" || typeof URL === "undefined") return null;
	const cdn = (options.visionCdnBase ?? DEFAULT_VISION_CDN).replace(/\/+$/, "");
	const src = faceWorkerSource(cdn, options.wasmBase ?? `${cdn}/wasm`, options.modelAssetPath ?? DEFAULT_MODEL_ASSET);
	let worker: Worker;
	let url = "";
	try {
		url = URL.createObjectURL(new Blob([src], { type: "text/javascript" }));
		worker = new Worker(url);
	} catch {
		if (url) URL.revokeObjectURL(url);
		return null;
	}
	const results: FaceFinderResult[] = [];
	let busy = false;
	let error: string | null = null;
	const ok = await new Promise<boolean>((resolve) => {
		const timer = setTimeout(() => resolve(false), timeoutMs);
		worker.onerror = () => {
			clearTimeout(timer);
			resolve(false);
		};
		worker.onmessage = (ev: MessageEvent) => {
			if (ev.data?.ready) {
				clearTimeout(timer);
				resolve(true);
			} else if (ev.data?.error) {
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
	worker.onmessage = (ev: MessageEvent) => {
		busy = false;
		const d = ev.data ?? {};
		if (d.error) error = String(d.error);
		if (typeof d.atMs === "number") results.push({ atMs: d.atMs, landmarks: d.landmarks ?? null, blendshapes: d.blendshapes });
	};
	worker.onerror = (e) => {
		busy = false;
		error = String((e as ErrorEvent).message ?? e);
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
				if (typeof ImageBitmap !== "undefined" && image instanceof ImageBitmap) worker.postMessage({ image, atMs }, [image]);
				else worker.postMessage({ image, atMs });
			} catch (e) {
				busy = false;
				error = String((e as Error).message ?? e);
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
