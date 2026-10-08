import { DemoRunner } from "../demoRunner";
import type { Frame, FrameSource } from "../frameSource";
import {
	HEAD_LANDMARKS,
	PulseCheck,
	type PulseCheckRules,
	headCarries,
	headCentre,
	headLines,
	headMatches,
} from "../pulseCheck";
import { OWN_PULSE_STREAK } from "../pulseCheckCore";

// Jest provides require; this package's tests carry no Node type declarations.
declare const require: (id: string) => unknown;

// Rule headMotion: a rate the head's own movement keeps time with is the movement's, not a pulse.
// Fixtures recorded by Peak on its fake camera from generated faces (no person in them):
// nod60-nopulse, NO pulse with the head nodding 3 px at 60 a minute (Peak read 60 on it before the
// same rule); nod90-pulse70, a pulse at 70 under a nod at 90 (Peak read 70).
type Fx = { rawRois: number[][]; motion: number[][]; background: number[][] };
const nod = require("./fixtures/nod60-nopulse.json") as Fx;
const pulse = require("./fixtures/nod90-pulse70.json") as Fx;

/** The head's centre (mean of the fixture's bone landmarks) at frame time `t`, if recorded within 200 ms. */
function fixtureHead(fx: Fx, t: number, m: { i: number }): { x: number; y: number } | null {
	while (m.i + 1 < fx.motion.length && fx.motion[m.i + 1][0] <= t) m.i++;
	const row = fx.motion[m.i];
	if (!row || row[0] > t || t - row[0] >= 200) return null;
	let x = 0;
	let y = 0;
	const n = (row.length - 1) / 2;
	for (let i = 1; i + 1 < row.length; i += 2) {
		x += row[i];
		y += row[i + 1];
	}
	return { x: x / n, y: y / n };
}

/**
 * Replays a fixture through a check, giving its state to `each` once a second. `second`: the SDK's
 * own rate, handed each second to the check's opt-in agreement path.
 */
