import { DemoRunner } from "../demoRunner";
import type { Frame, FrameSource } from "../frameSource";
import {
	HEAD_LANDMARKS,
	HEAD_MIN_SIZE,
	HEAD_MIN_SNR_DB,
	type HeadRow,
	PulseCheck,
	type PulseCheckRules,
	headAtRate,
	headCarries,
	headCentre,
	headJudge,
	headMatches,
} from "../pulseCheck";
import { OWN_PULSE_STREAK } from "../pulseCheckCore";

// Jest provides require; this package's tests carry no Node type declarations.
declare const require: (id: string) => unknown;

// Rule headMotion: a rate the head's own movement keeps time with is the movement's, not a pulse.
// Fixtures recorded by Peak on its fake camera from generated faces (no person in them):
// nod60-nopulse, NO pulse with the head nodding 3 px at 60 a minute (Peak read 60 on it before the
// same rule); nod90-pulse70, a pulse at 70 under a nod at 90 (Peak read 70). Each motion row is
// [t, x, y] of the nine bone landmarks in `motionLandmarks` order (HEAD_LANDMARKS), in pixels of a
// 640x480 camera.
//
// The statistic is Peak's rebuilt movement rule (Peak docs/ACCURACY.md section 10k, 2026-10-08):
// judged AT the rate claimed, by dominance (the line and its second harmonic over the rest of the
// head's movement, the strongest OTHER rhythm taken out) and by size (the line's amplitude over the
// face's width), on a fixed 16 s grid, and only where the head's rows cover the window.
type Fx = { rawRois: number[][]; motion: number[][]; background: number[][]; motionLandmarks: number[] };
const nod = require("./fixtures/nod60-nopulse.json") as Fx;
const pulse = require("./fixtures/nod90-pulse70.json") as Fx;

/** What headCentre would hand the check for one motion row: the landmarks' centre and the cheekbones' distance. */
function headOfRow(fx: Fx, row: number[]): { x: number; y: number; faceWidth: number } {
	let x = 0;
	let y = 0;
	const n = (row.length - 1) / 2;
	for (let i = 1; i + 1 < row.length; i += 2) {
		x += row[i];
		y += row[i + 1];
	}
	const l = 1 + 2 * fx.motionLandmarks.indexOf(234);
	const r = 1 + 2 * fx.motionLandmarks.indexOf(454);
	return { x: x / n, y: y / n, faceWidth: Math.hypot(row[r] - row[l], row[r + 1] - row[l + 1]) };
}

/** The head at frame time `t`, if the fixture recorded a mesh row within 200 ms before it; null (no head this frame) otherwise. */
function fixtureHead(fx: Fx, t: number, m: { i: number }): { x: number; y: number; faceWidth: number } | null {
	while (m.i + 1 < fx.motion.length && fx.motion[m.i + 1][0] <= t) m.i++;
	const row = fx.motion[m.i];
	if (!row || row[0] > t || t - row[0] >= 200) return null;
	return headOfRow(fx, row);
}

/**
 * Replays a fixture through a check, giving its state to `each` once a second. `second`: the SDK's
 * own rate, handed each second to the check's opt-in agreement path. `check`: replay into this one.
 */
function replay(
	fx: Fx,
	opts: { rules?: PulseCheckRules; agreement?: boolean; second?: number; check?: PulseCheck },
	each: (state: ReturnType<PulseCheck["getState"]>) => void,
): void {
	const check = opts.check ?? new PulseCheck({ rules: opts.rules, agreement: opts.agreement });
	const wallAt = new Map(fx.background.map((w) => [w[0], w]));
	const m = { i: 0 };
	let next = fx.rawRois[0][0] + 1000;
	for (const r of fx.rawRois) {
		const w = wallAt.get(r[0]);
		check.push(
			r[0],
			[
				{ r: r[1], g: r[2], b: r[3] },
				{ r: r[4], g: r[5], b: r[6] },
				{ r: r[7], g: r[8], b: r[9] },
			],
			w ? { r: w[1], g: w[2], b: w[3] } : undefined,
			undefined,
			fixtureHead(fx, r[0], m),
		);
		if (r[0] >= next) {
			if (opts.second != null) check.secondOpinion(opts.second);
			each(check.getState());
			next += 1000;
		}
	}
}

/** Rates shown, once a second, replaying a fixture through a check with these rules. */
function shown(fx: Fx, rules: PulseCheckRules, extra: { agreement?: boolean; second?: number } = {}): number[] {
	const out: number[] = [];
	replay(fx, { rules, ...extra }, (s) => {
		if (s.bpm != null) out.push(s.bpm);
	});
	return out;
}

