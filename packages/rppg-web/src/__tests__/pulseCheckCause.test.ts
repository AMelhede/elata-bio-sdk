import { OWN_PULSE_MIN_SNR_DB, OWN_PULSE_STREAK, OWN_PULSE_STRONG_STREAK } from "../pulseCheckCore";
import { PulseCheck, RELOCK_MS, RELOCK_STREAK, pulseCheckCause, pulseCheckColourDamaged, resolvePulseCheckRules, streakNeeded, type PulseCheckState } from "../pulseCheck";
import { OWN_PULSE_COLOUR_SWITCH } from "../pulseCheckCore";

// The check's first blocking cause, so every app says the same thing about why no number shows (spec
// SPEC-reading-state.md section 4), and the streak the running rules need for a number (section 3).

const base: PulseCheckState = { verdict: "not-measured", bpm: null, snrDb: null, streak: 0, wallMatch: false, windowBpm: 70, windowSnrDb: 0 };
const s = (x: Partial<PulseCheckState>): PulseCheckState => ({ ...base, ...x });

describe("pulseCheckCause", () => {
	it("names causes in their fixed priority", () => {
		expect(pulseCheckCause(s({ wallMatch: true, headMatch: true }), false)).toBe("noFace");
		expect(pulseCheckCause(s({ roomMatch: true, headMatch: true, windowSnrDb: null }), true)).toBe("lightFlicker");
		expect(pulseCheckCause(s({ screenLight: true }), true)).toBe("lightFlicker");
		expect(pulseCheckCause(s({ faceFlicker: true }), true)).toBe("lightFlicker");
		expect(pulseCheckCause(s({ headMatch: true, windowSnrDb: null }), true)).toBe("headMotion");
		expect(pulseCheckCause(s({ windowSnrDb: null, windowBpm: null }), true)).toBe("noRate");
		expect(pulseCheckCause(s({ windowSnrDb: OWN_PULSE_MIN_SNR_DB - 0.1 }), true)).toBe("weakSignal");
		expect(pulseCheckCause(s({ windowSnrDb: OWN_PULSE_MIN_SNR_DB }), true)).toBe("agreeing");
		expect(pulseCheckCause(s({ waitingForBlink: true }), true)).toBe("waitingForBlink");
	});
	it("is 'shown' whenever the state shows a rate, proven or building", () => {
		expect(pulseCheckCause(s({ verdict: "measured", bpm: 70 }), true)).toBe("shown");
		expect(pulseCheckCause(s({ buildingBpm: 70 }), true)).toBe("shown");
	});
	it("names the live check's cause on a real run: weak first, then shown", () => {
		const check = new PulseCheck();
		const causes = new Set<string>();
		for (let i = 0; i < 40 * 30; i++) {
			const t = (i * 1000) / 30;
			const p = Math.sin((2 * Math.PI * 1.2 * t) / 1000);
			const c = { r: 100 + 0.12 * p, g: 100 + 0.4 * p, b: 100 + 0.24 * p };
			check.push(t, [c, c, c]);
			causes.add(pulseCheckCause(check.getState(), true));
		}
		expect(causes.has("shown")).toBe(true);
	});
});

describe("collecting", () => {
	// The window is not yet full after a start or a reset (16 s): nothing is wrong, the check is filling it. On the
	// owner's phone (2026-10-29) 52 of 86 seconds that said "more white light" were this, read as "no rate".
	it("is named before no rate, after the blink gate", () => {
		expect(pulseCheckCause(s({ collecting: true, windowSnrDb: null, windowBpm: null }), true)).toBe("collecting");
		expect(pulseCheckCause(s({ collecting: true, waitingForBlink: true }), true)).toBe("waitingForBlink");
		expect(pulseCheckCause(s({ collecting: false, windowSnrDb: null, windowBpm: null }), true)).toBe("noRate");
	});
	it("is reported by the live check until a full window has come in since the start", () => {
		const check = new PulseCheck();
		const seen: boolean[] = [];
		for (let i = 0; i < 25 * 30; i++) {
			const t = (i * 1000) / 30;
			const p = Math.sin((2 * Math.PI * 1.2 * t) / 1000);
			const c = { r: 100 + 0.12 * p, g: 100 + 0.4 * p, b: 100 + 0.24 * p };
			check.push(t, [c, c, c]);
			if (i % 30 === 0) seen.push(check.getState().collecting === true);
		}
		expect(seen.slice(2, 14).every(Boolean)).toBe(true);
		expect(seen.slice(18).some(Boolean)).toBe(false);
	});
});

describe("pulseCheckColourDamaged", () => {
	it("is the check's own measure: the damaged-colour method, or colour damage at its switch", () => {
		expect(pulseCheckColourDamaged(s({ windowMethod: "greenMinusWall" }))).toBe(true);
		expect(pulseCheckColourDamaged(s({ windowMethod: "pos", windowColourDamage: OWN_PULSE_COLOUR_SWITCH }))).toBe(true);
		expect(pulseCheckColourDamaged(s({ windowMethod: "pos", windowColourDamage: OWN_PULSE_COLOUR_SWITCH - 1 }))).toBe(false);
		expect(pulseCheckColourDamaged(s({}))).toBe(false);
	});
});

describe("streakNeeded", () => {
	it("is the proof's 8 without moreReadings, 4 with it, and 2 while re-lock is open", () => {
		expect(streakNeeded(resolvePulseCheckRules(), false)).toBe(OWN_PULSE_STREAK);
		expect(streakNeeded(resolvePulseCheckRules(), true)).toBe(OWN_PULSE_STREAK);
		expect(streakNeeded(resolvePulseCheckRules({ moreReadings: true }), false)).toBe(OWN_PULSE_STRONG_STREAK);
		expect(streakNeeded(resolvePulseCheckRules({ moreReadings: true }), true)).toBe(RELOCK_STREAK);
	});
	it("the state says when re-lock is open: a rate proven within RELOCK_MS, moreReadings on", () => {
		const check = new PulseCheck({ rules: { moreReadings: true } });
		let open = false, lastShownT = -Infinity, openAfter = false;
		for (let i = 0; i < 70 * 30; i++) {
			const t = (i * 1000) / 30;
			const k = t > 40000 ? 0 : 0.4;
			const p = Math.sin((2 * Math.PI * 1.2 * t) / 1000);
			const c = { r: 100 + 0.3 * k * p, g: 100 + k * p, b: 100 + 0.6 * k * p };
			check.push(t, [c, c, c]);
			const st = check.getState();
			if (st.verdict === "measured" && st.bpm != null) lastShownT = t;
			if (st.relockOpen) open = true;
			if (st.relockOpen && t - lastShownT > RELOCK_MS + 2000) openAfter = true;
		}
		expect(open).toBe(true);
		expect(openAfter).toBe(false);
	});
});
