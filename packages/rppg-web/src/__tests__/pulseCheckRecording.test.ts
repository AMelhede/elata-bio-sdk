import { DemoRunner } from "../demoRunner";
import type { Frame, FrameSource } from "../frameSource";
import { PulseCheck, type PulseCheckRules, type PulseCheckState, WallTracker } from "../pulseCheck";
import {
	PULSE_CHECK_RECORDING_EVENTS_PER_SECOND,
	PULSE_CHECK_RECORDING_FORMAT,
	PULSE_CHECK_RECORDING_SECONDS,
	PULSE_CHECK_RECORDING_VERSION,
	type PulseCheckRecording,
	RecordingPulseCheck,
	parsePulseCheckRecording,
	replayPulseCheck,
	serializePulseCheckRecording,
} from "../pulseCheckRecording";
import { RppgSession, sessionPulseCheck } from "../rppgSession";

// Jest provides require; this package's tests carry no Node type declarations.
declare const require: (id: string) => unknown;

// The pulse check's input recording (recordPulseCheckInputs) and its replay (replayPulseCheck).
// What it is for: a test with a reference sensor saves what the check was fed, and every rule
// setting (the four dim-light candidates included) is then judged offline on the same seconds.
// That only works if a replay with the session's own rules gives back exactly the numbers the
// session showed, and if recording changes nothing. Both are tested here on inputs where every
// field the check reads changes its output: the wall and the wall as the camera read it (rule
// darkWall), the head (rule headMotion, and a head left out against a head not found), why a
// frame had no wall (the state's wallFrames), the face lost, the SDK's own rate (the agreement
// path), and the session's own reasons for showing nothing (no face, a failed engine).

type Fx = { rawRois: number[][]; motion?: number[][]; background?: number[][]; motionLandmarks?: number[] };
const nod = require("./fixtures/nod60-nopulse.json") as Fx;
const pulse = require("./fixtures/nod90-pulse70.json") as Fx;
const screen = require("./fixtures/screen90-pulse70-darkwall.json") as { rows: number[][] };

type Rgb = { r: number; g: number; b: number };
const rgbAt = (r: readonly number[], i: number, scale = 1): Rgb => ({ r: r[i] / scale, g: r[i + 1] / scale, b: r[i + 2] / scale });

/** The head at fixture time t (a mesh row within 200 ms before it), as headCentre gives it; null if none. */
function headAt(fx: Fx, t: number, m: { i: number }): { x: number; y: number; faceWidth: number } | null {
	const motion = fx.motion ?? [];
	const lm = fx.motionLandmarks ?? [];
	while (m.i + 1 < motion.length && motion[m.i + 1][0] <= t) m.i++;
	const row = motion[m.i];
	if (!row || row[0] > t || t - row[0] >= 200) return null;
	let x = 0;
	let y = 0;
	const n = (row.length - 1) / 2;
	for (let i = 1; i + 1 < row.length; i += 2) {
		x += row[i];
		y += row[i + 1];
	}
	const l = 1 + 2 * lm.indexOf(234);
	const r = 1 + 2 * lm.indexOf(454);
	return { x: x / n, y: y / n, faceWidth: Math.hypot(row[r] - row[l], row[r + 1] - row[l + 1]) };
}

/** Everything a caller can hand the check, one call at a time, so the same calls go to a live check and a recording one. */
type Call =
	| { push: Parameters<PulseCheck["push"]> }
	| { lost: number }
	| { opinion: number | null };

function apply(check: PulseCheck, c: Call): void {
	if ("push" in c) check.push(...c.push);
	else if ("lost" in c) check.faceLost(c.lost);
	else check.secondOpinion(c.opinion);
}