/** The fixture with its head rows changed (the colour, and the frames, unchanged). */
const withMotion = (fx: Fx, motion: number[][]): Fx => ({ ...fx, motion });

/** The synthetic face's width (px), cheekbone to cheekbone: about the nod fixtures' 192 to 201. */
const FACE_PX = 190;

/**
 * A head as the face mesh reports it, handed over as headCentre does ([t, x, y, faceWidth]): nine
 * bone landmarks, the cheekbones FACE_PX apart, moving together by sinusoidal movements (each from
 * `from` and until `until` seconds, if given), plus a random-walk drift and independent jitter on
 * every landmark (px), `fps` rows a second. The same generator as Peak's own tests of the rule
 * (seeded alike), so the numbers below are the ones the bars were set against.
 */
function headRows(
	seconds: number,
	moves: Array<{ px: number; bpm: number; axis?: "x" | "y"; from?: number; until?: number }>,
	jitter: number,
	o: { seed?: number; fps?: number } = {},
): HeadRow[] {
	let s = o.seed ?? 5;
	const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647 - 0.5) * 2;
	let drift = 0;
	const out: HeadRow[] = [];
	for (let t = 0; t <= seconds * 1000; t += 1000 / (o.fps ?? 15)) {
		drift += rnd() * jitter;
		let dx = 0;
		let dy = 0;
		for (const m of moves) {
			if ((m.until != null && t > m.until * 1000) || (m.from != null && t < m.from * 1000)) continue;
			const v = m.px * Math.sin((2 * Math.PI * m.bpm * t) / 60000);
			if (m.axis === "x") dx += v;
			else dy += v;
		}
		const xs: number[] = [];
		const ys: number[] = [];
		for (let i = 0; i < 9; i++) {
			const x0 = i === 7 ? 300 - FACE_PX / 2 : i === 8 ? 300 + FACE_PX / 2 : 300 + (i - 4) * 10;
			xs.push(x0 + dx + drift + rnd() * jitter);
			ys.push(200 + i * 5 + dy + drift + rnd() * jitter);
		}
		const mean = (a: number[]) => a.reduce((p, v) => p + v, 0) / a.length;
		out.push([t, mean(xs), mean(ys), Math.hypot(xs[8] - xs[7], ys[8] - ys[7])]);
	}
	return out;
}

/** The movement at the rate on the axis that carries most of it. */
function atRate(rows: readonly HeadRow[], atMs: number, bpm: number) {
	const m = headAtRate(rows, atMs, bpm);
	if ("blind" in m) throw new Error(`blind: ${m.blind}`);
	return m.axes.reduce((a, b) => (b.size > a.size ? b : a));
}

type Head = { x: number; y: number; faceWidth: number };

/**
 * A face whose three regions carry a clean chromatic pulse at `bpm` (green dips most, 1%), 30 frames
 * a second from `from` ms, pushed into `check` with the head `headAt(t)` gives (left out of push
 * when it gives undefined). Returns the state once a second.
 */
function pushPulse(
	check: PulseCheck,
	o: { seconds: number; bpm: number; from?: number; second?: number },
	headAt: (t: number) => Head | null | undefined,
): Array<ReturnType<PulseCheck["getState"]>> {
	let s = 11;
	const noise = () => ((s = (s * 16807) % 2147483647) / 2147483647 - 0.5) * 0.4;
	const from = o.from ?? 0;
	const out: Array<ReturnType<PulseCheck["getState"]>> = [];
	let next = from + 1000;
	for (let t = from; t <= from + o.seconds * 1000; t += 1000 / 30) {
		const p = 0.01 * Math.sin((2 * Math.PI * o.bpm * t) / 60000);
		const region = () => ({ r: 150 * (1 - 0.3 * p) + noise(), g: 120 * (1 - p) + noise(), b: 100 * (1 - 0.6 * p) + noise() });
		const head = headAt(t);
		if (head === undefined) check.push(t, [region(), region(), region()]);
		else check.push(t, [region(), region(), region()], undefined, undefined, head);
		if (t >= next) {
			if (o.second != null) check.secondOpinion(o.second);
			out.push(check.getState());
			next += 1000;
		}
	}
	return out;
}

/** The head of `rows` at time t (the newest row at or before it), as headCentre hands it over. */
function rowAt(rows: readonly HeadRow[]): (t: number) => Head {
	let i = 0;
	return (t) => {
		while (i + 1 < rows.length && rows[i + 1][0] <= t) i++;
		const r = rows[i];
		return { x: r[1], y: r[2], faceWidth: r[3] };
	};
}

