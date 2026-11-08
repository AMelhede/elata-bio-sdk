import { PULSE_CHECK_RULE_NAMES, resolvePulseCheckRules } from "../pulseCheck";

// Off switches are inventory with a carrying cost (Hodgson, "Feature Toggles", martinfowler.com: keep the inventory
// low, give each release toggle an expiry, cap the count, a "time bomb" test that fails once a toggle outlives it).
// Every switch that is off by default is listed here with the date by which it is either turned on (and its switch
// deleted) or its code removed. A new off switch, or one past its date, fails this test. The cap only goes down.
const OFF_SWITCHES: Record<string, string> = {
	moreReadings: "2026-11-30", // testers' paired runs; shows more numbers on photos, needs liveness first
	trackLine: "2026-11-30", // being measured on received files and the full gate before it is turned on
	fpsCeiling: "2026-11-30", // being measured on received files and the full gate before it is turned on
	harmonicStart: "2026-11-30", // being measured on received files and the full gate before it is turned on
	blinkGate: "2026-11-30",
	experimentalVitals: "2026-12-31", // research box, never shown as a reading (a session option, not a rule)
};
// 6 while coherentFusion is measured on the owner's devices (page ?fusion=1), decided by 2026-11-30: turned on and
// its switch deleted, or removed. Back to 5 then.
// 7 while shortStreak is measured on testers' devices (the owner asked for the threshold to move toward the wearables,
// 2026-10-30), decided by 2026-11-15: turned on and its switch deleted, or removed. Back to 6 then.
// 6 since roomLight was deleted (2026-10-30, it changed no shown second on real-device or lab recordings).
// Still 6 on 2026-10-30: shortStreak decided on received recordings and turned on (its off slot gone), followRecent in.
const MAX_OFF = 6;

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
