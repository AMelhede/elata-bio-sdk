import { PULSE_CHECK_RULE_NAMES, resolvePulseCheckRules } from "../pulseCheck";

// Off switches are inventory with a carrying cost (Hodgson, "Feature Toggles", martinfowler.com: keep the inventory
// low, give each release toggle an expiry, cap the count, a "time bomb" test that fails once a toggle outlives it).
// Every switch that is off by default is listed here with the date by which it is either turned on (and its switch
// deleted) or its code removed. A new off switch, or one past its date, fails this test. The cap only goes down.
const OFF_SWITCHES: Record<string, string> = {
	showHeld: "2026-11-30", // passed on the front webcam, not significant on two others; rising heart rates untested
	roomLight: "2026-11-07", // CONFIRM tested it only paired with the removed foreheadPool (that pair failed on no-pulse shuffles); alone it needs new people
	showBuilding: "2026-11-30", // testers' paired runs
	relock: "2026-11-30", // testers' paired runs
	experimentalVitals: "2026-12-31", // research box, never shown as a reading (a session option, not a rule)
};
const MAX_OFF = 5;

describe("off-by-default switch inventory", () => {
	it("every rule off by default is listed with an expiry, and nothing listed is gone", () => {
		const resolved = resolvePulseCheckRules();
		const offRules = PULSE_CHECK_RULE_NAMES.filter((n) => resolved[n] === false);
		for (const n of offRules) expect(OFF_SWITCHES).toHaveProperty(n);
		const sessionOptions = ["experimentalVitals"];
		for (const n of Object.keys(OFF_SWITCHES)) expect([...offRules, ...sessionOptions]).toContain(n);
	});
	it("stays at or under the cap", () => {
		expect(Object.keys(OFF_SWITCHES).length).toBeLessThanOrEqual(MAX_OFF);
	});
	it("no switch is past its date", () => {
		const today = new Date().toISOString().slice(0, 10);
		for (const [n, d] of Object.entries(OFF_SWITCHES)) expect(`${n} ${today <= d ? "in date" : "expired " + d}`).toBe(`${n} in date`);
	});
});