describe("PulseCheck rule headMotion", () => {
	it("a nod with no pulse shows a false 60 with the rule off", () => {
		const s = shown(nod, { headMotion: false });
		expect(s.length).toBeGreaterThan(0);
		expect(s.every((b) => Math.abs(b - 60) <= 4)).toBe(true);
	});

	it("and nothing with it on", () => {
		expect(shown(nod, {})).toEqual([]);
	});

	it("keeps a real pulse at 70 under a nod at 90, and never shows the nod's rate", () => {
		const s = shown(pulse, {});
		expect(s.length).toBeGreaterThan(0);
		expect(s.every((b) => Math.abs(b - 70) <= 4)).toBe(true);
	});

	// The finding this statistic fixes: the one before counted every other rhythm of the head as
	// noise, so a smaller second rhythm hid a nod. A 1.5 px sway at 50 a minute added to the nod
	// fixture's rows brought its false 60 back (19 seconds of 59 to 60 shown by 0.15.0-test.5).
	it("nothing either when a smaller sway rides along with the nod", () => {
		const swayed = nod.motion.map((r) =>
			r.map((v, i) => (i > 0 && i % 2 === 0 ? v + 1.5 * Math.sin((2 * Math.PI * 50 * r[0]) / 60000) : v)),
		);
		expect(shown(withMotion(nod, swayed), { headMotion: false }).length).toBeGreaterThan(0);
		expect(shown(withMotion(nod, swayed), {})).toEqual([]);
	});

	// Fail-closed: once the caller hands the check heads, a window the head's rows do not cover is
	// blind, and a blind window is not evidence. Counted as evidence, the nod's colour proves its 60
	// while the mesh is not looking (0.15.0-test.5 showed it 6 seconds with the rows cut from 16 to
	// 22 s, 17 seconds with the mesh finding the face only 24 s in).
	it("nothing either when the face mesh misses the face for 6 s while the colour carries on", () => {
		const judged: Array<string | null | undefined> = [];
		const out: number[] = [];
		replay(withMotion(nod, nod.motion.filter((r) => r[0] < 16000 || r[0] > 22000)), {}, (s) => {
			judged.push(s.windowHead);
			if (s.bpm != null) out.push(s.bpm);
		});
		expect(out).toEqual([]);
		expect(judged).toContain("blind");
		expect(judged).toContain("carried");
	});

	it("nothing either when the face mesh finds the face only 24 s in", () => {
		expect(shown(withMotion(nod, nod.motion.filter((r) => r[0] >= 24000)), {})).toEqual([]);
	});

	it("a caller that never hands the check a head is not judged on movement: the rule cannot run", () => {
		const states = pushPulse(new PulseCheck(), { seconds: 40, bpm: 70 }, () => undefined);
		expect(states.every((s) => s.windowHead == null)).toBe(true);
		const after = states.slice(19).map((s) => s.bpm);
		expect(after.length).toBeGreaterThan(15);
		expect(after.every((b) => b != null && Math.abs(b - 70) <= 4)).toBe(true);
	});

	// The rule's first half: a window whose rate the head carries is not evidence. Counted, the nod
	// builds a streak (to 20 on this fixture with the rule off), and its rate would show the first
	// second the head's line dipped under the bar.
	it("counts no second of the nod as evidence: the streak never starts", () => {
		const streaks = (rules: PulseCheckRules) => {
			const out: number[] = [];
			replay(nod, { rules }, (s) => out.push(s.streak));
			return out;
		};
		expect(Math.max(...streaks({ headMotion: false }))).toBeGreaterThanOrEqual(OWN_PULSE_STREAK);
		expect(Math.max(...streaks({}))).toBe(0);
	});

	// The rule's second half: a rate the head has carried for 4 windows is withheld, however it was
	// reached. The streak cannot reach it here (the first half), but the opt-in agreement path does:
	// the SDK's own rate (60 on a nod, the strongest rhythm in the colour) agrees with the check's
	// window rate for 8 seconds from 23 s, and only the withhold keeps it off the screen.
	it("withholds the nod's rate when the agreement path reaches it", () => {
		const agreeing = { agreement: true, second: 60 };
		let withheld = 0;
		replay(nod, agreeing, (s) => {
			if (s.headMatch) withheld++;
		});
		expect(withheld).toBeGreaterThan(10);
		expect(shown(nod, {}, agreeing)).toEqual([]);
	});
});

