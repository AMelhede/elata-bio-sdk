import { RppgSession } from "../rppgSession";

// With face tracking on, once no face has been in view for a second the session reports no heart
// rate (and no HRV or breathing), instead of the last number or one read off the wall.
const processorMetrics = { bpm: 84, confidence: 0.6, signal_quality: 0.3, hrv_rmssd: 180, respiration_rate: 12, respiration_confidence: 1 };
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
	});
	it("keeps the rate through a face-finder blip shorter than a second", () => {
		expect(make(400).getMetrics().bpm).toBe(84);
	});
	it("is unchanged while a face is in view", () => {
		expect(make(0).getMetrics()).toEqual(processorMetrics);
	});
});
