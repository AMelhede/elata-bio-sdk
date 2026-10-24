// Peak's own unit tests for its early path (feat/reading-protocol-accuracy, src/pulse/ownPulse.test.ts, describe
// 'earlyPulse: beats and spectrum agreeing confirm a strong lit pulse from 12 s'), ported unchanged against the SDK's
// copy. lane/confirm1's prereg: if the port cannot match these, earlyPath is reported as not tested.
import { earlyPulse, OWN_PULSE_EARLY_MAX_CV, type RawRoiSample } from "../pulseCheckCore";

describe("earlyPulse: beats and spectrum agreeing confirm a strong lit pulse from 12 s (Peak's tests)", () => {
	function allRegions(bpm: number, seconds: number, fps: number, amp: number, noise = 0.3): RawRoiSample[] {
		const out: RawRoiSample[] = [];
		let seed = 11;
		const rnd = () => {
			seed = (seed * 1103515245 + 12345) & 0x7fffffff;
			return seed / 0x7fffffff - 0.5;
		};
		for (let i = 0; i < seconds * fps; i++) {
			const t = i / fps;
			const p = Math.sin(2 * Math.PI * (bpm / 60) * t) + 0.4 * Math.sin(4 * Math.PI * (bpm / 60) * t);
			const n = () => rnd() * noise;
			out.push([
				Math.round(t * 1000),
				180 + n(), 130 - amp * p + n(), 118 + n(),
				160 + n(), 105 - amp * p + n(), 92 + n(),
				165 + n(), 108 - amp * p + n(), 95 + n(),
			] as RawRoiSample);
		}
		return out;
	}
	it("confirms a clean pulse at 12 s, at the right rate", () => {
		const s = allRegions(72, 12, 28, 1.5);
		const e = earlyPulse(s, s[s.length - 1][0]);
		expect(e).not.toBeNull();
		expect(Math.abs(e! - 72)).toBeLessThanOrEqual(3);
	});
	it("says nothing before 12 s of signal", () => {
		const s = allRegions(72, 20, 28, 1.5);
		expect(earlyPulse(s.filter((r) => r[0] <= 10_000), 10_000)).toBeNull();
	});
	it("judges the LAST 12 s at any point in the capture, not only 12 to 16 s after the press", () => {
		const noisy = allRegions(72, 18, 28, 0, 6);
		const clean = allRegions(72, 12, 28, 1.5).map((r) => [r[0] + 18_000, ...r.slice(1)] as RawRoiSample);
		const s = [...noisy, ...clean];
		const e = earlyPulse(s, s[s.length - 1][0]);
		expect(e).not.toBeNull();
		expect(Math.abs(e! - 72)).toBeLessThanOrEqual(3);
	});
	it("says nothing from a camera slowed for light", () => {
		const s = allRegions(72, 12, 16.5, 1.5);
		expect(earlyPulse(s, s[s.length - 1][0])).toBeNull();
	});
	it("the beat-regularity bar sits between real beats (0.08 to 0.12) and noise peaks (0.30 to 0.50)", () => {
		expect(OWN_PULSE_EARLY_MAX_CV).toBeGreaterThan(0.12);
		expect(OWN_PULSE_EARLY_MAX_CV).toBeLessThan(0.24);
	});
	it("says nothing on noise with no pulse in it", () => {
		const s = allRegions(72, 12, 28, 0, 2);
		expect(earlyPulse(s, s[s.length - 1][0])).toBeNull();
	});
});
