import {
	PULSE_CHECK_RULE_NAMES,
	PulseCheck,
	resolvePulseCheckRules,
} from "../pulseCheck";
import {
	OWN_PULSE_MIN_AGREEING,
	OWN_PULSE_ONE_REGION_MIN_AGREEING,
	type OwnPulseEstimate,
	ownPulseVerdict,
} from "../pulseCheckCore";

// Rule oneRegion (on unless false): a window counts toward the proof when one region carries the line, not two.
const est = (bpm: number, regions: number[], snrDb = -2.5): OwnPulseEstimate =>
	({ bpm, bpmFine: bpm, snrDb, agreeing: regions }) as unknown as OwnPulseEstimate;
const run = (regions: number[], minAgreeing?: number) =>
	ownPulseVerdict(
		Array.from({ length: 10 }, () => est(72, regions)),
		null,
		undefined,
		minAgreeing,
	).verdict;

describe("rule oneRegion", () => {
	it("is on unless set to false, and is a named rule", () => {
		expect(resolvePulseCheckRules().oneRegion).toBe(true);
		expect(resolvePulseCheckRules({ oneRegion: false }).oneRegion).toBe(false);
		expect(new PulseCheck().rules.oneRegion).toBe(true);
		expect(PULSE_CHECK_RULE_NAMES).toContain("oneRegion");
	});
	it("the two bars", () => {
		expect([OWN_PULSE_MIN_AGREEING, OWN_PULSE_ONE_REGION_MIN_AGREEING]).toEqual([2, 1]);
	});
	it("off: a line one region carries is refused, two prove it", () => {
		expect(run([0])).not.toBe("measured");
		expect(run([0, 1])).toBe("measured");
	});
	it("on: a line one region carries is proven", () => {
		expect(run([0], OWN_PULSE_ONE_REGION_MIN_AGREEING)).toBe("measured");
	});
	it("on: a line no region carries is still refused", () => {
		expect(run([], OWN_PULSE_ONE_REGION_MIN_AGREEING)).not.toBe("measured");
	});
});
