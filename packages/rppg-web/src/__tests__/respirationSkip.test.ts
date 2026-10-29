import { analyzePulseWindow, type PulseWindowSample } from "../pulseAnalysis";

// With the pulse check on, the session withholds the engine's breathing from every read and experimentalVitals
// reads breathing from the chest instead, so the engine need not compute it; the breathing scan was a tenth of the
// page's CPU. Off, nothing else in the window analysis changes.
const window = (): PulseWindowSample[] =>
	Array.from({ length: 300 }, (_, i) => {
		const t = i / 30;
		return { timestampMs: t * 1000, intensity: Math.sin(2 * Math.PI * 1.2 * t) + 0.3 * Math.sin(2 * Math.PI * 0.25 * t), skinRatio: 1, motion: 0, clipRatio: 0 };
	});

test("respiration off: no breathing rate, everything else identical", () => {
	const on = analyzePulseWindow(window());
	const off = analyzePulseWindow(window(), { respiration: false });
	expect(on?.respiration).not.toBeNull();
	expect(off?.respiration).toBeNull();
	expect(off?.respirationConfidence).toBeNull();
	expect({ ...off, respiration: null, respirationConfidence: null }).toEqual({ ...on, respiration: null, respirationConfidence: null });
});
