import { RELOCK_MS, RELOCK_STREAK, relockVerdict, resolvePulseCheckRules } from "../pulseCheck";
import { OWN_PULSE_AGREE_BPM } from "../pulseCheckCore";

// Rule relock (off unless true): a short streak that agrees with a rate proven moments ago is that rate again.
const notYet = (streak: number, streakBpm: number, streakSnrDb: number) =>
	({ verdict: "not-measured", bpm: null, snrDb: null, streak, path: null, streakBpm, streakSnrDb }) as const;

describe("rule relock", () => {
	it("is off unless set to true", () => {
		expect(resolvePulseCheckRules().relock).toBe(false);
		expect(resolvePulseCheckRules({ relock: true }).relock).toBe(true);
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
