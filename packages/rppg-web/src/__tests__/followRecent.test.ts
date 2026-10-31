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

describe("rule followRecent across a break (the page left for the watch app)", () => {
	// A clean 66 bpm pulse for 40 s, a 26 s break with no frames (the check resets), then the same pulse again. Without
	// the refill branch nothing shows until a full window is in (16 s); with it, a number near 66 shows from about 6 s,
	// only while the number before the break is at most FOLLOW_RESUME_MS old, and never without that number.
	const run = (opts: { followRecent: boolean; breakS?: number; resumeBpm?: number; blinkGate?: boolean; blink?: boolean }) => {
		return import("../pulseCheck").then(({ PulseCheck }) => {
			const c = new PulseCheck({ rules: { moreReadings: true, followRecent: opts.followRecent, blinkGate: opts.blinkGate ?? false } });
			let seed = 11; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5);
			const breakS = opts.breakS ?? 26, after: (number | null)[] = [];
			const push = (s: number, bpm: number, blink: number | null) => {
				const p = Math.sin(2 * Math.PI * bpm / 60 * s) * 0.004 + rnd() * 0.004;
				const px = { r: 0.6 - p * 0.3, g: 0.4 + p, b: 0.35 - p * 0.2 };
				c.push(s * 1000, [px, px, px], undefined, undefined, blink == null ? undefined : { x: 100, y: 100, faceWidth: 100, blink });
			};
			for (let i = 0; i < 30 * 40; i++) push(i / 30, 66, opts.blinkGate ? (i % 90 < 4 ? 0.8 : 0.1) : null);
			const back = 40 + breakS;
			for (let i = 0; i < 30 * 15; i++) { const s = back + i / 30; push(s, opts.resumeBpm ?? 66, opts.blinkGate ? (opts.blink && i % 90 < 4 && i > 30 ? 0.8 : 0.1) : null); if (i % 30 === 0) after.push(shownPulseBpm(c.getState())); }
			return after; // one per second of the first 15 s back
		});
	};
	it("shows the same heart again within about 6 s of coming back", async () => {
		const off = await run({ followRecent: false }), on = await run({ followRecent: true });
		expect(off.slice(0, 14).every((b) => b == null)).toBe(true);
		const firstOn = on.findIndex((b) => b != null);
		expect(firstOn).toBeGreaterThanOrEqual(5);
		expect(firstOn).toBeLessThanOrEqual(9);
		expect(Math.abs((on[firstOn] as number) - 66)).toBeLessThanOrEqual(6); // FOLLOW_BPM: a 6 s window resolves about 10 bpm
	});
	it("not after a break longer than FOLLOW_RESUME_MS, and not for a different rate", async () => {
		const { FOLLOW_RESUME_MS } = await import("../pulseCheck");
		expect(FOLLOW_RESUME_MS).toBe(45_000);
		expect((await run({ followRecent: true, breakS: 60 })).slice(0, 14).every((b) => b == null)).toBe(true);
		expect((await run({ followRecent: true, resumeBpm: 80 })).slice(0, 14).every((b) => b == null)).toBe(true);
	});
	it("with the blink gate on, only after a blink since coming back", async () => {
		expect((await run({ followRecent: true, blinkGate: true, blink: false })).slice(0, 14).every((b) => b == null)).toBe(true);
		expect((await run({ followRecent: true, blinkGate: true, blink: true })).slice(0, 14).some((b) => b != null)).toBe(true);
	});
});