/** The screen-light fixture's wall as DemoRunner hands it: through a WallTracker, first second a brighter patch (rule darkWall reads the raw wall). */
function screenCalls(): Call[] {
	const tracker = new WallTracker();
	const t0 = screen.rows[0][0];
	return screen.rows.map((r) => {
		const p = r[0] < t0 + 1000 ? { gap: 1, rgb: { r: 0.2, g: 0.2, b: 0.2 } } : { gap: 0, rgb: rgbAt(r, 10) };
		const w = tracker.track(p.gap, p.rgb);
		return { push: [r[0], [rgbAt(r, 1), rgbAt(r, 4), rgbAt(r, 7)], w.rgb, undefined, undefined, w.raw] as Parameters<PulseCheck["push"]> };
	});
}

/** A fixture with its head and wall, as the runner hands them (0..255 scaled to 0..1). */
function fixtureCalls(fx: Fx): Call[] {
	const wallAt = new Map((fx.background ?? []).map((w) => [w[0], w]));
	const m = { i: 0 };
	return fx.rawRois.map((r) => {
		const w = wallAt.get(r[0]);
		return {
			push: [r[0], [rgbAt(r, 1, 255), rgbAt(r, 4, 255), rgbAt(r, 7, 255)], w ? rgbAt(w, 1, 255) : undefined, w ? undefined : "no-room", headAt(fx, r[0], m)] as Parameters<PulseCheck["push"]>,
		};
	});
}

/**
 * Every other way in: a wall missing for skin or for no room, a head left out (undefined) for a
 * stretch and then handed over, regions given as four and as two, a timestamp that is not a number,
 * a lost face for 2 s, a gap in the frames, and the SDK's own rate once a second (agreement path).
 */
function mixedCalls(): Call[] {
	const out: Call[] = [];
	const base = fixtureCalls(pulse) as { push: Parameters<PulseCheck["push"]> }[];
	base.forEach((c, i) => {
		const [t, regions, wall, , head] = c.push;
		const miss = wall ? undefined : i % 2 ? "skin" : "no-room";
		const h = i < 200 ? undefined : i % 7 === 0 ? null : head;
		const regs = i % 50 === 3 ? [...regions, regions[0]] : i % 97 === 5 ? regions.slice(0, 2) : regions;
		out.push({ push: [i === 321 ? Number.NaN : t, regs, i % 11 === 0 ? undefined : wall, miss, h] as Parameters<PulseCheck["push"]> });
		if (i % 30 === 0) out.push({ opinion: i % 90 === 0 ? null : 70.5 });
	});
	const end = base[base.length - 1].push[0];
	for (let t = end + 33; t < end + 2000; t += 33) out.push({ lost: t });
	base.forEach((c) => {
		const [t, regions, wall, miss, head] = c.push;
		out.push({ push: [t + end + 2500, regions, wall, miss, head] });
	});
	base.forEach((c) => {
		const [t, regions, wall, miss, head] = c.push;
		out.push({ push: [t + 2 * end + 8000, regions, wall, miss, head] });
	});
	return out;
}

/**
 * A pulse at 75 in the forehead only, noise in both cheeks, the SDK's own rate 75 once a second
 * (pulseCheckAgreement.test.ts): the check's own streak cannot prove it, so only the agreement path,
 * fed by the SDK's rate, shows a number.
 */
function oneRegionCalls(): Call[] {
	let seed = 3;
	const n = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 0.8;
	const out: Call[] = [];
	let next = 20000;
	for (let t = 0; t <= 60000; t += 1000 / 30) {
		const p = 0.004 * Math.sin((2 * Math.PI * 75 * t) / 60000);
		const flat = () => ({ r: 150 + n(), g: 120 + n(), b: 100 + n() });
		out.push({ push: [t, [{ r: 150 * (1 - 0.3 * p) + n(), g: 120 * (1 - p) + n(), b: 100 * (1 - 0.6 * p) + n() }, flat(), flat()]] });
		if (t >= next) {
			out.push({ opinion: 75 });
			next += 1000;
		}
	}
	return out;
}

/** The check's state at each of its evaluations (once a second while frames arrive). */
function evaluationsOf(check: PulseCheck, calls: readonly Call[]): PulseCheckState[] {
	const out: PulseCheckState[] = [];
	for (const c of calls) {
		const before = check.evaluations;
		apply(check, c);
		if (check.evaluations !== before) out.push(check.getState());
	}
	return out;
}

