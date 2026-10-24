import { ownPulseVerdict, OWN_PULSE_EDGE_BPM, OWN_PULSE_STREAK, type OwnPulseEstimate } from "../pulseCheckCore";

const win = (bpm: number, snrDb: number, agreeing: string[]): OwnPulseEstimate =>
	({ windowS: 16, frames: 480, fps: 30, regions: [], agreeing, bpm, snrDb }) as unknown as OwnPulseEstimate;

describe("rule slowTwo: below the edge, two regions count at the edge bar", () => {
	const two = ["leftCheek", "rightCheek"];
	it("a strong 48 bpm line on two regions is proven only with the rule", () => {
		const h = Array.from({ length: OWN_PULSE_STREAK }, () => win(48, 2, two));
		expect(ownPulseVerdict(h, null, OWN_PULSE_EDGE_BPM).verdict).not.toBe("measured");
		expect(ownPulseVerdict(h, null, OWN_PULSE_EDGE_BPM, true).verdict).toBe("measured");
	});
	it("still needs the edge bar: the same line under it does not count", () => {
		const h = Array.from({ length: OWN_PULSE_STREAK }, () => win(48, -1, two));
		expect(ownPulseVerdict(h, null, OWN_PULSE_EDGE_BPM, true).verdict).not.toBe("measured");
	});
	it("one region is never enough", () => {
		const h = Array.from({ length: OWN_PULSE_STREAK + 4 }, () => win(48, 3, ["leftCheek"]));
		expect(ownPulseVerdict(h, null, OWN_PULSE_EDGE_BPM, true).verdict).not.toBe("measured");
	});
});
