// No mock of ../wasmBackend here: these tests run the real loader against a wasmImporter that
// fails the way a browser does when the glue file is not served (404, an SPA index.html, a wrong
// MIME type), and check what createRppgSession with backend "auto" reports through onError and
// lastError.
jest.mock("../videoPlayback", () => ({
	ensureVideoPlaying: jest.fn(async () => undefined),
}));

jest.mock("../mediaPipeFrameSource", () => ({
	MediaPipeFrameSource: jest.fn().mockImplementation(function MediaPipeFrameSource(this: any) {
		this.onFrame = null;
		this.start = jest.fn(async () => {});
		this.stop = jest.fn(async () => {});
	}),
}));

jest.mock("../demoRunner", () => ({
	...jest.requireActual("../demoRunner"),
	DemoRunner: jest.fn().mockImplementation(function DemoRunner(this: any) {
		this.start = jest.fn(async () => {});
		this.stop = jest.fn(async () => {});
		this.getLastFaceBox = jest.fn(() => null);
		this.getLastBlendshapes = jest.fn(() => null);
		this.faceAbsentMs = jest.fn(() => 0);
		this.getDiagnostics = jest.fn(() => ({
			framesSeen: 0,
			framesWithFaceRoi: 0,
			framesWithFallbackRoi: 0,
			framesWithMultiRoi: 0,
			samplesPushed: 0,
			droppedFrames: 0,
			lastDropReason: null,
			lastTimestampMs: null,
			lastIntensity: null,
			lastSkinRatio: null,
			lastClipRatio: null,
			lastMotion: null,
			lastProcessorMethod: null,
			lastRoiSource: null,
		}));
	}),
}));

import { createRppgSession } from "../rppgSession";
import { normalizeRppgError } from "../rppgErrors";
import type { WasmModule } from "../wasmBackend";

const DEFAULT_URLS = ["/pkg/rppg_wasm.js", "/rppg_wasm.js"];

function failingImporter() {
	return jest.fn((url: string): Promise<WasmModule> =>
		Promise.reject(new TypeError(`Failed to fetch dynamically imported module: ${url}`)),
	);
}

function fakeWasmModule(): WasmModule {
	return {
		RppgPipeline: class {
			push_sample() {}
			get_metrics() {
				return { bpm: null, confidence: 0, signal_quality: 0 };
			}
			free() {}
		},
	};
}

function autoOptions(wasmImporter: (url: string) => Promise<WasmModule>) {
	return {
		video: document.createElement("video"),
		faceMesh: "off" as const,
		backend: "auto" as const,
		ensureVideoPlayback: false,
		wasmImporter,
	};
}

describe("createRppgSession, backend auto, WASM glue that does not load", () => {
	test("reports every URL the loader tried and why each one failed", async () => {
		const importer = failingImporter();
		const onError = jest.fn();
		const session = await createRppgSession({ ...autoOptions(importer), onError });

		expect(session.backendMode).toBe("unavailable");
		// Same requests as before: one attempt per default URL, nothing extra.
		expect(importer.mock.calls.map(([url]) => url)).toEqual(DEFAULT_URLS);
		expect(onError).toHaveBeenCalledTimes(1);
		const error = session.lastError;
		expect(onError).toHaveBeenCalledWith(error);
		expect(error).toMatchObject({ code: "backend_init_failed", stage: "backend" });
		expect(error?.message).toContain("Tried: /pkg/rppg_wasm.js, /rppg_wasm.js");
		for (const url of DEFAULT_URLS) {
			expect(error?.message).toContain(
				`${url}: TypeError: Failed to fetch dynamically imported module: ${url}`,
			);
		}
		// The cause is what the loader threw: the same error backend "wasm" throws.
		expect(error?.cause).toMatchObject({ name: "RppgWasmLoadError", attemptedUrls: DEFAULT_URLS });
		expect((error?.cause as { errors?: unknown[] }).errors).toHaveLength(2);
		await session.dispose();
	});

	test("when the glue loads but its .wasm does not, the reason names that failure, not the next URL's", async () => {
		// The glue is served at /pkg/ but its .wasm is not (an SPA answers with index.html), so init
		// fails there and the loader moves on to /rppg_wasm.js, which is not served either.
		const initFailure = new Error(
			"WebAssembly.instantiate(): expected magic word 00 61 73 6d, found 3c 21 44 4f @+0",
		);
		const importer = jest.fn((url: string): Promise<WasmModule> =>
			url === "/pkg/rppg_wasm.js"
				? Promise.resolve({ default: () => Promise.reject(initFailure) })
				: Promise.reject(new TypeError(`Failed to fetch dynamically imported module: ${url}`)),
		);
		const session = await createRppgSession(autoOptions(importer));

		const expected = `/pkg/rppg_wasm.js: ${String(initFailure)}`;
		expect(session.lastError?.message).toContain(expected);
		const normalized = normalizeRppgError(session.lastError, session.getDiagnostics());
		expect(normalized?.code).toBe("wasm_init_failed");
		expect(normalized?.detail).toContain(expected);
		// Said once, not repeated from the cause.
		expect(normalized?.detail.split("Unable to load rPPG WASM backend")).toHaveLength(2);
		await session.dispose();
	});

	test("a load that succeeds on a later URL reports nothing", async () => {
		const importer = jest.fn((url: string): Promise<WasmModule> =>
			url === "/pkg/rppg_wasm.js"
				? Promise.reject(new TypeError(`Failed to fetch dynamically imported module: ${url}`))
				: Promise.resolve(fakeWasmModule()),
		);
		const onError = jest.fn();
		const session = await createRppgSession({ ...autoOptions(importer), onError });

		expect(session.backendMode).toBe("wasm");
		expect(session.lastError).toBeNull();
		expect(onError).not.toHaveBeenCalled();
		await session.dispose();
	});

	test("backend wasm still throws the loader's error, with its message unchanged", async () => {
		const error = await createRppgSession({ ...autoOptions(failingImporter()), backend: "wasm" }).catch(
			(e) => e,
		);
		expect(error).toMatchObject({ name: "RppgWasmLoadError", attemptedUrls: DEFAULT_URLS });
		expect(error.message).toBe(
			"Unable to load rPPG WASM backend. Tried: /pkg/rppg_wasm.js, /rppg_wasm.js. Set up the bundle so one of these URLs resolves.",
		);
		expect(error.errors).toHaveLength(2);
	});
});