// The bars. Measured on real pulses (recorded captures with a reference pulse, and people from a
// public rPPG set filmed through Peak, every second within 5 bpm of truth) against no-pulse nods
// filmed through Peak and nods with a second sway, per axis, every covered window:
// - a real head's movement at the rate that dominated (2.5 dB and up) was at most 0.13% of the
//   face's width (the heartbeat's own shake); the nods moved 0.69% and more;
// - a real head that moved 0.3% or more at the rate was at most 2.4 dB dominant (fidgeting); the
//   nods stood 5.4 dB and more above the rest, 8.5 dB with a sway.
// Re-measured 2026-10-08 through this package's headAtRate on the same rows, each handed over as
// headCentre gives it (centre and cheekbone distance): every window judged exactly as by Peak's
// statistic, the same gap (2.37 to 5.36 dB, 0.13% to 0.69%), so the same bars, 3.9 dB and 0.3%.
// At both bars no real-pulse window was carried and every nod window was.
// The gap bar (HEAD_MAX_GAP_MS, 1 s), measured on the same nod and real-pulse windows with rows cut
// out: with a 1 s gap the statistic still finds 99.7% of nod windows (2 s: 92.4%, 3 s: 78.9%), and
// no real-pulse window was carried with gaps up to 3 s.
// Until 0.15.0-test.7 these numbers were also in the constants' comments in pulseCheck.ts, which
// ship in dist; they are kept here, where nothing ships (releaseScrub.test.ts).
describe("headAtRate: the movement at the rate, by dominance and size", () => {
	it("sees a steady nod at its own rate, and only there", () => {
		const r = headRows(20, [{ px: 2, bpm: 60 }], 0.3);
		expect(headCarries(r, 20000, 60)).toBe(true);
		expect(headCarries(r, 20000, 80)).toBe(false);
	});

	it("sees a rock from side to side the same as a nod", () => {
		expect(headCarries(headRows(20, [{ px: 2, bpm: 72, axis: "x" }], 0.3), 20000, 72)).toBe(true);
	});

	it("still sees the nod when a smaller sway rides along at another rate", () => {
		// With every other rhythm counted as noise (0.15.0-test.5), a 2 px sway at 50 hid a 3 px nod at 72.
		expect(headCarries(headRows(20, [{ px: 3, bpm: 72 }, { px: 2, bpm: 50 }], 0.3), 20000, 72)).toBe(true);
		expect(
			headCarries(headRows(20, [{ px: 3, bpm: 72, axis: "x" }, { px: 2, bpm: 50, axis: "x" }], 0.3), 20000, 72),
		).toBe(true);
	});

	it("carries the weakest nod it was measured on: 1 px with fidgeting, about 6 dB", () => {
		const r = headRows(20, [{ px: 1, bpm: 70 }], 1.0);
		const line = atRate(r, 20000, 70);
		expect(line.snrDb).toBeGreaterThan(HEAD_MIN_SNR_DB);
		expect(line.snrDb).toBeLessThan(HEAD_MIN_SNR_DB + 3);
		expect(line.size).toBeGreaterThan(HEAD_MIN_SIZE);
		expect(headCarries(r, 20000, 70)).toBe(true);
	});

	it("puts the dominance bar in the middle of the measured gap (2.4 to 5.4 dB), not at either side", () => {
		// Two movements at the rate as large as a nod (0.7% of the face's width), one 4.4 dB above the
		// rest of the head's movement and one 3.2 dB: the bar sits between them, within 0.6 dB of the middle.
		const above = atRate(headRows(20, [{ px: 1, bpm: 70 }], 1.3), 20000, 70);
		const below = atRate(headRows(20, [{ px: 1, bpm: 70 }], 1.6), 20000, 70);
		expect(above.snrDb).toBeGreaterThan(4.3);
		expect(above.snrDb).toBeLessThan(4.5);
		expect(below.snrDb).toBeGreaterThan(3.1);
		expect(below.snrDb).toBeLessThan(3.3);
		expect(Math.min(above.size, below.size)).toBeGreaterThan(2 * HEAD_MIN_SIZE);
		expect(headCarries(headRows(20, [{ px: 1, bpm: 70 }], 1.3), 20000, 70)).toBe(true);
		expect(headCarries(headRows(20, [{ px: 1, bpm: 70 }], 1.6), 20000, 70)).toBe(false);
	});

	it("puts the size bar in the middle of the measured gap (0.13% to 0.69% of the face's width), not at either side", () => {
		// Two movements at the rate that dominate the head's movement, one 0.46% of the face's width
		// and one 0.20%: the bar sits between them, within a factor of 1.5 of the middle (0.3%).
		const larger = atRate(headRows(20, [{ px: 0.9, bpm: 70 }], 0.01), 20000, 70);
		const smaller = atRate(headRows(20, [{ px: 0.4, bpm: 70 }], 0.01), 20000, 70);
		expect(larger.size).toBeGreaterThan(0.0045);
		expect(larger.size).toBeLessThan(0.0047);
		expect(smaller.size).toBeGreaterThan(0.0019);
		expect(smaller.size).toBeLessThan(0.0021);
		expect(Math.min(larger.snrDb, smaller.snrDb)).toBeGreaterThan(HEAD_MIN_SNR_DB + 10);
		expect(headCarries(headRows(20, [{ px: 0.9, bpm: 70 }], 0.01), 20000, 70)).toBe(true);
		expect(headCarries(headRows(20, [{ px: 0.4, bpm: 70 }], 0.01), 20000, 70)).toBe(false);
	});

	it("leaves a heartbeat's own shake alone: the head's strongest rhythm, but tiny", () => {
		const r = headRows(20, [{ px: 0.15, bpm: 70 }], 0.01);
		const line = atRate(r, 20000, 70);
		expect(line.snrDb).toBeGreaterThan(HEAD_MIN_SNR_DB);
		expect(line.size).toBeLessThan(HEAD_MIN_SIZE);
		expect(headCarries(r, 20000, 70)).toBe(false);
	});

	it("leaves fidgeting at the rate alone: as large as a nod there, but buried in movement at other rates", () => {
		const r = headRows(20, [{ px: 1, bpm: 70 }], 2.0);
		const line = atRate(r, 20000, 70);
		expect(line.size).toBeGreaterThan(HEAD_MIN_SIZE);
		expect(line.snrDb).toBeGreaterThan(0);
		expect(line.snrDb).toBeLessThan(HEAD_MIN_SNR_DB);
		expect(headCarries(r, 20000, 70)).toBe(false);
	});

	it("the size is the line's amplitude over the face's width", () => {
		// A clean 3 px nod on a 190 px face: 1.6% of its width, read a little under (the 1.5 s detrend
		// and the interpolation from 15 rows a second each take a few percent of a 1 Hz line: 0.94 of it).
		const clean = headRows(20, [{ px: 3, bpm: 60 }], 0.01);
		const size = atRate(clean, 20000, 60).size;
		expect(size / (3 / FACE_PX)).toBeGreaterThan(0.9);
		expect(size / (3 / FACE_PX)).toBeLessThan(1);
		// The same nod on a face twice as wide: half the size.
		const wide = clean.map(([t, x, y, w]): HeadRow => [t, x, y, 2 * w]);
		expect(atRate(wide, 20000, 60).size / size).toBeCloseTo(0.5, 9);
	});

	it("does not take a slow movement below the band for a rate at its floor", () => {
		// A 3 px movement at 40 a minute: its skirt runs into the band floor (42), and a strongest-line
		// rule with no local maximum withheld real pulses up to 51 a minute.
		const r = headRows(20, [{ px: 3, bpm: 40 }], 0.3);
		for (const bpm of [42, 45, 48, 51]) {
			expect(headCarries(r, 20000, bpm)).toBe(false);
			expect(headMatches(r, 20000, bpm)).toBe(false);
		}
	});

	it("a nod carries its own rate, within 6 a minute, and no other", () => {
		const r = headRows(20, [{ px: 3, bpm: 60 }], 0.3);
		expect(headCarries(r, 20000, 66)).toBe(true);
		expect(headCarries(r, 20000, 67)).toBe(false);
		expect(headCarries(r, 20000, 90)).toBe(false);
	});
});

