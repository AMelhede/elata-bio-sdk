import { PulseCheck, resolvePulseCheckRules } from "../pulseCheck";
import {
	OWN_PULSE_EDGE_BPM,
	OWN_PULSE_LOW_BAND_BPM,
	OWN_PULSE_REST_BAND_MIN_SNR_DB,
	type OwnPulseEstimate,
	ownPulseVerdict,
} from "../pulseCheckCore";

// Rule restBand (off by default until measured on real people): the low band, where every region must
// carry the line, starts at OWN_PULSE_EDGE_BPM (52) instead of OWN_PULSE_LOW_BAND_BPM (58). A resting
// rate of 56 seen by two of three regions was refused for a whole calm stretch (owner pilot 2026-10-22,
// Muse 58.3, the camera's line at 56.3 to 57.8 in two regions).
const est = (bpm: number, regions: number[], snrDb = 1): OwnPulseEstimate =>
	({ bpm, bpmFine: bpm, snrDb, agreeing: regions }) as unknown as OwnPulseEstimate;
const run = (bpm: number, regions: number[], lowBandBpm?: number, snrDb = 1) =>
	ownPulseVerdict(Array.from({ length: 10 }, () => est(bpm, regions, snrDb)), null, lowBandBpm).verdict;

describe("rule restBand", () => {
	it("is off unless asked for", () => {
		expect(resolvePulseCheckRules().restBand).toBe(false);
		expect(resolvePulseCheckRules({ restBand: true }).restBand).toBe(true);
	});
	it("default: 56 bpm in two regions is refused, in three it is proven", () => {
		expect(run(56, [0, 1])).not.toBe("measured");
		expect(run(56, [0, 1, 2])).toBe("measured");
	});
	it("restBand: 56 bpm in two regions is proven", () => {
		expect(run(56, [0, 1], OWN_PULSE_EDGE_BPM)).toBe("measured");
	});
	it("restBand: a two-region line from 52 to 57 also needs -2 dB", () => {
		// Without this bar the rule added invented seconds on no-pulse video; with it, a
		// held-out test added none and no wrong second.
		expect(OWN_PULSE_REST_BAND_MIN_SNR_DB).toBe(-2);
		expect(run(56, [0, 1], OWN_PULSE_EDGE_BPM, -2.5)).not.toBe("measured");
		expect(run(56, [0, 1], OWN_PULSE_EDGE_BPM, -2)).toBe("measured");
		// Every region behind it, or at 58 and over, the usual -3 dB bar still applies.
		expect(run(56, [0, 1, 2], OWN_PULSE_EDGE_BPM, -2.5)).toBe("measured");
		expect(run(60, [0, 1], OWN_PULSE_EDGE_BPM, -2.5)).toBe("measured");
	});
	it("restBand: under 52 still needs all three regions and the edge bar", () => {
		expect(run(50, [0, 1], OWN_PULSE_EDGE_BPM)).not.toBe("measured");
		expect(run(50, [0, 1, 2], OWN_PULSE_EDGE_BPM, -1)).not.toBe("measured");
		expect(run(50, [0, 1, 2], OWN_PULSE_EDGE_BPM, 1)).toBe("measured");
	});
	it("the two bars are what the rule says", () => {
		expect([OWN_PULSE_EDGE_BPM, OWN_PULSE_LOW_BAND_BPM]).toEqual([52, 58]);
	});
	it("PulseCheck takes the rule", () => {
		expect(new PulseCheck({ rules: { restBand: true } }).rules.restBand).toBe(true);
	});
});
