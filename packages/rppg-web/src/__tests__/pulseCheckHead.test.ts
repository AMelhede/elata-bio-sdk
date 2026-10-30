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
	opts: { rules?: PulseCheckRules; check?: PulseCheck },
	each: (state: ReturnType<PulseCheck["getState"]>) => void,
): void {
	const check = opts.check ?? new PulseCheck({ rules: opts.rules });
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
			each(check.getState());
			next += 1000;
		}
	}
}

/** Rates shown, once a second, replaying a fixture through a check with these rules. */
function shown(fx: Fx, rules: PulseCheckRules): number[] {
	const out: number[] = [];
	replay(fx, { rules }, (s) => {
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
	o: { seconds: number; bpm: number; from?: number },
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
// The withhold judges the last 4 one-second windows at once: a nod that has just begun, carried by
// the newest three windows but not yet the oldest, is not withheld until the oldest carries it too.
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

	// The README's "Things to know": the rule needs MediaPipe's mesh. A 68-point face detector's
	// landmarks give no head, so a check handed them sees every window blind and shows no rate.

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
