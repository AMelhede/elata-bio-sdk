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

	it("reports nothing from the engine's last window after the failure, and keeps the person's baseline", () => {
		const engine = {
			getMetrics: () => ({ ...raw, spectral_bpm: 96, agreement: 0.9, winning_sources: ["spectral", "acf"], alias_flag: true, snr: 6, bayes_ambiguity: 0.2, skin_ratio_mean: 0.8, motion_mean: 0.1, clip_mean: 0.02, resolved_confidence: 0.7, bayes_confidence: 0.65, baseline_bpm: 70, baseline_delta: 27, calibration_trained: true, reason_codes: ["LOW_SNR"] }),
			getBackendFailure: () => null,
		};
		const session = new RppgSession({} as never, engine as never, { faceAbsentMs: () => 0, msSinceAnalysisRestart: () => null, fixes: undefined } as never, "wasm", "face_mesh", { pulseCheck: null });
		fail(session);
		const m = session.getMetrics();
		expect([m.agreement, m.winning_sources, m.alias_flag, m.signal_quality]).toEqual([0, [], false, 0]);
		expect([m.skin_ratio_mean, m.motion_mean, m.clip_mean, m.resolved_confidence, m.bayes_confidence, m.baseline_delta]).toEqual([0, 0, 0, 0, 0, null]);
		expect(m.snr).toBeUndefined();
		expect(m.bayes_ambiguity).toBeUndefined();
		expect([m.baseline_bpm, m.calibration_trained]).toEqual([70, true]);
		expect(m.reason_codes).toEqual(["LOW_SNR", "processor_failed"]);
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