describe("headJudge: a window the head's rows do not cover is blind, never clear", () => {
	it("judges nothing it cannot see, and says why", () => {
		const r = headRows(20, [{ px: 3, bpm: 60 }], 0.3);
		expect(headJudge(r, 20000, 60)).toBe("carried");
		expect(headJudge(headRows(20, [], 0.3), 20000, 60)).toBe("clear");
		const why = (rows: HeadRow[], bpm = 60) => {
			const m = headAtRate(rows, 20000, bpm);
			return "blind" in m ? m.blind : "seen";
		};
		expect(why(r)).toBe("seen");
		expect(why(r.filter((_, i) => i % 10 === 0))).toBe("rows"); // 1.5 rows a second
		expect(why(r.filter((x) => x[0] < 8000 || x[0] > 9500))).toBe("gap"); // a 1.5 s gap
		expect(why(r.filter((x) => x[0] < 18500))).toBe("end"); // stops 1.5 s early
		expect(why(r.filter((x) => x[0] > 5500))).toBe("start"); // starts 1.5 s late
		// A row without a usable face width is no row (headCentre always gives one).
		expect(why(r.map(([t, x, y]): HeadRow => [t, x, y, Number.NaN]))).toBe("rows");
		// 3.2 rows a second: enough for a nod at 60, too few for one at 90 (2.5 rows a cycle).
		expect(headJudge(headRows(20, [{ px: 3, bpm: 60 }], 0.3, { fps: 3.2 }), 20000, 60)).toBe("carried");
		expect(why(headRows(20, [{ px: 3, bpm: 90 }], 0.3, { fps: 3.2 }), 90)).toBe("rate");
		expect(headCarries([], 20000, 60)).toBe(false);
		expect(headJudge([], 20000, 60)).toBe("blind");
	});
});

