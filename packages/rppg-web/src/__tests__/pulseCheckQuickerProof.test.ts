import { PULSE_CHECK_RULE_NAMES, PulseCheck, resolvePulseCheckRules } from "../pulseCheck";
import {
	OWN_PULSE_DARK_MIN_SNR_DB,
	OWN_PULSE_DARK_STREAK,
	OWN_PULSE_MIN_SNR_DB,
	OWN_PULSE_QUICK_DARK_MIN_SNR_DB,
	OWN_PULSE_QUICK_DARK_STREAK,
	OWN_PULSE_STREAK,
	type OwnPulseEstimate,
	ownPulseVerdict,
} from "../pulseCheckCore";

// Rule quickerProof (on unless false): the dark entry proves from fewer windows at a lower mean, and a streak longer than
// the proof's is judged on its newest OWN_PULSE_STREAK windows too.
const win = (bpm: number, snrDb: number, fps: number, regions = [0, 1]): OwnPulseEstimate =>
	({ bpm, bpmFine: bpm, snrDb, agreeing: regions, fps }) as unknown as OwnPulseEstimate;
const verdict = (history: OwnPulseEstimate[], rule: boolean) =>
	ownPulseVerdict(history, null, undefined, undefined, rule);

describe("rule quickerProof", () => {
	it("is on unless set to false, and is a named rule", () => {
		expect(resolvePulseCheckRules().quickerProof).toBe(true);
		expect(resolvePulseCheckRules({ quickerProof: false }).quickerProof).toBe(false);
		expect(new PulseCheck().rules.quickerProof).toBe(true);
		expect(PULSE_CHECK_RULE_NAMES).toContain("quickerProof");
	});
	it("the bars, off and on", () => {
		expect([OWN_PULSE_DARK_STREAK, OWN_PULSE_DARK_MIN_SNR_DB]).toEqual([16, -4.5]);
		expect([OWN_PULSE_QUICK_DARK_STREAK, OWN_PULSE_QUICK_DARK_MIN_SNR_DB]).toEqual([12, -5]);
	});
	// A camera slowed for light (16 fps): every window under the slowed bar, so only the dark entry can prove.
	const dark = (n: number, snrDb: number) => Array.from({ length: n }, () => win(70, snrDb, 16));
	it("off: the dark entry needs 16 windows at a mean of -4.5 dB", () => {
		expect(verdict(dark(12, -4.8), false).verdict).not.toBe("measured");
		expect(verdict(dark(16, -4.8), false).verdict).not.toBe("measured");
		expect(verdict(dark(16, -4.4), false).path).toBe("dark");
	});
	it("on: 12 windows at a mean of -5 dB prove it, 11 do not, nor a mean under -5", () => {
		expect(verdict(dark(12, -4.8), true).path).toBe("dark");
		expect(verdict(dark(11, -4.8), true).verdict).not.toBe("measured");
		expect(verdict(dark(12, -5.2), true).verdict).not.toBe("measured");
	});
	// Full-rate camera: four older weak windows of the same rate, then the newest eight at the proof's bar.
	const long = [...Array.from({ length: 4 }, () => win(70, -6, 30)), ...Array.from({ length: OWN_PULSE_STREAK }, () => win(70, OWN_PULSE_MIN_SNR_DB + 0.5, 30))];
	it("off: older weak windows of the same rate hold back the proof the newest eight make", () => {
		expect(verdict(long, false).verdict).not.toBe("measured");
	});
	it("on: the newest eight prove it; the streak's own windows still give the rate", () => {
		const v = verdict(long, true);
		expect(v.verdict).toBe("measured");
		expect(v.path).toBe("proof");
		expect(v.streak).toBe(12);
		// Newest eight under the bar: no proof either way.
		const weak = [...long.slice(0, 4), ...Array.from({ length: OWN_PULSE_STREAK }, () => win(70, OWN_PULSE_MIN_SNR_DB - 0.5, 30))];
		expect(verdict(weak, true).verdict).not.toBe("measured");
	});
});
