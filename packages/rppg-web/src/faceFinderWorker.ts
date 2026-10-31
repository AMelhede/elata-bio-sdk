// The face finder (MediaPipe FaceLandmarker) in a Web Worker (fix finderWorker, speed).
//
// On a phone the finder is most of a frame's cost and runs on the main thread, so while it works the frames after it
// wait and are dropped: testers' phones analysed 10 to 24 of their camera's 30 frames a second, and replaying their
// recordings at half their frames cost about a third of the seconds with a number (evidence repo tools/halve.mjs). In a
// worker the finder runs on another core while every frame's pixels are still read on the main thread with the newest
// landmarks. With one core in all it buys nothing (a cgroup-capped browser: 16.7 frames a second against 18.0 for the
// finder on every third frame), so it starts only with FINDER_WORKER_MIN_CORES or more. Until the worker is ready, and
// whenever it fails, the frame source keeps finding the face on the main thread as before.

import type { FaceLandmarkerPoint, LoadFaceLandmarkerOptions } from "./mediapipeLoader";

/** Cores (navigator.hardwareConcurrency) below which the worker is not started: with one core it bought nothing. */
export const FINDER_WORKER_MIN_CORES = 4;

/**
 * The oldest worker landmarks a frame uses. The face regions are already smoothed with a lag of about 270 ms (alpha
 * 0.25 at 15 frames a second), and on received phone sessions a head moves a median 0.46% of the face's width in 250 ms
 * (95th percentile 7.6%; evidence repo tools/headstep.mjs), so landmarks this old sit inside the lag the regions have.
 */
export const WORKER_LANDMARK_MAX_MS = 300;

export type FaceFinderWorkerBlendshape = { categoryName: string; score: number };

/** What the frame source needs from the worker. */
export type FaceFinderWorker = {
	/** The model is loaded and frames can be sent. */
	readonly ready: boolean;
	/** A frame is being found; the next one waits. */
	readonly busy: boolean;
	/** The newest landmarks and when their frame was taken (frame clock), or null. */
	readonly latest: { landmarks: FaceLandmarkerPoint[] | null; atMs: number } | null;
	/** Send one frame (transferred); ignored while busy or not ready. */
	submit(image: ImageBitmap, atMs: number): void;
	/** The blendshapes of the newest result, once: a frame takes them so a blink score is never counted twice. */
	takeBlendshapes(): FaceFinderWorkerBlendshape[] | null;
	close(): void;
};

const DEFAULT_VISION_CDN = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18";
const DEFAULT_MODEL_ASSET =
	"https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

// A classic worker: the tasks-vision runtime loads its wasm loader with importScripts, which a module worker cannot.
const WORKER_SOURCE = `let lm = null;
self.onmessage = async (e) => {
  const d = e.data;
  if (d.type === 'init') {
    try {
      self.module = { exports: {} }; self.exports = self.module.exports;
      // Fetched and loaded from a JavaScript Blob: importScripts refuses a script served under another type, and a
      // CDN's type for .cjs is not ours to rely on.
      const text = await (await fetch(d.bundle)).text();
      importScripts(URL.createObjectURL(new Blob([text], { type: 'text/javascript' })));
      const mod = self.module.exports;
      const fs = await mod.FilesetResolver.forVisionTasks(d.wasm);
      lm = await mod.FaceLandmarker.createFromOptions(fs, { baseOptions: { modelAssetPath: d.model }, runningMode: 'VIDEO', numFaces: 1, outputFaceBlendshapes: true, outputFacialTransformationMatrixes: false });
      self.postMessage({ type: 'ready' });
    } catch (err) { self.postMessage({ type: 'failed', message: String(err && err.message || err) }); }
    return;
  }
  if (d.type === 'frame') {
    let r = null;
    try { r = lm ? lm.detectForVideo(d.bitmap, d.atMs) : null; } catch (err) { r = null; }
    if (d.bitmap.close) d.bitmap.close();
    const b = r && r.faceBlendshapes && r.faceBlendshapes[0] ? r.faceBlendshapes[0].categories.map((c) => ({ categoryName: c.categoryName, score: c.score })) : null;
    self.postMessage({ type: 'result', atMs: d.atMs, landmarks: r && r.faceLandmarks ? (r.faceLandmarks[0] || null) : null, blendshapes: b });
  }
};`;

/**
 * Start the face finder in a worker, or null where that cannot help or cannot run (fewer than FINDER_WORKER_MIN_CORES
 * cores, no Worker, no createImageBitmap, no Blob URLs). Loads the same tasks-vision bundle, wasm and model as
 * loadFaceLandmarker, from the same options.
 */
export function startFaceFinderWorker(
	options: LoadFaceLandmarkerOptions = {},
	env: { navigator?: { hardwareConcurrency?: number }; Worker?: unknown; createImageBitmap?: unknown; URL?: unknown; Blob?: unknown; location?: { href: string } } = globalThis as never,
): FaceFinderWorker | null {
	const cores = env.navigator?.hardwareConcurrency ?? 0;
	if (cores < FINDER_WORKER_MIN_CORES) return null;
	if (typeof env.Worker !== "function" || typeof env.createImageBitmap !== "function" || typeof env.Blob !== "function") return null;
	const URLc = env.URL as { createObjectURL?: (b: unknown) => string; new (u: string, base?: string): { href: string } } | undefined;
	if (!URLc || typeof URLc.createObjectURL !== "function") return null;
	const base = env.location?.href;
	const abs = (u: string) => (base ? new URLc(u, base).href : u);
	const cdn = (options.visionCdnBase ?? DEFAULT_VISION_CDN).replace(/\/+$/, "");
	let worker: { postMessage(m: unknown, t?: unknown[]): void; terminate(): void; onmessage: ((e: { data: any }) => void) | null; onerror: (() => void) | null };
	try {
		const url = URLc.createObjectURL(new (env.Blob as new (p: string[], o: object) => unknown)([WORKER_SOURCE], { type: "text/javascript" }));
		worker = new (env.Worker as new (u: string) => typeof worker)(url);
	} catch {
		return null;
	}
	const state = {
		ready: false,
		busy: false,
		failed: false,
		latest: null as FaceFinderWorker["latest"],
		blend: null as FaceFinderWorkerBlendshape[] | null,
	};
	worker.onmessage = (e) => {
		const d = e.data;
		if (d?.type === "ready") state.ready = true;
		else if (d?.type === "failed") { state.failed = true; state.ready = false; }
		else if (d?.type === "result") { state.busy = false; state.latest = { landmarks: d.landmarks, atMs: d.atMs }; state.blend = d.blendshapes; }
	};
	worker.onerror = () => { state.failed = true; state.ready = false; state.busy = false; };
	worker.postMessage({
		type: "init",
		bundle: abs(`${cdn}/vision_bundle.cjs`),
		wasm: abs(options.wasmBase ?? `${cdn}/wasm`),
		model: abs(options.modelAssetPath ?? DEFAULT_MODEL_ASSET),
	});
	return {
		get ready() { return state.ready && !state.failed; },
		get busy() { return state.busy; },
		get latest() { return state.latest; },
		submit(image, atMs) {
			if (!state.ready || state.failed || state.busy) return;
			state.busy = true;
			try { worker.postMessage({ type: "frame", bitmap: image, atMs }, [image]); } catch { state.busy = false; }
		},
		takeBlendshapes() { const b = state.blend; state.blend = null; return b; },
		close() { state.failed = true; state.ready = false; try { worker.terminate(); } catch { /* already gone */ } },
	};
}
