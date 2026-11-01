import { estimateOwnPulse, OWN_PULSE_DRIFT_LINE_BPM, type RawRoiSample } from "../pulseCheckCore";
import { PULSE_CHECK_RULE_NAMES, resolvePulseCheckRules } from "../pulseCheck";

// Three regions at 30 fps with a 70 bpm pulse on all three and a stronger 46 bpm drift on two of them only (a slow
// light or posture rhythm a still laptop run shows, as in the owner's da2357a4 and aa109618).
function capture(driftOnThird: number) {
	let s = 5;
	const noise = () => ((s = (s * 16807) % 2147483647) / 2147483647 - 0.5) * 0.2;
	const rows: RawRoiSample[] = [];
	for (let t = 0; t <= 20000; t += 1000 / 30) {
		const p = 0.006 * Math.sin((2 * Math.PI * 70 * t) / 60000);
		const d = 0.012 * Math.sin((2 * Math.PI * 46 * t) / 60000);
		// The drift in the colour direction POS keeps (a brightness change alone it cancels).
		const region = (drift: number) => {
			const q = p + drift * d;
			return [150 * (1 - 0.3 * q) + noise(), 110 * (1 - q) + noise(), 90 * (1 - 0.6 * q) + noise()];
		};
		rows.push([t, ...region(1), ...region(1), ...region(driftOnThird), 180, 175, 170] as unknown as RawRoiSample);
	}
	return rows;
}
const at = (rows: RawRoiSample[], rule: boolean) =>
	estimateOwnPulse(rows, 16, rows[rows.length - 1][0], undefined, undefined, false, rule)?.bpm ?? null;

describe("rule driftLine", () => {
	it("is on unless false, and is a named rule", () => {
		expect(resolvePulseCheckRules().driftLine).toBe(true);
		expect(resolvePulseCheckRules({ driftLine: false }).driftLine).toBe(false);
		expect(PULSE_CHECK_RULE_NAMES).toContain("driftLine");
		expect(OWN_PULSE_DRIFT_LINE_BPM).toBe(52);
	});
	it("off: a drift line two regions carry hides the pulse", () => {
		const bpm = at(capture(0), false);
		expect(bpm).not.toBeNull();
		expect(Math.abs((bpm as number) - 46)).toBeLessThan(6);
	});
	it("on: the window reads the pulse past it", () => {
		const bpm = at(capture(0), true);
		expect(Math.abs((bpm as number) - 70)).toBeLessThan(4);
	});
	it("on: a low line all three regions carry is kept (it can count)", () => {
		const bpm = at(capture(1), true);
		expect(Math.abs((bpm as number) - 46)).toBeLessThan(6);
	});
});
