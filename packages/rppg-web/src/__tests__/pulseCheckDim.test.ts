import {
	ANCHOR_DRIFT_BPM,
	FOLLOWER_MEDIAN_K,
	PULSE_CHECK_RULES_OFF_BY_DEFAULT,
	PulseCheck,
	REPROVE_DRIFT_BPM,
	TOO_DARK_SNR_DB,
	resolvePulseCheckRules,
	tooDarkToShow,
} from "../pulseCheck";
import { OWN_PULSE_AGREE_BPM, OWN_PULSE_STRONG_STREAK, type OwnPulseEstimate, ownPulseVerdict } from "../pulseCheckCore";

// Three candidate rules for dim light, each OFF unless set to true. In dim light the check is wrong far more often
// than in normal light: a weak pulse line sits near the noise, the 8 s follower jitters, and a held rate can walk.
// Their settings were fixed on generated faces before any chest-strap file existed; the strap study decides whether
// any of them goes on.

describe("the dim-light rules are off unless set", () => {
	it("leaves all three off by default and turns each on alone", () => {
		const r = resolvePulseCheckRules();
		expect([r.followerMedian, r.reproveOnDrift, r.tooDark, r.anchorDrift]).toEqual([false, false, false, false]);
		expect([...PULSE_CHECK_RULES_OFF_BY_DEFAULT].sort()).toEqual(["anchorDrift", "followerMedian", "reproveOnDrift", "tooDark"]);
		expect(resolvePulseCheckRules({ tooDark: true }).tooDark).toBe(true);
		expect(resolvePulseCheckRules({ tooDark: true }).followerMedian).toBe(false);
	});
});

/** A hand-built window, as the verdict reads it. */
const est = (bpm: number, snrDb: number): OwnPulseEstimate =>
	({ bpm, bpmFine: bpm, snrDb, agreeing: ["forehead", "leftCheek", "rightCheek"], fps: 30 }) as unknown as OwnPulseEstimate;

/**
 * Feeds windows one by one as PulseCheck does (the held rate carried from one verdict to the next) and returns the
 * verdict after each. Every fourth window has no line, so the streak never reaches 8 and only the hold keeps the rate.
 */
function walk(rates: number[], drift: boolean) {
	const history: (OwnPulseEstimate | null)[] = [];
	let held: number | null = null;
	let proven: number | null = null;
	const out: { verdict: string; bpm: number | null; path: string | null }[] = [];
	for (const r of rates) {
		history.push(Number.isNaN(r) ? null : est(r, 1));
		const v = ownPulseVerdict(history, held, drift ? { provenBpm: proven, maxBpm: REPROVE_DRIFT_BPM } : undefined);
		held = v.verdict === "measured" ? v.bpm : null;
		proven = v.verdict !== "measured" ? null : v.path === "hold" ? proven : v.bpm;
		out.push({ verdict: v.verdict, bpm: v.bpm, path: v.path });
	}
	return out;
}

describe("rule reproveOnDrift: a held rate that walks away from its proof needs a fresh one", () => {
	// Proven at 66 by 8 clean windows, then windows that step up 1.5 bpm a time with a gap every fourth window:
	// the hold follows them (each within 6 of the held rate), the streak never re-proves.
	const rates = [...Array.from({ length: 8 }, () => 66)];
	for (let k = 0; k < 40; k++) rates.push(k % 4 === 3 ? Number.NaN : 66 + 1.5 * Math.floor(k / 4) * 1);

	it("without it, the hold walks more than the agreement band from where it was proven", () => {
		const v = walk(rates, false);
		expect(v[7]).toMatchObject({ verdict: "measured", path: "proof" });
		const far = v.filter((x) => x.bpm != null && x.bpm - 66 > OWN_PULSE_AGREE_BPM + 1);
		expect(far.length).toBeGreaterThan(0);
		expect(far.every((x) => x.path === "hold")).toBe(true);
	});

	it("with it, nothing is held further than its setting from the proof", () => {
		const v = walk(rates, true);
		expect(v[7]).toMatchObject({ verdict: "measured", path: "proof" });
		for (const x of v) if (x.bpm != null && x.path === "hold") expect(Math.abs(x.bpm - 66)).toBeLessThanOrEqual(REPROVE_DRIFT_BPM);
		expect(v.some((x) => x.verdict !== "measured")).toBe(true);
	});

	it("a fresh proof at a new rate is shown, rule on or off", () => {
		const moved = [...Array.from({ length: 8 }, () => 66), ...Array.from({ length: 12 }, () => 80)];
		for (const drift of [false, true]) expect(walk(moved, drift)[19]).toMatchObject({ verdict: "measured", bpm: 80, path: "proof" });
	});
});