function replay(
	fx: Fx,
	opts: { rules?: PulseCheckRules; agreement?: boolean; second?: number },
	each: (state: ReturnType<PulseCheck["getState"]>) => void,
): void {
	const check = new PulseCheck({ rules: opts.rules, agreement: opts.agreement });
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

/**
 * Head positions, 30 a second, as a face finder reports a still head (up to 0.5 px of seeded
 * landmark jitter either way on each axis), plus, from `from` seconds, an up-and-down movement of
 * `amp` px at `bpm`. Against this jitter a line of 0.244 px stands 2.6 dB above the rest of the
 * movement and one of 0.448 px 7.4 dB (asserted where used, so the fixture is checked first).
 */
function headRows(o: { seconds: number; amp: number; bpm: number; from?: number }): [number, number, number][] {
	let s = 3;
	const jitter = () => (s = (s * 16807) % 2147483647) / 2147483647 - 0.5;
	const rows: [number, number, number][] = [];
	for (let t = 0; t <= o.seconds * 1000; t += 1000 / 30) {
		const on = t >= (o.from ?? 0) * 1000 ? 1 : 0;
		rows.push([t, 320 + jitter(), 240 + on * o.amp * Math.sin((2 * Math.PI * o.bpm * t) / 60000) + jitter()]);
	}
	return rows;
}
/** The head's up-and-down line in the window ending at `atMs`. */
const upDown = (head: [number, number, number][], atMs: number) => headLines(head, atMs)?.[1];

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

// Where the bar sits. A real pulse moves the head a little at its own rate (each beat pushes blood
// up the neck): measured on 2,196 real-pulse seconds (recorded captures and a public rPPG dataset,
// within 5 bpm of a reference pulse), the head's line at the rate stood at most 2.6 dB above the
// rest of its movement. Generated faces with no pulse nodding at 60, 72 and 90 a minute: 7.4 to
// 8.9 dB. The bar (5 dB) must sit between the two: lower, real pulses are refused; higher, nods pass.
describe("headCarries: the bar sits between a real pulse's head and the weakest nod", () => {
	it("a head moving with the heartbeat as much as any real pulse measured (2.6 dB) does not carry it", () => {
		const head = headRows({ seconds: 20, amp: 0.244, bpm: 70 });
		const line = upDown(head, 20000);
		expect(line?.bpm).toBeCloseTo(71.25, 1); // the bin nearest 70 a minute in a 16 s window
		expect(line?.snrDb).toBeGreaterThan(2.4);
		expect(line?.snrDb).toBeLessThan(2.8);
		expect(headCarries(head, 20000, 70)).toBe(false);
	});

	it("the weakest no-pulse nod measured (7.4 dB) carries its rate", () => {
		const head = headRows({ seconds: 20, amp: 0.448, bpm: 60 });
		const line = upDown(head, 20000);
		expect(line?.bpm).toBe(60);
		expect(line?.snrDb).toBeGreaterThan(7.2);
		expect(line?.snrDb).toBeLessThan(7.6);
		expect(headCarries(head, 20000, 60)).toBe(true);
	});

	it("a nod carries its own rate, within 6 a minute, and no other", () => {
		const head = headRows({ seconds: 20, amp: 3, bpm: 60 });
		expect(headCarries(head, 20000, 60)).toBe(true);
		expect(headCarries(head, 20000, 66)).toBe(true);
		expect(headCarries(head, 20000, 67)).toBe(false);
		expect(headCarries(head, 20000, 90)).toBe(false);
	});

	it("a still head carries no rate, and under 40 positions are not judged", () => {
		const still = headRows({ seconds: 20, amp: 0, bpm: 60 });
		// Its strongest lines (one per axis) stand below the noise, so not even their own rates are carried.
		const lines = headLines(still, 20000) ?? [];
		expect(lines).toHaveLength(2);
		expect(Math.max(...lines.map((l) => l.snrDb))).toBeLessThan(0);
		for (const l of lines) expect(headCarries(still, 20000, l.bpm)).toBe(false);
		expect(headCarries(still, 20000, 60)).toBe(false);
		const nodding = headRows({ seconds: 20, amp: 3, bpm: 60 });
		expect(headCarries(nodding.slice(0, 39), 1300, 60)).toBe(false);
	});

	it("a real pulse whose head moves with the heartbeat (2.6 dB) is shown every second once proven", () => {
		const check = new PulseCheck();
		let s = 11;
		const noise = () => ((s = (s * 16807) % 2147483647) / 2147483647 - 0.5) * 0.4;
		const out: (number | null)[] = [];
		let next = 1000;
		for (const [t, x, y] of headRows({ seconds: 45, amp: 0.244, bpm: 70 })) {
			const p = 0.01 * Math.sin((2 * Math.PI * 70 * t) / 60000);
			const region = () => ({ r: 150 * (1 - 0.3 * p) + noise(), g: 120 * (1 - p) + noise(), b: 100 * (1 - 0.6 * p) + noise() });
			check.push(t, [region(), region(), region()], undefined, undefined, { x, y });
			if (t >= next) {
				out.push(check.getState().bpm);
				next += 1000;
			}
		}
		// Proven at 19 s, as with a perfectly still head; every second from then shows 70.
		const after = out.slice(18);
		expect(after.length).toBeGreaterThan(20);
		expect(after.every((b) => b != null && Math.abs(b - 70) <= 4)).toBe(true);
	});
});

// The withhold judges the last 4 one-second windows at once: a nod that has just begun, carried by
// the newest three windows but not yet the oldest, is not withheld until the oldest carries it too.
describe("headMatches: the head carried the rate in each of the last 4 windows", () => {
	// Still for 20 s, then a 3 px nod at 60 a minute. A window's newest samples weigh least (its Hann
	// taper), so the nod's line first clears the 5 dB bar in the window ending at 27.75 s.
	const head = headRows({ seconds: 40, amp: 3, bpm: 60, from: 20 });

	it("is false while one of the four windows does not carry the rate", () => {
		expect([30250, 29250, 28250, 27250].map((t) => headCarries(head, t, 60))).toEqual([true, true, true, false]);
		expect(headMatches(head, 30250, 60)).toBe(false);
	});

	it("and true once all four do (a fifth window back is not asked)", () => {
		expect([31000, 30000, 29000, 28000, 27000].map((t) => headCarries(head, t, 60))).toEqual([
			true,
			true,
			true,
			true,
			false,
		]);
		expect(headMatches(head, 31000, 60)).toBe(true);
		expect(headMatches(head, 31000, 90)).toBe(false);
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
	// 478-point face mesh over the face that moves as the fixture's bone landmarks moved.
	const W = 160;
	const H = 120;
	const ROIS = [
		{ x: 72, y: 36, w: 16, h: 8 },
		{ x: 62, y: 60, w: 10, h: 10 },
		{ x: 88, y: 60, w: 10, h: 10 },
	];
	const baseMesh = Array.from({ length: 478 }, (_, i) => ({
		x: 0.35 + 0.3 * ((i % 22) / 21),
		y: 0.25 + 0.55 * (Math.floor(i / 22) / 21),
	}));

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

	async function run(rules: PulseCheckRules) {
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
		const first = fixtureHead(nod, nod.motion[0][0], { i: 0 }) as { x: number; y: number };
		const out: number[] = [];
		let next = nod.rawRois[0][0] + 1000;
		for (const r of nod.rawRois) {
			const data = frameData((wallAt.get(r[0]) ?? [0, 155, 155, 155]).slice(1), r.slice(1, 10));
			const h = fixtureHead(nod, r[0], m) ?? first;
			const dx = (h.x - first.x) / 640;
			const dy = (h.y - first.y) / 480;
			source.onFrame?.({
				data,
				width: W,
				height: H,
				timestampMs: r[0],
				rois: ROIS,
				landmarks: baseMesh.map((p) => ({ x: p.x + dx, y: p.y + dy, z: 0 })),
			});
			if (r[0] >= next) {
				const b = check.getState().bpm;
				if (b != null) out.push(b);
				next += 1000;
			}
		}
		await runner.stop();
		return { shown: out, frames: nod.rawRois.length, heads: push.mock.calls.map((c) => c[4]) };
	}

	it("the nod's frames show a false 60 with the rule off", async () => {
		const { shown } = await run({ headMotion: false });
		expect(shown.length).toBeGreaterThan(0);
		expect(shown.every((b) => Math.abs(b - 60) <= 4)).toBe(true);
	});

	it("every frame hands the check the head's position, and the nod is withheld", async () => {
		const { shown, frames, heads } = await run({});
		expect(heads).toHaveLength(frames);
		expect(heads.every((h) => h != null && Number.isFinite(h.x) && Number.isFinite(h.y))).toBe(true);
		expect(shown).toEqual([]);
	});
});
