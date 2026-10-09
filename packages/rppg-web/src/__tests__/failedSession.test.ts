import { RppgSession } from "../rppgSession";

// After the engine throws, the runner stops and no frame reaches the pulse check again, so its
// state stays at its last verdict. getMetrics() kept returning that proven rate, and a page showed a
// frozen number as if live, with no signal behind it. A failed session reports no number.
const raw = { bpm: 97, confidence: 0.75, signal_quality: 0.3, hrv_rmssd: 180, respiration_rate: 12.3, respiration_confidence: 1 };

const make = ({ pulseCheck = true }: { pulseCheck?: boolean } = {}) => {
	const engine = {
		getMetrics: () => ({ ...raw, spectral_bpm: 96 }),
		getDebugSnapshot: () => ({ totalSamplesReceived: 10, windowSampleCount: 5, windowDurationMs: 1000, lastSampleTimestampMs: 1, lastSampleAgeMs: 0, lastSample: null, issues: [], backendMetrics: { ...raw } }),
		getBackendFailure: () => null,
	};
	const session = new RppgSession(
		{} as never,
		engine as never,
		{ faceAbsentMs: () => 0, msSinceAnalysisRestart: () => null, fixes: undefined } as never,
		"wasm",
		"face_mesh",
		{
			pulseCheck: pulseCheck ? ({ getState: () => ({ verdict: "measured", bpm: 71.5, snrDb: null, streak: 0 }) } as never) : null,
			experimentalVitals: true,
		},
	);
	return session;
};

const fail = (session: RppgSession) =>
	session.recordError({ code: "processor_error", stage: "processor", message: "unreachable", timestampMs: 1234 });

describe("a session whose engine failed reports no number", () => {
	it("shows the proven rate while running (the control)", () => {
		expect(make().getMetrics().bpm).toBe(71.5);
	});

	it("with the pulse check on, the frozen proven rate is not reported after the failure", () => {
		const session = make();
		fail(session);
		const m = session.getMetrics();
		expect(session.getState().terminal).toBe(true);
		expect(m.bpm).toBeNull();
		expect(m.spectral_bpm).toBeNull();
		expect(m.reason_codes).toContain("processor_failed");
	});

	it("with the pulse check off, the engine's last rate is not reported either", () => {
		const session = make({ pulseCheck: false });
		expect(session.getMetrics().bpm).toBe(97);
		fail(session);
		expect(session.getMetrics().bpm).toBeNull();
	});

	it("hands over no experimental HRV after the failure", () => {
		const session = make({ pulseCheck: false });
		session.getMetrics();
		expect(session.getExperimentalVitals()?.hrvRmssd).toBe(180);
		fail(session);
		session.getMetrics();
		expect(session.getExperimentalVitals()?.hrvRmssd).toBeNull();
	});
});