const shownOf = (s: PulseCheckState) => (s.verdict === "measured" ? s.bpm : null);
const roundTrip = (r: PulseCheckRecording) => parsePulseCheckRecording(serializePulseCheckRecording(r));

const SCENES: [string, () => Call[], { rules?: PulseCheckRules; agreement?: boolean }][] = [
	["screen light over a dark wall (wall, raw wall)", screenCalls, {}],
	["a nod with no pulse (head, wall)", () => fixtureCalls(nod), {}],
	["a pulse under a nod (head, wall)", () => fixtureCalls(pulse), {}],
	["every other way in (wall misses, head left out, NaN time, face lost, gap, agreement)", mixedCalls, { agreement: true }],
	["a pulse only the agreement path can show (the SDK's own rate)", oneRegionCalls, { agreement: true }],
];

describe("RecordingPulseCheck: the check's inputs, kept, and replayed", () => {
	it.each(SCENES)("%s: recording changes nothing, and the replay gives back every state exactly", (_name, calls, opts) => {
		const cs = calls();
		const live = evaluationsOf(new PulseCheck(opts), cs);
		const rec = new RecordingPulseCheck(opts);
		const recorded = evaluationsOf(rec, cs);
		expect(recorded).toEqual(live);
		const replay = replayPulseCheck(roundTrip(rec.getRecording()));
		expect(replay.evaluations.map((e) => e.state)).toEqual(live);
		expect(replay.evaluations.map((e) => e.bpm)).toEqual(live.map(shownOf));
	});

	it("each scene's known answer holds, so the comparison above is not between empty outputs", () => {
		const shown = (cs: Call[], o = {}) => evaluationsOf(new PulseCheck(o), cs).map(shownOf).filter((b): b is number => b != null);
		expect(shown(fixtureCalls(nod))).toEqual([]);
		expect(shown(fixtureCalls(nod), { rules: { headMotion: false } }).length).toBeGreaterThan(0);
		expect(shown(screenCalls())).toEqual(expect.arrayContaining([expect.closeTo(70, 0)]));
		expect(shown(screenCalls()).every((b) => Math.abs(b - 70) <= 4)).toBe(true);
		expect(shown(screenCalls(), { rules: { darkWall: false } }).some((b) => Math.abs(b - 90) <= 3)).toBe(true);
		expect(shown(mixedCalls(), { agreement: true }).length).toBeGreaterThan(0);
		expect(shown(oneRegionCalls(), { agreement: true }).length).toBeGreaterThan(20);
		expect(shown(oneRegionCalls())).toEqual([]);
		expect(shown(oneRegionCalls().filter((c) => !("opinion" in c)), { agreement: true })).toEqual([]);
	});

	it.each([
		["headMotion off", { headMotion: false }, () => fixtureCalls(nod)],
		["darkWall off", { darkWall: false }, screenCalls],
		["the four dim-light candidates on", { followerMedian: true, reproveOnDrift: true, tooDark: true, anchorDrift: true }, mixedCalls],
	] as [string, PulseCheckRules, () => Call[]][])(
		"a recording made with the defaults, replayed with %s, equals a live check run with them",
		(_name, rules, calls) => {
			const cs = calls();
			const rec = new RecordingPulseCheck({ agreement: true });
			evaluationsOf(rec, cs);
			const live = evaluationsOf(new PulseCheck({ rules, agreement: true }), cs);
			expect(replayPulseCheck(roundTrip(rec.getRecording()), { rules }).evaluations.map((e) => e.state)).toEqual(live);
			expect(replayPulseCheck(rec.getRecording()).evaluations.map((e) => e.state)).not.toEqual(live);
		},
	);

	it("the recording carries its format, version, build, rules and agreement; replay uses them unless told otherwise", () => {
		const rec = new RecordingPulseCheck({ rules: { headMotion: false }, agreement: true }).getRecording();
		expect(rec.format).toBe(PULSE_CHECK_RECORDING_FORMAT);
		expect(rec.version).toBe(PULSE_CHECK_RECORDING_VERSION);
		expect(typeof rec.build).toBe("string");
		expect(rec.rules.headMotion).toBe(false);
		expect(rec.rules.lightTaint).toBe(true);
		expect(rec.agreement).toBe(true);
		expect(rec.seconds).toBe(PULSE_CHECK_RECORDING_SECONDS);
		expect(rec.dropped).toBe(0);
		const cs = fixtureCalls(nod);
		const r = new RecordingPulseCheck({ rules: { headMotion: false } });
		evaluationsOf(r, cs);
		expect(replayPulseCheck(r.getRecording()).evaluations.map((e) => e.state)).toEqual(
			evaluationsOf(new PulseCheck({ rules: { headMotion: false } }), cs),
		);
	});
});

