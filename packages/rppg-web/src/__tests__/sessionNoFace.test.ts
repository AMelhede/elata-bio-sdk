import { RppgSession } from "../rppgSession";

// With face tracking on, once no face has been in view for a second the session reports no heart
// rate (and no HRV or breathing), instead of the last number or one read off the wall.
const processorMetrics = { bpm: 84, confidence: 0.6, signal_quality: 0.3, hrv_rmssd: 180, respiration_rate: 12, respiration_confidence: 1, spectral_bpm: 84, acf_bpm: 83, peaks_bpm: 85, bayes_bpm: 84, resolved_bpm: 84, resolved_confidence: 0.7, bayes_confidence: 0.65, baseline_bpm: 70, baseline_delta: 14 };
const make = (goneMs: number) =>
	new RppgSession(
		{} as never,
		{ getMetrics: () => ({ ...processorMetrics }) } as never,
		{ faceAbsentMs: () => goneMs } as never,
		"wasm",
		"face_mesh",
	);

describe("RppgSession with no face in view", () => {
	it("reports no heart rate once the face has been gone for a second", () => {
		const m = make(1000).getMetrics();
		expect(m.bpm).toBeNull();
		expect(m.hrv_rmssd).toBeNull();
		expect(m.respiration_rate).toBeNull();
		// Not only the headline rate: every intermediate rate, and the confidence.
		expect([m.spectral_bpm, m.acf_bpm, m.peaks_bpm, m.bayes_bpm]).toEqual([null, null, null, null]);
		expect(m.confidence).toBe(0);
		expect([m.resolved_bpm, m.resolved_confidence, m.bayes_confidence, m.baseline_delta]).toEqual([null, 0, 0, null]);
		// The rolling baseline is the person's, not this frame's.
		expect(m.baseline_bpm).toBe(70);
		expect(m.reason_codes).toContain("no_face");
	});
	it("keeps the rate through a face-finder blip shorter than a second", () => {
		expect(make(400).getMetrics().bpm).toBe(84);
	});
	it("is unchanged while a face is in view", () => {
		expect(make(0).getMetrics()).toEqual(processorMetrics);
	});
});