// The withhold judges the last 4 one-second windows at once: a nod that has just begun, carried by
// the newest three windows but not yet the oldest, is not withheld until the oldest carries it too.
describe("headMatches: the head carried the rate in each of the last 4 windows", () => {
	// Still for 20 s, then a 3 px nod at 60 a minute. The window from which every later one carries
	// the nod (while the nod fills only the newest seconds of a window, it can come and go).
	const head = headRows(40, [{ px: 3, bpm: 60, from: 20 }], 0.3);
	const first = (() => {
		let f = Number.NaN;
		for (let t = 40000; t >= 20000 && headCarries(head, t, 60); t -= 250) f = t;
		return f;
	})();

	it("the nod is carried from some window on, and not in the window before", () => {
		expect(first).toBeGreaterThan(20000);
		expect(first).toBeLessThan(36000);
		expect(headCarries(head, first - 250, 60)).toBe(false);
	});

	it("is false while one of the four windows does not carry the rate", () => {
		expect(headMatches(head, first + 2750, 60)).toBe(false);
	});

	it("and true once all four do, at that rate only", () => {
		expect(headMatches(head, first + 3000, 60)).toBe(true);
		expect(headMatches(head, first + 3000, 90)).toBe(false);
	});

	it("a blind window withholds nothing: rows missing from 1 to 2.5 s leave the window ending at 17 s unjudged", () => {
		const r = headRows(20, [{ px: 2, bpm: 60 }], 0.3);
		expect(headMatches(r, 20000, 60)).toBe(true);
		const gap = r.filter((x) => x[0] < 1000 || x[0] > 2500);
		expect(headCarries(gap, 18000, 60)).toBe(true);
		expect(headJudge(gap, 17000, 60)).toBe("blind");
		expect(headMatches(gap, 20000, 60)).toBe(false);
	});
});

describe("PulseCheck keeps the head rows the rule needs, and forgets them on reset", () => {
	// The withhold judges 4 windows of 16 s, so the check must keep at least 19 s of head rows (16 s
	// plus 3 one-second steps back). Kept for less, the older windows lose their start and are blind:
	// a nod reached through the agreement path is then never withheld.
	it("keeps 19 s of head rows: a nod at the rate is withheld once the agreement path reaches it", () => {
		const nodding = rowAt(headRows(40, [{ px: 3, bpm: 72 }], 0.3, { fps: 30 }));
		const states = pushPulse(new PulseCheck({ agreement: true }), { seconds: 40, bpm: 72, second: 72 }, nodding);
		expect(states.filter((s) => s.headMatch).length).toBeGreaterThan(5);
		expect(states.slice(19).every((s) => s.windowHead === "carried")).toBe(true);
		expect(states.every((s) => s.bpm == null)).toBe(true);
	});

	// With a clock that runs on, no window judged after a reset reaches back before it (16 s of colour
	// must come first), so stale head rows matter where the clock starts over: a replay, or a stream
	// restarted under the same check. A replay after reset() must read exactly as a fresh check.
	it("reset() clears the head rows: the same replay after a reset reads as on a fresh check", () => {
		const run = (check: PulseCheck) => {
			const out: Array<[boolean | undefined, number | null, string | null | undefined]> = [];
			replay(nod, { check, second: 60 }, (s) => out.push([s.headMatch, s.bpm, s.windowHead]));
			return out;
		};
		const fresh = run(new PulseCheck({ agreement: true }));
		const reused = new PulseCheck({ agreement: true });
		run(reused);
		reused.reset();
		const again = run(reused);
		expect(fresh.filter(([m]) => m).length).toBeGreaterThan(10);
		expect(again).toEqual(fresh);
	});

	it("reset() forgets that heads were handed over: a face with no mesh after it is not judged on movement", () => {
		const check = new PulseCheck();
		pushPulse(check, { seconds: 20, bpm: 70 }, rowAt(headRows(20, [], 0.3, { fps: 30 })));
		check.reset();
		const states = pushPulse(check, { seconds: 40, bpm: 70, from: 30000 }, () => undefined);
		expect(states.every((s) => s.windowHead == null)).toBe(true);
		expect(states.slice(19).every((s) => s.bpm != null && Math.abs(s.bpm - 70) <= 4)).toBe(true);
	});

	it("a real pulse whose head moves with the heartbeat is shown every second once proven", () => {
		// A shake at the rate that dominates the head's movement, at 0.13% of the face's width (the
		// most any real pulse moved where its shake dominated): 0.25 px on 190 px.
		const shake = headRows(45, [{ px: 0.25, bpm: 70 }], 0.01, { fps: 30 });
		expect(atRate(shake, 30000, 70).snrDb).toBeGreaterThan(HEAD_MIN_SNR_DB);
		const states = pushPulse(new PulseCheck(), { seconds: 45, bpm: 70 }, rowAt(shake));
		// Proven at 19 s, as with a perfectly still head; every second from then shows 70.
		const after = states.slice(18).map((s) => s.bpm);
		expect(after.length).toBeGreaterThan(20);
		expect(after.every((b) => b != null && Math.abs(b - 70) <= 4)).toBe(true);
		expect(states.slice(18).every((s) => s.windowHead === "clear")).toBe(true);
	});
});

