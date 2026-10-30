import { PULSE_CHECK_RULE_NAMES, resolvePulseCheckRules } from "../pulseCheck";

// Off switches are inventory with a carrying cost (Hodgson, "Feature Toggles", martinfowler.com: keep the inventory
// low, give each release toggle an expiry, cap the count, a "time bomb" test that fails once a toggle outlives it).
// Every switch that is off by default is listed here with the date by which it is either turned on (and its switch
// deleted) or its code removed. A new off switch, or one past its date, fails this test. The cap only goes down.
const OFF_SWITCHES: Record<string, string> = {
	roomLight: "2026-11-07", // CONFIRM tested it only paired with the removed foreheadPool (that pair failed on no-pulse shuffles); alone it needs new people
	moreReadings: "2026-11-30", // testers' paired runs; shows more numbers on photos, needs liveness first
	foreheadPool: "2026-11-30", // set by the session switch foreheadPool; held-out on new files that record patches
	coherentFusion: "2026-11-30", // page ?fusion=1 for the owner's paired runs; more numbers, more on lamps and no-pulse copies
	blinkGate: "2026-11-30",
	shortStreak: "2026-11-15", // testers' runs with references on the testbed page decide it (on by default there) // passed MCD CONFIRM; real photos and screens on testers' devices next
	experimentalVitals: "2026-12-31", // research box, never shown as a reading (a session option, not a rule)
};
// 6 while coherentFusion is measured on the owner's devices (page ?fusion=1), decided by 2026-11-30: turned on and
// its switch deleted, or removed. Back to 5 then.
// 7 while shortStreak is measured on testers' devices (the owner asked for the threshold to move toward the wearables,
// 2026-10-30), decided by 2026-11-15: turned on and its switch deleted, or removed. Back to 6 then.
const MAX_OFF = 7;

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
