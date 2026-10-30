import { FOLLOW_BPM, FOLLOW_MIN_SNR_DB, FOLLOW_MS, followRate, resolvePulseCheckRules, shownPulseBpm } from "../pulseCheck";

// Rule followRecent (off unless true): while nothing shows, a window rate close to a number shown moments ago is shown.
describe("rule followRecent", () => {
	it("is off unless set to true", () => {
		expect(resolvePulseCheckRules().followRecent).toBe(false);
		expect(resolvePulseCheckRules({ followRecent: true }).followRecent).toBe(true);
	});
	it("follows a window within FOLLOW_BPM of a number shown within FOLLOW_MS, at FOLLOW_MIN_SNR_DB or more", () => {
		expect([FOLLOW_BPM, FOLLOW_MS, FOLLOW_MIN_SNR_DB]).toEqual([6, 30_000, -5]);
		expect(followRate({ bpm: 64, t: 0 }, FOLLOW_MS, 64 + FOLLOW_BPM, FOLLOW_MIN_SNR_DB, false)).toBe(70);
		expect(followRate({ bpm: 64, t: 0 }, 1000, 62, -1, false)).toBe(62);
	});
	it("not too far, not too late, not too weak, never with no number before, never when withheld", () => {
		expect(followRate({ bpm: 64, t: 0 }, 1000, 64 + FOLLOW_BPM + 0.5, 0, false)).toBeNull();
		expect(followRate({ bpm: 64, t: 0 }, FOLLOW_MS + 1, 64, 0, false)).toBeNull();
		expect(followRate({ bpm: 64, t: 0 }, 1000, 64, FOLLOW_MIN_SNR_DB - 0.1, false)).toBeNull();
		expect(followRate(null, 1000, 64, 0, false)).toBeNull();
		expect(followRate({ bpm: 64, t: 0 }, 1000, 64, 0, true)).toBeNull();
		expect(followRate({ bpm: 64, t: 0 }, 1000, null, 0, false)).toBeNull();
	});
	it("is what the check shows when neither a proof nor a building rate is there", () => {
		expect(shownPulseBpm({ verdict: "not-measured", bpm: null, buildingBpm: null, followBpm: 65 })).toBe(65);
		expect(shownPulseBpm({ verdict: "not-measured", bpm: null, buildingBpm: 70, followBpm: 65 })).toBe(70);
		expect(shownPulseBpm({ verdict: "measured", bpm: 72, buildingBpm: null, followBpm: 65 })).toBe(72);
	});
});

describe("rule followRecent on a check", () => {
	it("shows more seconds than the check without it on the same pushes, and none before a first number", async () => {
		const { PulseCheck } = await import("../pulseCheck");
		// A clean 66 bpm pulse, then 20 s of a weaker, slightly wandering one: proof first, then windows too noisy for a
		// streak but close to the shown number.
		const run = (followRecent: boolean) => {
			const c = new PulseCheck({ rules: { moreReadings: true, followRecent } }); let shown = 0, before = 0, seed = 7;
			const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5);
			for (let i = 0; i < 30 * 60; i++) {
				const t = i * (1000 / 30), s = t / 1000; const late = s > 40;
				const p = Math.sin(2 * Math.PI * (66 + (late ? 2 * Math.sin(s / 3) : 0)) / 60 * s) * (late ? 0.002 : 0.004) + rnd() * (late ? 0.012 : 0.004);
				const px = { r: 0.6 - p * 0.3, g: 0.4 + p, b: 0.35 - p * 0.2 }; c.push(t, [px, px, px]); const st = c.getState();
				if (i % 30 === 0) { const b = shownPulseBpm(st); if (b != null) { shown++; if (st.followBpm != null && st.bpm == null && st.buildingBpm == null && shown === 1) before++; } }
			}
			return { shown, before };
		};
		const off = run(false), on = run(true);
		expect(on.before).toBe(0);
		expect(on.shown).toBeGreaterThan(off.shown);
	});
});
