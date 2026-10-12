import { RppgSession } from "../rppgSession";

// With face tracking on, once no face has been in view for two seconds the session reports no heart
// rate (and no HRV or breathing), instead of the last number or one read off the wall.
const processorMetrics = { bpm: 84, confidence: 0.6, signal_quality: 0.3, hrv_rmssd: 180, respiration_rate: 12, respiration_confidence: 1, spectral_bpm: 84, acf_bpm: 83, peaks_bpm: 85, bayes_bpm: 84, resolved_bpm: 84, resolved_confidence: 0.7, bayes_confidence: 0.65, baseline_bpm: 70, baseline_delta: 14, agreement: 0.9, winning_sources: ["spectral" as const, "acf" as const], alias_flag: true, bayes_ambiguity: 0.2, snr: 6, skin_ratio_mean: 0.8, motion_mean: 0.1, clip_mean: 0.02, calibration_trained: true, bayes_tracker_config_id: "cfg", capture_confidence: 0.7, reason_codes: ["LOW_SNR"] };
const make = (goneMs: number) =>
	new RppgSession(
		{} as never,
		{ getMetrics: () => ({ ...processorMetrics }) } as never,
		{ faceAbsentMs: () => goneMs } as never,
		"wasm",
		"face_mesh",
	);

describe("RppgSession with no face in view", () => {
	it("reports no heart rate once the face has been gone for two seconds", () => {
		const m = make(2000).getMetrics();
		expect(m.bpm).toBeNull();
		expect(m.hrv_rmssd).toBeNull();
		expect(m.respiration_rate).toBeNull();
		// Not only the headline rate: every intermediate rate, and the confidence.
		expect([m.spectral_bpm, m.acf_bpm, m.peaks_bpm, m.bayes_bpm]).toEqual([null, null, null, null]);
		expect(m.confidence).toBe(0);
		expect([m.resolved_bpm, m.resolved_confidence, m.bayes_confidence, m.baseline_delta]).toEqual([null, 0, 0, null]);
		// Nothing that describes the window of the last face: the same values as a failed backend.
		expect([m.agreement, m.winning_sources, m.alias_flag, m.signal_quality]).toEqual([0, [], false, 0]);
		expect([m.skin_ratio_mean, m.motion_mean, m.clip_mean]).toEqual([0, 0, 0]);
		expect(m.snr).toBeUndefined();
		expect(m.bayes_ambiguity).toBeUndefined();
		// What belongs to the person or the host stays: the rolling baseline, calibration state, the
		// tracker configuration and the capture fields the host feeds.
		expect(m.baseline_bpm).toBe(70);
		expect(m.calibration_trained).toBe(true);
		expect(m.bayes_tracker_config_id).toBe("cfg");
		expect(m.capture_confidence).toBe(0.7);
		expect(m.reason_codes).toEqual(["LOW_SNR", "no_face"]);
	});
	it("keeps the rate through a face loss shorter than two seconds", () => {
		expect(make(400).getMetrics().bpm).toBe(84);
		expect(make(1500).getMetrics().bpm).toBe(84);
	});
	it("is unchanged while a face is in view", () => {
		expect(make(0).getMetrics()).toEqual(processorMetrics);
	});
});
