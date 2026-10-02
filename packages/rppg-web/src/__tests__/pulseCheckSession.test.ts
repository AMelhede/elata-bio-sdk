import { RppgSession } from "../rppgSession";

// The session's getMetrics with the check on: only the proven heart rate is reported.
const processorMetrics = { bpm: 97, confidence: 0.75, signal_quality: 0.3, hrv_rmssd: 180, respiration_rate: 12.3, respiration_confidence: 1 };
const make = (state: { verdict: string; bpm: number | null } | null) =>
	new RppgSession(
		{} as never,
		{ getMetrics: () => ({ ...processorMetrics }) } as never,
		{} as never,
		"wasm",
		"face_mesh",
		state ? { pulseCheck: { getState: () => ({ ...state, snrDb: null, streak: 0 }) } as never } : {},
	);

describe("RppgSession with pulseCheck", () => {
	it("passes the processor's metrics through unchanged when the check is off", () => {
		expect(make(null).getMetrics()).toEqual(processorMetrics);
	});
	it("withholds heart rate, HRV and breathing until a pulse is proven", () => {
		const m = make({ verdict: "not-measured", bpm: null }).getMetrics();
		expect(m.bpm).toBeNull();
		expect(m.hrv_rmssd).toBeNull();
		expect(m.respiration_rate).toBeNull();
		expect(m.respiration_confidence).toBeNull();
	});
	it("reports the rate the check proved once it is proven", () => {
		expect(make({ verdict: "measured", bpm: 71.5 }).getMetrics().bpm).toBe(71.5);
	});
	it("withholds breathing and HRV even with a proven pulse: neither passes a known answer yet", () => {
		const m = make({ verdict: "measured", bpm: 71.5 }).getMetrics();
		expect(m.hrv_rmssd).toBeNull();
		expect(m.respiration_rate).toBeNull();
		expect(m.respiration_confidence).toBeNull();
	});
});
