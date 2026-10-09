import { FACE_GONE_RESET_MS } from "../demoRunner";
import { RppgSession } from "../rppgSession";

// A status keyed on the last frame's drop reason flashed "No face in view" beside a live rate
// whenever the face finder missed one frame. The session reports when the face is gone in the sense
// that matters: long enough that getMetrics() stops reporting a rate.
const make = (faceAbsentMs: number) =>
	new RppgSession(
		{} as never,
		{
			getMetrics: () => ({ bpm: 97, confidence: 0.75, signal_quality: 0.3 }),
			getDebugSnapshot: () => ({ totalSamplesReceived: 10, windowSampleCount: 5, windowDurationMs: 1000, lastSampleTimestampMs: 1, lastSampleAgeMs: 0, lastSample: null, issues: [] }),
			getBackendFailure: () => null,
		} as never,
		{
			faceAbsentMs: () => faceAbsentMs,
			msSinceAnalysisRestart: () => null,
			getDiagnostics: () => ({ lastDropReason: faceAbsentMs > 0 ? "no_face" : null, lastRoiSource: null, lastProcessorMethod: null }),
		} as never,
		"wasm",
		"face_mesh",
		{ pulseCheck: { getState: () => ({ verdict: "measured", bpm: 71.5, snrDb: null, streak: 0 }) } as never },
	);

describe("getDiagnostics().faceGone", () => {
	it("stays false through a brief face-finder miss, while the rate is still reported", () => {
		const session = make(FACE_GONE_RESET_MS - 1);
		expect(session.getDiagnostics().lastDropReason).toBe("no_face");
		expect(session.getDiagnostics().faceGone).toBe(false);
		expect(session.getMetrics().bpm).toBe(71.5);
	});

	it("turns true when the face has been gone long enough that no rate is reported", () => {
		const session = make(FACE_GONE_RESET_MS);
		expect(session.getDiagnostics().faceGone).toBe(true);
		expect(session.getMetrics().bpm).toBeNull();
	});

	it("is false with a face in view", () => {
		expect(make(0).getDiagnostics().faceGone).toBe(false);
	});
});
