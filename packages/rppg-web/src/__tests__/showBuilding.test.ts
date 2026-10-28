import { ownPulseVerdict, OWN_PULSE_STRONG_STREAK, type OwnPulseEstimate } from "../pulseCheckCore";
import { buildingRate, resolvePulseCheckRules, shownPulseBpm } from "../pulseCheck";

// Rule showBuilding (off unless true): a not-yet-proven streak as long as the check's shortest accepted one, at the
// check's own SNR bar, is shown as the building rate.
const win = (bpm: number, snrDb: number): OwnPulseEstimate =>
	({ windowS: 16, frames: 480, fps: 30, regions: [], agreeing: ["forehead", "leftCheek", "rightCheek"], bpm, bpmFine: bpm + 0.2, snrDb }) as unknown as OwnPulseEstimate;

describe("rule showBuilding", () => {
	it("is off unless set to true", () => {
		expect(resolvePulseCheckRules().showBuilding).toBe(false);
		expect(resolvePulseCheckRules({ showBuilding: true }).showBuilding).toBe(true);
	});
	it("a 4-window streak at -2 dB is not proven, and builds at its mean fine rate", () => {
		const v = ownPulseVerdict(Array.from({ length: OWN_PULSE_STRONG_STREAK }, () => win(70, -2)));
		expect(v.verdict).not.toBe("measured");
		expect(v.streak).toBe(OWN_PULSE_STRONG_STREAK);
		expect(buildingRate(v, false)).toBe(70.2);
		expect(shownPulseBpm({ verdict: v.verdict, bpm: null, buildingBpm: buildingRate(v, false) })).toBe(70.2);
	});
	it("one window short, under the bar, or withheld: nothing", () => {
		expect(buildingRate(ownPulseVerdict(Array.from({ length: OWN_PULSE_STRONG_STREAK - 1 }, () => win(70, -2))), false)).toBeNull();
		expect(buildingRate(ownPulseVerdict(Array.from({ length: OWN_PULSE_STRONG_STREAK }, () => win(70, -3.5))), false)).toBeNull();
		expect(buildingRate(ownPulseVerdict(Array.from({ length: OWN_PULSE_STRONG_STREAK }, () => win(70, -2))), true)).toBeNull();
	});
	it("a proven verdict shows its own rate, never the building one", () => {
		expect(shownPulseBpm({ verdict: "measured", bpm: 64, buildingBpm: 70 })).toBe(64);
		expect(shownPulseBpm({ verdict: "not-measured", bpm: null })).toBeNull();
	});
});
