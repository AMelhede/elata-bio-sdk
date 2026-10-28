import { RELOCK_MS, RELOCK_STREAK, relockVerdict, resolvePulseCheckRules } from "../pulseCheck";
import { OWN_PULSE_AGREE_BPM } from "../pulseCheckCore";

// Rule relock (off unless true): a short streak that agrees with a rate proven moments ago is that rate again.
const notYet = (streak: number, streakBpm: number, streakSnrDb: number) =>
	({ verdict: "not-measured", bpm: null, snrDb: null, streak, path: null, streakBpm, streakSnrDb }) as const;

describe("rule moreReadings (re-lock)", () => {
	it("is off unless set to true", () => {
		expect(resolvePulseCheckRules().moreReadings).toBe(false);
		expect(resolvePulseCheckRules({ moreReadings: true }).moreReadings).toBe(true);
	});
	it("returns to a rate proven within RELOCK_MS when the streak agrees", () => {
		const v = relockVerdict(notYet(RELOCK_STREAK, 66, -2), { bpm: 64, t: 0 }, RELOCK_MS);
		expect(v.verdict).toBe("measured");
		expect(v.bpm).toBe(66);
		expect(v.path).toBe("relock");
	});
	it("not too long after, not on a different rate, not on a shorter or weaker streak, never without a proof", () => {
		expect(relockVerdict(notYet(RELOCK_STREAK, 66, -2), { bpm: 64, t: 0 }, RELOCK_MS + 1).verdict).toBe("not-measured");
		expect(relockVerdict(notYet(RELOCK_STREAK, 64 + OWN_PULSE_AGREE_BPM + 1, -2), { bpm: 64, t: 0 }, 1000).verdict).toBe("not-measured");
		expect(relockVerdict(notYet(RELOCK_STREAK - 1, 66, -2), { bpm: 64, t: 0 }, 1000).verdict).toBe("not-measured");
		expect(relockVerdict(notYet(RELOCK_STREAK, 66, -3.5), { bpm: 64, t: 0 }, 1000).verdict).toBe("not-measured");
		expect(relockVerdict(notYet(RELOCK_STREAK, 66, -2), null, 1000).verdict).toBe("not-measured");
	});
});

describe("recordings that name the two halves of moreReadings", () => {
	it("replay with moreReadings when they ran both showBuilding and relock, and without it otherwise", async () => {
		const { RecordingPulseCheck, replayPulseCheck } = await import("../pulseCheckRecording");
		const { shownPulseBpm } = await import("../pulseCheck");
		const shown = (x: ReturnType<typeof replayPulseCheck>) => x.evaluations.map((e) => shownPulseBpm(e.state));
		const rec = new RecordingPulseCheck({ rules: { moreReadings: true } });
		// A faint pulse in noise, with a break, so the check re-locks or builds: there moreReadings changes what shows.
		let seed = 11;
		const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5;
		for (let i = 0; i < 1800; i++) {
			const t = i * 33.3;
			const p = Math.sin((2 * Math.PI * 1.2 * t) / 1000);
			const c = (k: number) => ({ r: 100 + 0.3 * k * p + 0.5 * rnd(), g: 100 + k * p + 0.5 * rnd(), b: 100 + 0.6 * k * p + 0.5 * rnd() });
			const k = i > 900 && i < 1050 ? 0 : 0.4; // a 5 s stretch with no pulse breaks the proof
			rec.push(t, [c(k), c(k), c(k)], undefined, undefined, { x: 320, y: 240, faceWidth: 140 });
		}
		const r = rec.getRecording();
		const { moreReadings: _drop, ...older } = r.rules as Record<string, boolean>;
		const both = shown(replayPulseCheck({ ...r, rules: { ...older, showBuilding: true, relock: true } as never }));
		const one = shown(replayPulseCheck({ ...r, rules: { ...older, showBuilding: true } as never }));
		const own = shown(replayPulseCheck(r));
		expect(own.some((b) => b != null)).toBe(true);
		const off = shown(replayPulseCheck(r, { rules: { moreReadings: false } }));
		expect(off).not.toEqual(own);
		expect(both).toEqual(own);
		expect(shown(replayPulseCheck({ ...r, rules: { ...older } as never }, { rules: { moreReadings: false } }))).toEqual(one);
	});
});