describe("the recording's JSON", () => {
	it("keeps numbers that JSON alone cannot carry, and keeps a head left out apart from a head not found", () => {
		const rec = new RecordingPulseCheck();
		rec.push(Number.NaN, [{ r: Number.NaN, g: Number.POSITIVE_INFINITY, b: Number.NEGATIVE_INFINITY }, { r: -0, g: 0.5, b: 0.25 }, { r: 1, g: 2, b: 3 }]);
		rec.push(10, [{ r: 0.1, g: 0.2, b: 0.3 }, { r: 0.4, g: 0.5, b: 0.6 }, { r: 0.7, g: 0.8, b: 0.9 }], undefined, "skin", null);
		rec.push(20, [{ r: 0.1, g: 0.2, b: 0.3 }, { r: 0.4, g: 0.5, b: 0.6 }, { r: 0.7, g: 0.8, b: 0.9 }], { r: 0.3, g: 0.3, b: 0.3 }, undefined, { x: 1, y: 2, faceWidth: 3 }, { r: 0.6, g: 0.6, b: 0.6 });
		const back = roundTrip(rec.getRecording());
		const [a, b, c] = back.events;
		expect(a[1]).toBeNaN();
		if (a[0] !== "f" || b[0] !== "f" || c[0] !== "f") throw new Error("frames expected");
		expect(Number.isNaN(a[2][0][0])).toBe(true);
		expect(a[2][0][1]).toBe(Number.POSITIVE_INFINITY);
		expect(a[2][0][2]).toBe(Number.NEGATIVE_INFINITY);
		expect(Object.is(a[2][1][0], -0)).toBe(true);
		expect(a[6]).toBe(false);
		expect(b[6]).toBeNull();
		expect(b[5]).toBe("skin");
		expect(c[3]).toEqual([0.3, 0.3, 0.3]);
		expect(c[4]).toEqual([0.6, 0.6, 0.6]);
		expect(c[6]).toEqual([1, 2, 3]);
		expect(back).toEqual(rec.getRecording());
	});

	it("refuses a file of another format or another version", () => {
		const text = serializePulseCheckRecording(new RecordingPulseCheck().getRecording());
		expect(() => parsePulseCheckRecording(text.replace(PULSE_CHECK_RECORDING_FORMAT, "something-else"))).toThrow(/format/);
		expect(() => parsePulseCheckRecording(text.replace(`"version":${PULSE_CHECK_RECORDING_VERSION}`, '"version":99'))).toThrow(/version/);
		expect(() => replayPulseCheck({ ...JSON.parse(text), version: 99 })).toThrow(/version/);
	});
});