describe("rule tooDark: no number while the pulse line is no stronger than noise makes", () => {
	const n = OWN_PULSE_STRONG_STREAK;
	it("judges the mean SNR of the newest windows against the bar", () => {
		expect(tooDarkToShow(Array.from({ length: n }, () => TOO_DARK_SNR_DB + 0.5))).toBe(false);
		expect(tooDarkToShow(Array.from({ length: n }, () => TOO_DARK_SNR_DB - 0.5))).toBe(true);
		expect(tooDarkToShow([TOO_DARK_SNR_DB - 9, ...Array.from({ length: n }, () => TOO_DARK_SNR_DB + 0.5)])).toBe(false);
	});
	it("counts a window with no line, or too few windows, as too dark", () => {
		expect(tooDarkToShow([...Array.from({ length: n - 1 }, () => 10), null])).toBe(true);
		expect(tooDarkToShow(Array.from({ length: n - 1 }, () => 10))).toBe(true);
	});
});

/**
 * A face at `bpm`, 30 fps, three regions, colour pulse of 1% with sensor noise (as pulseCheckFollows.test.ts).
 * `onEvaluation` runs once after each of the check's one-second evaluations (a new state object).
 */
function face(check: PulseCheck, seconds: number, bpm: number, noiseAmp: number, onEvaluation: () => void) {
	let seed = 5;
	const noise = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * noiseAmp;
	const dt = 1 / 30;
	let last = check.getState();
	for (let t = 0; t <= seconds; t += dt) {
		const p = 0.01 * Math.sin(2 * Math.PI * (bpm / 60) * t);
		const region = () => ({ r: 150 * (1 - 0.3 * p) + noise(), g: 120 * (1 - p) + noise(), b: 100 * (1 - 0.6 * p) + noise() });
		check.push(t * 1000, [region(), region(), region()]);
		if (check.getState() !== last) {
			last = check.getState();
			onEvaluation();
		}
	}
}

describe("rule followerMedian: the number shown is the median of the newest follower values", () => {
	it("shows exactly the median of the last FOLLOWER_MEDIAN_K in-band follower rates", () => {
		const check = new PulseCheck({ rules: { followerMedian: true } });
		const band: number[] = [];
		let checked = 0;
		face(check, 60, 72, 6, () => {
			const s = check.getState();
			if (s.verdict !== "measured" || s.followerBpm == null) {
				if (s.verdict !== "measured") band.length = 0;
				return;
			}
			band.push(s.followerBpm);
			if (band.length > FOLLOWER_MEDIAN_K) band.shift();
			const sorted = [...band].sort((a, b) => a - b);
			const m = sorted.length % 2 ? sorted[sorted.length >> 1] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
			expect(s.bpm).toBeCloseTo(m, 6);
			checked++;
		});
		expect(checked).toBeGreaterThanOrEqual(20);
	});

	it("off, the number shown is the newest follower value itself", () => {
		const check = new PulseCheck();
		let differs = 0;
		let checked = 0;
		face(check, 60, 72, 6, () => {
			const s = check.getState();
			if (s.verdict !== "measured" || s.followerBpm == null || s.bpm == null) return;
			checked++;
			if (Math.abs(s.bpm - s.followerBpm) > 1e-9) differs++;
		});
		expect(checked).toBeGreaterThanOrEqual(20);
		expect(differs).toBe(0);
	});
});

/**
 * A dim face: 16.6 frames a second (a camera slowed for light, so the check's dark path is live), skin levels of a
 * dark room, a colour pulse of 0.5% whose rate follows `bpmAt`, uniform sensor noise of `noiseAmp` grey levels.
 * `onEvaluation` runs once after each of the check's one-second evaluations.
 */
