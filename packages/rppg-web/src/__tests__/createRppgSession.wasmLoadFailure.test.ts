// No mock of ../wasmBackend here: these tests run the real loader against a
// wasmImporter that fails the way a browser does when the glue file is not
// served (404, an SPA index.html, a wrong MIME type).
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
	DemoRunner: jest.fn().mockImplementation(function DemoRunner(this: any) {
		this.start = jest.fn(async () => {});
		this.stop = jest.fn(async () => {});
		this.getLastFaceBox = jest.fn(() => null);
		this.getLastBlendshapes = jest.fn(() => null);
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
import { createManagedRppgSession } from "../managedRppgSession";
import { normalizeRppgError } from "../rppgErrors";
import { createRppgAppAdapter } from "../rppgAppAdapter";
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
	test("keeps the reason: the URLs the loader tried and the last import error", async () => {
		const importer = failingImporter();
		const session = await createRppgSession(autoOptions(importer));

		expect(session.backendMode).toBe("unavailable");
		// Same requests as before: one attempt per default URL, nothing extra.
		expect(importer.mock.calls.map(([url]) => url)).toEqual(DEFAULT_URLS);

		const loadError = session.getDiagnostics().backendLoadError;
		expect(loadError).toMatchObject({ code: "backend_init_failed", stage: "backend" });
		expect(loadError?.message).toContain("Tried: /pkg/rppg_wasm.js, /rppg_wasm.js");
		expect(String(loadError?.cause)).toContain(
			"Failed to fetch dynamically imported module: /rppg_wasm.js",
		);
		await session.dispose();
	});

	test("normalizeRppgError and the app adapter carry that reason in detail, under the same backend_unavailable code", async () => {
		const session = await createRppgSession(autoOptions(failingImporter()));

		const normalized = normalizeRppgError(session.lastError, session.getDiagnostics());
		expect(normalized).toMatchObject({
			code: "backend_unavailable",
			phase: "startup",
			retryable: false,
			terminal: false,
		});
		expect(normalized?.detail).toContain("Tried: /pkg/rppg_wasm.js, /rppg_wasm.js");
		expect(normalized?.detail).toContain(
			"Failed to fetch dynamically imported module: /rppg_wasm.js",
		);

		const snapshot = createRppgAppAdapter().getSnapshot(session);
		expect(snapshot.status).toBe("degraded");
		expect(snapshot.canPublish).toBe(false);
		expect(snapshot.guidance.code).toBe("backend_unavailable");
		expect(snapshot.normalizedError?.detail).toContain("Tried: /pkg/rppg_wasm.js, /rppg_wasm.js");
		await session.dispose();
	});

	test("changes nothing the session already reported: no onError, no lastError, same state", async () => {
		const onError = jest.fn();
		const session = await createRppgSession({ ...autoOptions(failingImporter()), onError });

		expect(onError).not.toHaveBeenCalled();
		expect(session.lastError).toBeNull();
		expect(session.getState()).toEqual({
			status: "degraded",
			phase: "startup",
			terminal: false,
			reason: "backend_unavailable",
			errorCode: null,
			errorStage: null,
		});
		expect(session.getDiagnostics().issues).toContain("backend_unavailable");
		await session.dispose();
	});

	test("a managed session still goes starting then running, and its diagnostics keep the reason", async () => {
		const states: string[] = [];
		const managed = await createManagedRppgSession({
			...autoOptions(failingImporter()),
			onStateChange: (state) => states.push(`${state.status}/${state.lastError?.code ?? "none"}`),
		});

		expect(states).toEqual(["starting/none", "running/none"]);
		expect(managed.getDiagnostics()?.backendLoadError?.message).toContain(
			"Tried: /pkg/rppg_wasm.js, /rppg_wasm.js",
		);
		await managed.stop();
	});

	test("a load that succeeds on a later URL reports nothing", async () => {
		const importer = jest.fn((url: string): Promise<WasmModule> =>
			url === "/pkg/rppg_wasm.js"
				? Promise.reject(new TypeError(`Failed to fetch dynamically imported module: ${url}`))
				: Promise.resolve(fakeWasmModule()),
		);
		const session = await createRppgSession(autoOptions(importer));

		expect(session.backendMode).toBe("wasm");
		expect(session.getDiagnostics().backendLoadError).toBeNull();
		expect(normalizeRppgError(session.lastError, session.getDiagnostics())).toBeNull();
		await session.dispose();
	});

	test("backend wasm still throws the loader's error instead of falling back", async () => {
		await expect(
			createRppgSession({ ...autoOptions(failingImporter()), backend: "wasm" }),
		).rejects.toMatchObject({ name: "RppgWasmLoadError", attemptedUrls: DEFAULT_URLS });
	});
});