describe("bounded memory", () => {
	const regions = [{ r: 0.5, g: 0.4, b: 0.3 }, { r: 0.5, g: 0.4, b: 0.3 }, { r: 0.5, g: 0.4, b: 0.3 }];

	it(`keeps the newest ${PULSE_CHECK_RECORDING_SECONDS} s by default, and says how many events it dropped`, () => {
		const rec = new RecordingPulseCheck();
		const n = (PULSE_CHECK_RECORDING_SECONDS + 60) * 30;
		for (let i = 0; i < n; i++) rec.push((i * 1000) / 30, regions);
		const r = rec.getRecording();
		const ts = r.events.map((e) => e[1] as number);
		expect(ts[ts.length - 1] - ts[0]).toBeLessThanOrEqual(PULSE_CHECK_RECORDING_SECONDS * 1000);
		expect(ts[ts.length - 1] - ts[0]).toBeGreaterThan((PULSE_CHECK_RECORDING_SECONDS - 1) * 1000);
		expect(r.dropped + r.events.length).toBe(n);
		expect(ts).toEqual([...ts].sort((a, b) => a - b));
	});

	it("never holds more than its event cap, however fast the frames come", () => {
		const rec = new RecordingPulseCheck({ seconds: 2 });
		for (let i = 0; i < 5000; i++) rec.push(i * 0.1, regions);
		const r = rec.getRecording();
		expect(r.events.length).toBe(2 * PULSE_CHECK_RECORDING_EVENTS_PER_SECOND);
		expect(r.dropped).toBe(5000 - r.events.length);
		expect(r.events[r.events.length - 1][1]).toBe(4999 * 0.1);
	});

	it("hands out a copy: later frames do not change a recording already taken", () => {
		const rec = new RecordingPulseCheck({ seconds: 1 });
		rec.push(0, regions);
		const r = rec.getRecording();
		for (let i = 1; i < 100; i++) rec.push(i * 33, regions);
		expect(r.events).toHaveLength(1);
		expect(r.dropped).toBe(0);
	});

	it("refuses a length that is not a positive number of seconds", () => {
		for (const s of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) expect(() => new RecordingPulseCheck({ seconds: s })).toThrow(RangeError);
	});
});