function dimFace(check: PulseCheck, seconds: number, bpmAt: (t: number) => number, noiseAmp: number, seed0: number, onEvaluation: () => void) {
	let seed = seed0;
	const noise = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * noiseAmp;
	const dt = 1 / 16.6;
	let phi = 0;
	let last = check.getState();
	for (let t = 0; t <= seconds; t += dt) {
		phi += 2 * Math.PI * (bpmAt(t) / 60) * dt;
		const p = 0.005 * Math.sin(phi);
		const region = () => ({ r: 70 * (1 - 0.3 * p) + noise(), g: 50 * (1 - p) + noise(), b: 40 * (1 - 0.6 * p) + noise() });
		check.push(t * 1000, [region(), region(), region()]);
		if (check.getState() !== last) {
			last = check.getState();
			onEvaluation();
		}
	}
}

describe("rule reproveOnDrift in the check: a dim pulse whose rate climbs", () => {
	// 66 for 40 s, then up 0.2 bpm a second, in noise that leaves only the hold to follow it.
	const climb = (t: number) => (t < 40 ? 66 : 66 + 0.2 * (t - 40));
	const maxDrift = (rules: { reproveOnDrift?: boolean }) => {
		const check = new PulseCheck({ rules });
		let most = 0;
		dimFace(check, 120, climb, 1.8, 7, () => {
			const s = check.getState();
			if (s.heldBpm != null && s.provenBpm != null) most = Math.max(most, Math.abs(s.heldBpm - s.provenBpm));
		});
		return most;
	};
	it("without it, the held rate moves past the agreement band from its last proof", () => {
		expect(maxDrift({})).toBeGreaterThan(REPROVE_DRIFT_BPM);
	});
	it("with it, the held rate never sits further than REPROVE_DRIFT_BPM from its last proof", () => {
		expect(maxDrift({ reproveOnDrift: true })).toBeLessThanOrEqual(REPROVE_DRIFT_BPM);
	});
});

describe("rule tooDark in the check: a dim pulse near the noise", () => {
	// Three noise seeds pooled: whether a given second sits just above or below the bar is chaotic in the noise.
	const run = (rules: { tooDark?: boolean }) => {
		let shown = 0;
		let withheld = 0;
		let shownWhileDark = 0;
		for (const seed of [1, 2, 3]) {
		const check = new PulseCheck({ rules });
		const snrs: (number | null)[] = [];
		dimFace(check, 90, () => 72, 1.4, seed, () => {
			const s = check.getState();
			snrs.push(s.windowBpm != null ? (s.windowSnrDb ?? null) : null);
			if (s.bpm != null) {
				shown++;
				if (tooDarkToShow(snrs)) shownWhileDark++;
			}
			if (s.tooDark) {
				withheld++;
				expect(s.bpm).toBeNull();
				expect(s.verdict).toBe("not-measured");
			}
		});
		}
		return { shown, withheld, shownWhileDark };
	};
	it("without it, the rate shows in seconds whose newest windows are no stronger than noise", () => {
		const off = run({});
		expect(off.withheld).toBe(0);
		expect(off.shownWhileDark).toBeGreaterThan(0);
	});
	it("with it, no rate shows in those seconds, and the state says why", () => {
		const on = run({ tooDark: true });
		expect(on.shownWhileDark).toBe(0);
		expect(on.withheld).toBeGreaterThan(0);
		expect(on.shown).toBeGreaterThan(0);
	});
});

describe("rule anchorDrift in the check: a run of measured seconds stays near where it was proven", () => {
	// The same climbing dim pulse: 66 for 40 s, then up 0.2 bpm a second to 82.
	const climb = (t: number) => (t < 40 ? 66 : 66 + 0.2 * (t - 40));
	const run = (rules: { anchorDrift?: boolean }) => {
		const check = new PulseCheck({ rules });
		let most = 0;
		let ended = 0;
		dimFace(check, 120, climb, 1.0, 5, () => {
			const s = check.getState();
			if (s.anchorEnded) {
				ended++;
				expect(s.bpm).toBeNull();
				expect(s.streak).toBe(0);
			}
			if (s.heldBpm != null && s.anchorBpm != null) most = Math.max(most, Math.abs(s.heldBpm - s.anchorBpm));
		});
		return { most, ended };
	};
	it("without it, one run carries the rate further than the agreement band from where it started", () => {
		const off = run({});
		expect(off.most).toBeGreaterThan(ANCHOR_DRIFT_BPM);
		expect(off.ended).toBe(0);
	});
	it("with it, the run ends at the band and the evidence starts over", () => {
		const on = run({ anchorDrift: true });
		expect(on.most).toBeLessThanOrEqual(ANCHOR_DRIFT_BPM);
		expect(on.ended).toBeGreaterThan(0);
	});
});
