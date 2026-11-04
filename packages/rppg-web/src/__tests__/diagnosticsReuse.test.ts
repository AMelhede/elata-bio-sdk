import { RppgSession } from "../rppgSession";

// The testers' page reads getDiagnostics() inside onDiagnostics on every frame, so the session analysed the window
// twice a frame (the debug snapshot re-reads the engine). Inside the callback the session hands back the object it
// just computed; with the engine's rate tracker on it does not, because each engine read steps the tracker.
const make = (reuse: boolean, onDiagnostics: (s: RppgSession) => void) => {
	const snapshots = { n: 0 };
	let session: RppgSession;
	session = new RppgSession(
		{} as never,
		{
			getMetrics: () => ({ bpm: 70, confidence: 0.5, signal_quality: 0.3 }),
			getDebugSnapshot: () => {
				snapshots.n += 1;
				return { totalSamplesReceived: snapshots.n, windowSampleCount: 5, windowDurationMs: 1000, lastSampleTimestampMs: 1, lastSampleAgeMs: 0, lastSample: null, issues: [] };
			},
			getBackendFailure: () => null,
		} as never,
		{
			faceAbsentMs: () => 0,
			msSinceAnalysisRestart: () => null,
			getDiagnostics: () => ({ lastDropReason: null, lastRoiSource: null, lastProcessorMethod: null }),
		} as never,
		"wasm",
		"face_mesh",
		{ onDiagnostics: () => onDiagnostics(session), reuseDiagnosticsInCallback: reuse },
	);
	return { session, snapshots };
};

describe("getDiagnostics() inside onDiagnostics", () => {
	it("returns the object the callback was handed, with one analysis per emit", () => {
		const seen: unknown[] = [];
		const { session, snapshots } = make(true, (s) => seen.push(s.getDiagnostics()));
		const handed: unknown[] = [];
		(session as unknown as { internals: { onDiagnostics: (d: unknown) => void } }).internals.onDiagnostics = (d) => {
			handed.push(d);
			seen.push(session.getDiagnostics());
		};
		session.emitDiagnostics();
		session.emitDiagnostics();
		expect(snapshots.n).toBe(2);
		expect(seen[0]).toBe(handed[0]);
		expect(seen[1]).toBe(handed[1]);
		expect((seen[1] as { totalSamplesReceived: number }).totalSamplesReceived).toBe(2);
	});

	it("computes afresh outside the callback, and whenever a time is given", () => {
		let inside: unknown = null;
		const { session, snapshots } = make(true, (s) => {
			inside = s.getDiagnostics(Date.now());
		});
		session.emitDiagnostics();
		expect(snapshots.n).toBe(2);
		expect((inside as { totalSamplesReceived: number }).totalSamplesReceived).toBe(2);
		expect(session.getDiagnostics().totalSamplesReceived).toBe(3);
	});

	it("computes afresh inside the callback when the engine's rate tracker is on", () => {
		const { session, snapshots } = make(false, (s) => s.getDiagnostics());
		session.emitDiagnostics();
		expect(snapshots.n).toBe(2);
	});

	it("does not analyse on an emit with no callback, as before", () => {
		const { session, snapshots } = make(true, () => {});
		(session as unknown as { internals: { onDiagnostics?: unknown } }).internals.onDiagnostics = undefined;
		session.emitDiagnostics();
		expect(snapshots.n).toBe(0);
	});
});