describe("headCentre", () => {
	const mesh = (n: number) => Array.from({ length: n }, () => ({ x: 0.9, y: 0.05 }));

	it("is the centre of the bone landmarks in pixels, whatever the other points do", () => {
		const points = mesh(478);
		// The nine bone landmarks spread around (0.5, 0.5); every other point off in a corner.
		HEAD_LANDMARKS.forEach((i, k) => {
			points[i] = { x: 0.4 + 0.025 * k, y: 0.3 + 0.05 * k };
		});
		const c = headCentre(points, 640, 480);
		expect(c?.x).toBeCloseTo(320, 6);
		expect(c?.y).toBeCloseTo(240, 6);
		// The head 3 px lower: its centre 3 px lower.
		const lower = points.map((p, i) => (HEAD_LANDMARKS.includes(i) ? { x: p.x, y: p.y + 3 / 480 } : p));
		expect(headCentre(lower, 640, 480)?.y).toBeCloseTo(243, 6);
	});

	it("carries the face's width in pixels, cheekbone to cheekbone (234 to 454), however the head is tilted", () => {
		const points = mesh(478);
		HEAD_LANDMARKS.forEach((i) => {
			points[i] = { x: 0.5, y: 0.5 };
		});
		points[234] = { x: 0.35, y: 0.5 };
		points[454] = { x: 0.65, y: 0.5 };
		expect(headCentre(points, 640, 480)?.faceWidth).toBeCloseTo(192, 6);
		// Tilted: 192 px across and 36 px down.
		points[454] = { x: 0.65, y: 0.5 + 36 / 480 };
		expect(headCentre(points, 640, 480)?.faceWidth).toBeCloseTo(Math.hypot(192, 36), 6);
	});

	it("reads the 468-point mesh (no iris points) as well as the 478-point one", () => {
		expect(headCentre(mesh(468), 640, 480)).not.toBeNull();
		expect(headCentre(mesh(455), 640, 480)).not.toBeNull(); // the highest index used is 454
	});

	it("is null for a mesh without every bone landmark, or a frame with no size", () => {
		expect(headCentre(mesh(454), 640, 480)).toBeNull();
		expect(headCentre([], 640, 480)).toBeNull();
		expect(headCentre(mesh(478), 0, 480)).toBeNull();
		expect(headCentre(mesh(478), 640, 0)).toBeNull();
	});
});