// Through the session, as createRppgSession builds it: camera frames into DemoRunner, the check
// built by sessionPulseCheck, and getMetrics() read as an app reads it.
describe("through the session: getMetrics() as shown, and its replay", () => {
	class Source implements FrameSource {
		onFrame: ((frame: Frame) => void) | null = null;
		async start(): Promise<void> {}
		async stop(): Promise<void> {}
	}
	const W = 160;
	const H = 120;
	const ROIS = [
		{ x: 72, y: 36, w: 16, h: 8 },
		{ x: 62, y: 60, w: 10, h: 10 },
		{ x: 88, y: 60, w: 10, h: 10 },
	];
	const MESH = Array.from({ length: 478 }, (_, i) => ({ x: 0.35 + 0.3 * ((i % 22) / 21), y: 0.25 + 0.55 * (Math.floor(i / 22) / 21), z: 0 }));
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
	function frameData(wall: number[], regions: number[]): Uint8ClampedArray {
		const data = new Uint8ClampedArray(W * H * 4);
		paint(data, { x: 0, y: 0, w: W, h: 1 }, wall);
		const row = data.slice(0, W * 4);
		for (let y = 1; y < H; y++) data.set(row, y * W * 4);
		ROIS.forEach((box, k) => paint(data, box, regions.slice(3 * k, 3 * k + 3)));
		return data;
	}

	type Read = { bpm: number | null; check: PulseCheckState | null };
	/**
	 * The pulse fixture twice, with 3 s of no face between (the session shows nothing after 1 s, the
	 * check resets), and the engine failing for the last 2 s (the session shows nothing, whatever the
	 * check holds). getMetrics() read on every third frame, twice in a row on every ninth.
	 */
	async function run(opts: { record: boolean; agreement?: boolean; rules?: PulseCheckRules }) {
		const check = sessionPulseCheck({
			pulseCheckAgreement: opts.agreement,
			pulseCheckRules: opts.rules,
			recordPulseCheckInputs: opts.record,
		});
		if (!check) throw new Error("no check");
		const source = new Source();
		let failed = false;
		const proc = {
			pushFusedSample: jest.fn(),
			pushSampleRgbMeta: jest.fn(),
			getMetrics: () => ({ bpm: 70.4, confidence: 0.6, signal_quality: 0.5 }),
			getBackendFailure: () => (failed ? { stage: "process", message: "x" } : null),
			reset: jest.fn(),
			resetSignal: jest.fn(),
		};
		const runner = new DemoRunner(source, proc as never, { pulseChecker: check, sampleRate: 30, roiSmoothingAlpha: 0.25, useSkinMask: true, requireFace: true });
		const session = new RppgSession(source, proc as never, runner, "wasm", "face_mesh", { pulseCheck: check });
		await session.start();
		const wallAt = new Map((pulse.background ?? []).map((w) => [w[0], w]));
		const span = pulse.rawRois[pulse.rawRois.length - 1][0] + 33;
		const reads: Read[] = [];
		let k = 0;
		const read = () => reads.push({ bpm: session.getMetrics().bpm ?? null, check: session.getPulseCheck() });
		for (let pass = 0; pass < 2; pass++) {
			const offset = pass * (span + 3000);
			if (pass === 1)
				for (let t = span; t < span + 3000; t += 33) {
					source.onFrame?.({ data: new Uint8ClampedArray(W * H * 4), width: W, height: H, timestampMs: t });
					if (++k % 3 === 0) read();
				}
			for (const r of pulse.rawRois) {
				const t = r[0] + offset;
				if (pass === 1 && t > offset + span - 2000) failed = true;
				source.onFrame?.({
					data: frameData((wallAt.get(r[0]) ?? [0, 155, 155, 155]).slice(1), r.slice(1, 10)),
					width: W,
					height: H,
					timestampMs: t,
					rois: ROIS,
					landmarks: MESH,
				});
				if (++k % 3 === 0) read();
				if (k % 9 === 0) read();
			}
		}
		await session.stop();
		return { reads, session };
	}

	it("recording on or off, the session shows the same numbers and the check the same states", async () => {
		const off = await run({ record: false });
		const on = await run({ record: true });
		expect(on.reads).toEqual(off.reads);
		expect(off.session.getPulseCheckRecording()).toBeNull();
		expect(on.session.getPulseCheckRecording()).not.toBeNull();
	});

	it.each([
		["the defaults", {}],
		["the agreement path", { agreement: true }],
	] as [string, { agreement?: boolean }][])("with %s, the replay of a saved recording gives back every number the session showed", async (_name, o) => {
		const { reads, session } = await run({ record: true, ...o });
		const rec = session.getPulseCheckRecording();
		if (!rec) throw new Error("no recording");
		const replay = replayPulseCheck(parsePulseCheckRecording(serializePulseCheckRecording(rec)));
		expect(replay.reads.map((r) => r.bpm)).toEqual(reads.map((r) => r.bpm));
		expect(replay.reads.map((r) => r.live)).toEqual(reads.map((r) => r.bpm));
		expect(replay.reads.map((r) => r.state)).toEqual(reads.map((r) => r.check));
		// Not vacuous: a rate was shown, the no-face stretch and the failed engine each hid one.
		const shown = reads.filter((r) => r.bpm != null);
		expect(shown.length).toBeGreaterThan(20);
		expect(shown.every((r) => Math.abs((r.bpm as number) - 70) <= 4)).toBe(true);
		expect(replay.reads.some((r) => r.reason === "no_face")).toBe(true);
		expect(replay.reads.some((r) => r.reason === "processor_failed" && r.state?.verdict === "measured")).toBe(true);
	});

	it("a replay with other rules equals a live session run with them", async () => {
		const rules = { followerMedian: true, reproveOnDrift: true, tooDark: true, anchorDrift: true };
		const { session } = await run({ record: true });
		const live = await run({ record: false, rules });
		const rec = session.getPulseCheckRecording();
		if (!rec) throw new Error("no recording");
		const replay = replayPulseCheck(rec, { rules });
		expect(replay.reads.map((r) => r.bpm)).toEqual(live.reads.map((r) => r.bpm));
		expect(replay.reads.map((r) => r.state)).toEqual(live.reads.map((r) => r.check));
	});
});
