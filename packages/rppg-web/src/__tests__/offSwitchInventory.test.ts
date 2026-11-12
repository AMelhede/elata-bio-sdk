import { PULSE_CHECK_RULE_NAMES, resolvePulseCheckRules } from "../pulseCheck";

// Jest provides require and __dirname; this package's tests carry no Node type declarations.
declare const require: (id: string) => any;
declare const __dirname: string;

// Off switches are inventory with a carrying cost (Hodgson, "Feature Toggles", martinfowler.com: keep the inventory
// low, give each release toggle an expiry, cap the count, a "time bomb" test that fails once a toggle outlives it).
// Every switch that is off by default is listed here with the date by which it is either turned on (and its switch
// deleted) or its code removed. A new off switch, or one past its date, fails this test. The cap only goes down.
const OFF_SWITCHES: Record<string, string> = {
	moreReadings: "2026-11-30", // testers' paired runs; shows more numbers on photos, needs liveness first
	skinFallback: "2026-12-15", // patch layout v2 files from Mac, Windows and Firefox, the bench colour-cast copies and the full gate before it is turned on (evsave QUEUE FB2-M)
	fpsCeiling: "2026-11-30", // being measured on received files and the full gate before it is turned on
	startEvidence: "2026-12-10", // the first number's sequential start test: blind check and full gate, then on with the tracker or removed (evsave TRIED FB3)
	localSpread: "2026-12-10", // the line over its own local spread (movement bursts): blind check and full gate, then on by kind or removed (evsave TRIED ML4)
	tracker: "2026-12-31", // the one-model redesign: measured on every received file, the lab and the full gate before it replaces the streak rules
	blinkGate: "2026-11-30",
	experimentalVitals: "2026-12-31", // research box, never shown as a reading (a session option, not a rule)
};
// 6 while coherentFusion is measured on the owner's devices (page ?fusion=1), decided by 2026-11-30: turned on and
// its switch deleted, or removed. Back to 5 then.
// 7 while shortStreak is measured on testers' devices (the owner asked for the threshold to move toward the wearables,
// 2026-10-30), decided by 2026-11-15: turned on and its switch deleted, or removed. Back to 6 then.
// 6 since roomLight was deleted (2026-10-30, it changed no shown second on real-device or lab recordings).
// Still 6 on 2026-10-30: shortStreak decided on received recordings and turned on (its off slot gone), followRecent in.
// 7 on 2026-11-11 for startEvidence, until 2026-12-10 (decided on the blind check and the gate: on, or removed). Back to 6 then.
// 8 on 2026-11-11 for localSpread, until 2026-12-10 (decided on the blind check and the gate: on, or removed).
const MAX_OFF = 8;

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

// Session-level switches (createRppgSession options, off unless set; an app turns each on per device kind) are inventory
// too, with their own list and ceiling, so a fourth cannot be added silently (2026-11-11). The rules' ceiling is apart.
const SESSION_SWITCHES: Record<string, string> = {
	faceFinderWorker: "2026-12-31", // the finder in a worker; the slow-device switch turns it on where frames are too few
	backgroundFrames: "2026-12-31", // reading while hidden; the page turns it on per device kind
	slowSwitch: "2026-12-31", // the slow-device switch; the page turns it on per device kind after the slow cells
};
const MAX_SESSION_OFF = 3;

describe("off-by-default session switch inventory", () => {
	const src = (require("fs") as { readFileSync: (p: string, e: string) => string }).readFileSync(
		(require("path") as { join: (...p: string[]) => string }).join(__dirname, "..", "rppgSession.ts"),
		"utf8",
	);
	it("every listed switch is a session option", () => {
		for (const n of Object.keys(SESSION_SWITCHES)) expect(src).toMatch(new RegExp(`^\\t${n}\\?:`, "m"));
	});
	it("stays at or under its own cap", () => {
		expect(Object.keys(SESSION_SWITCHES).length).toBeLessThanOrEqual(MAX_SESSION_OFF);
	});
	it("no session switch is past its date", () => {
		const today = new Date().toISOString().slice(0, 10);
		for (const [n, d] of Object.entries(SESSION_SWITCHES)) expect(`${n} ${today <= d ? "in date" : "expired " + d}`).toBe(`${n} in date`);
	});
});