// The rule works only if the app's frames carry the head to the check: DemoRunner reads the face
// mesh on each frame, takes headCentre and hands it to push(). Here the nod fixture is replayed as
// camera frames through a DemoRunner set up as createRppgSession sets it up.
describe("headMotion through DemoRunner (as createRppgSession runs it)", () => {
	class Source implements FrameSource {
		onFrame: ((frame: Frame) => void) | null = null;
		async start(): Promise<void> {}
		async stop(): Promise<void> {}
	}
	// A 160x120 frame (the fixture's 640x480 camera at a quarter): the fixture's grey wall, three
	// skin boxes (forehead, left cheek, right cheek) painted with its region colours, and a
	// 478-point face mesh over the face that moves as the fixture's bone landmarks moved, its
	// cheekbones as far apart as the fixture's face is wide (about 50 px at this size).
	const W = 160;
	const H = 120;
	const ROIS = [
		{ x: 72, y: 36, w: 16, h: 8 },
		{ x: 62, y: 60, w: 10, h: 10 },
		{ x: 88, y: 60, w: 10, h: 10 },
	];
	const firstHead = headOfRow(nod, nod.motion[0]);
	const baseMesh = Array.from({ length: 478 }, (_, i) => ({
		x: 0.35 + 0.3 * ((i % 22) / 21),
		y: 0.25 + 0.55 * (Math.floor(i / 22) / 21),
	}));
	baseMesh[234] = { x: 0.5 - firstHead.faceWidth / 2 / 640, y: 0.49 };
	baseMesh[454] = { x: 0.5 + firstHead.faceWidth / 2 / 640, y: 0.49 };

	/** Paints a box with a colour whose mean keeps its fraction, dithered as a camera's noise does. */
	function paint(data: Uint8ClampedArray, box: { x: number; y: number; w: number; h: number }, rgb: number[]) {
		const n = box.w * box.h;
		let k = 0;
		for (let y = box.y; y < box.y + box.h; y++)
			for (let x = box.x; x < box.x + box.w; x++, k++) {
				const at = (y * W + x) * 4;
				const d = (k + 0.5) / n;
				data[at] = Math.floor(rgb[0] + d);
				data[at + 1] = Math.floor(rgb[1] + d);
				data[at + 2] = Math.floor(rgb[2] + d);
				data[at + 3] = 255;
			}
	}
	/** One frame: the wall (one dithered row, repeated: painting every pixel took 8 s a run) and the three regions. */
	function frameData(wall: number[], regions: number[]): Uint8ClampedArray {
		const data = new Uint8ClampedArray(W * H * 4);
		paint(data, { x: 0, y: 0, w: W, h: 1 }, wall);
		const row = data.slice(0, W * 4);
		for (let y = 1; y < H; y++) data.set(row, y * W * 4);
		ROIS.forEach((box, k) => paint(data, box, regions.slice(3 * k, 3 * k + 3)));
		return data;
	}

	/** Replays the nod fixture's first `frames` frames as camera frames; `mesh: false` sends no mesh with them. */
	async function run(rules: PulseCheckRules, o: { frames?: number; mesh?: boolean } = {}) {
		const check = new PulseCheck({ rules });
		const push = jest.spyOn(check, "push");
		const source = new Source();
		const proc = { pushFusedSample: jest.fn(), pushSampleRgbMeta: jest.fn(), getMetrics: () => ({ bpm: null }), reset: jest.fn() };
		const runner = new DemoRunner(source, proc as never, {
			pulseChecker: check,
			sampleRate: 30,
			roiSmoothingAlpha: 0.25,
			useSkinMask: true,
			requireFace: true,
		});
		await runner.start();
		const wallAt = new Map(nod.background.map((w) => [w[0], w]));
		const m = { i: 0 };
		const out: number[] = [];
		const frames = nod.rawRois.slice(0, o.frames ?? nod.rawRois.length);
		let next = nod.rawRois[0][0] + 1000;
		for (const r of frames) {
			const data = frameData((wallAt.get(r[0]) ?? [0, 155, 155, 155]).slice(1), r.slice(1, 10));
			const h = fixtureHead(nod, r[0], m) ?? firstHead;
			const dx = (h.x - firstHead.x) / 640;
			const dy = (h.y - firstHead.y) / 480;
			source.onFrame?.({
				data,
				width: W,
				height: H,
				timestampMs: r[0],
				rois: ROIS,
				landmarks: o.mesh === false ? undefined : baseMesh.map((p) => ({ x: p.x + dx, y: p.y + dy, z: 0 })),
			});
			if (r[0] >= next) {
				const b = check.getState().bpm;
				if (b != null) out.push(b);
				next += 1000;
			}
		}
		await runner.stop();
		return { shown: out, frames: frames.length, heads: push.mock.calls.map((c) => c[4]) };
	}

	it("the nod's frames show a false 60 with the rule off", async () => {
		const { shown } = await run({ headMotion: false });
		expect(shown.length).toBeGreaterThan(0);
		expect(shown.every((b) => Math.abs(b - 60) <= 4)).toBe(true);
	});

	it("every frame hands the check the head's position and the face's width, and the nod is withheld", async () => {
		const { shown, frames, heads } = await run({});
		expect(heads).toHaveLength(frames);
		expect(
			heads.every(
				(h) =>
					h != null &&
					Number.isFinite(h.x) &&
					Number.isFinite(h.y) &&
					Math.abs(h.faceWidth - (firstHead.faceWidth * W) / 640) < 1,
			),
		).toBe(true);
		expect(shown).toEqual([]);
	});

	it("a frame with face regions but no mesh hands over null (no head this frame), not nothing", async () => {
		const { heads } = await run({}, { frames: 5, mesh: false });
		expect(heads).toEqual([null, null, null, null, null]);
	});
});
