import { PulseCheck, resolvePulseCheckRules, PULSE_CHECK_RULE_NAMES } from "../pulseCheck";

type Row = number[];

// Ported from Peak (src/test/syntheticFace.ts screenRows): a still face with NO pulse, lit only by a
// screen showing video. Every 0.3 to 1.5 s the light's level jumps x0.85 to x1.15 and its tint +-6 DN,
// the same on all three regions, plus sensor noise. Rows: [t, forehead rgb, left cheek rgb, right cheek rgb].
function screenRows(seconds: number, seed = 44): Row[] {
	let r = seed >>> 0;
	const rng = () => (r = (r * 1664525 + 1013904223) >>> 0) / 4294967296;
	const steps: [number, number, number, number][] = [];
	let next = 0;
	for (let t = 0; t < 24; t += 1 / 30)
		if (t >= next) {
			next = t + 0.3 + rng() * 1.2;
			steps.push([t, 0.85 + rng() * 0.3, (rng() - 0.5) * 12, (rng() - 0.5) * 12]);
		}
	let s = 5;
	const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647 - 0.5) * 0.6;
	const out: Row[] = [];
	for (let t = 0; t <= seconds * 1000; t += 1000 / 30) {
		const lt = (t / 1000) % 24;
		let c = steps[0];
		for (const x of steps) if (x[0] <= lt) c = x;
		const [, k, du, dv] = c;
		const reg = () => [150 * k + 1.596 * dv + rnd(), 120 * k - 0.392 * du - 0.813 * dv + rnd(), 100 * k + 2.017 * du + rnd()];
		out.push([Math.round(t), ...reg(), ...reg(), ...reg()]);
	}
	return out;
}

// A chromatic 70 bpm pulse (green drops most) in steady light, with sensor noise.
function pulseRows(seconds: number, bpm = 70): Row[] {
	let s = 7;
	const noise = () => ((s = (s * 16807) % 2147483647) / 2147483647 - 0.5) * 0.3;
	const out: Row[] = [];
	for (let t = 0; t <= seconds * 1000; t += 1000 / 30) {
		const p = 0.008 * Math.sin((2 * Math.PI * bpm * t) / 60000);
		const reg = () => [150 * (1 - 0.3 * p) + noise(), 120 * (1 - p) + noise(), 100 * (1 - 0.6 * p) + noise()];
		out.push([Math.round(t), ...reg(), ...reg(), ...reg()]);
	}
	return out;
}


// A 70 bpm pulse under 100 Hz mains flicker filmed with uneven frame drops (17 kept of 30, the rest held):
// at each kept frame the lamp is high or low in turn (+-15%), the same on every region. Ported from Peak.
function mainsPulseRows(seconds: number): Row[] {
	const pulse = pulseRows(seconds);
	let held: Row | null = null;
	let last = -1;
	let kept = 0;
	return pulse.map((x, i) => {
		const bucket = Math.floor((i * 17) / 30 + 1e-9);
		if (bucket === last && held) return [x[0], ...held.slice(1)];
		last = bucket;
		const g = kept++ % 2 === 0 ? 1.15 : 0.85;
		held = [x[0], ...x.slice(1).map((v) => v * g)];
		return held;
	});
}


// A 70 bpm pulse while auto exposure hunts: gains 1, 1.12, 0.94, 1.08, 0.90, 1.05, 0.96, 1.10 every 3 s,
// each change eased over 4 frames, the same on every region. Ported from Peak.
function exposurePulseRows(seconds: number): Row[] {
	const gains = [1, 1.12, 0.94, 1.08, 0.9, 1.05, 0.96, 1.1];
	return pulseRows(seconds).map((x) => {
		const t = x[0] / 1000;
		const k = Math.floor(t / 3) % 8;
		const prev = gains[(k + 7) % 8];
		const a = Math.min(1, ((t - Math.floor(t / 3) * 3) * 30) / 4);
		const g = prev + (gains[k] - prev) * a;
		return [x[0], ...x.slice(1).map((v) => v * g)];
	});
}

/** Feeds the rows; returns every shown rate (one per second) and the last state. */
function run(rows: Row[], screenLight: boolean) {
	const check = new PulseCheck({ rules: { screenLight } });
	const shown: number[] = [];
	let steps = 0;
	let next = 1000;
	for (const x of rows) {
		const rgb = (i: number) => ({ r: x[1 + 3 * i], g: x[2 + 3 * i], b: x[3 + 3 * i] });
		check.push(x[0], [rgb(0), rgb(1), rgb(2)]);
		if (x[0] >= next) {
			const st = check.getState();
			if (st.verdict === "measured" && st.bpm != null) shown.push(st.bpm);
			steps = Math.max(steps, st.windowScreenSteps ?? 0);
			next += 1000;
		}
	}
	return { shown, steps, state: check.getState() };
}

describe("pulse check rule screenLight: a light stepping on the whole face is not a pulse", () => {
	it("is on by default and switchable like the others", () => {
		expect(PULSE_CHECK_RULE_NAMES).toContain("screenLight");
		expect(resolvePulseCheckRules().screenLight).toBe(true);
		expect(resolvePulseCheckRules({ screenLight: false }).screenLight).toBe(false);
	});

	// Seeds 1 to 30 measured here: with the rule off, the check's other rules already withhold 16 and a rate
	// is shown on 14 (these five among them); with the rule on, none shows a rate.
	it.each([2, 4, 6, 7, 8])("pulseless face under a screen (seed %i): a made-up rate with the rule off, none with it on", (seed) => {
		const rows = screenRows(90, seed);
		expect(run(rows, false).shown.length).toBeGreaterThan(0);
		const on = run(rows, true);
		expect(on.shown).toEqual([]);
		expect(on.steps).toBeGreaterThanOrEqual(10);
	});

	it("shows no rate on any of seeds 1 to 30 with the rule on", () => {
		for (let seed = 1; seed <= 30; seed++) expect([seed, run(screenRows(60, seed), true).shown]).toEqual([seed, []]);
	});

	it("a 70 bpm pulse in steady light still reads 70 with the rule on", () => {
		const on = run(pulseRows(45), true);
		expect(on.shown.length).toBeGreaterThan(10);
		for (const b of on.shown) expect(Math.abs(b - 70)).toBeLessThanOrEqual(3);
		expect(on.steps).toBe(0);
		expect(on.state.screenLight).toBe(false);
	});

	it("a 70 bpm pulse under uneven-drop mains flicker still reads 70: flicker reverses, a screen holds its level", () => {
		const on = run(mainsPulseRows(45), true);
		expect(on.steps).toBeLessThan(10);
		expect(on.shown.length).toBeGreaterThan(0);
		for (const b of on.shown) expect(Math.abs(b - 70)).toBeLessThanOrEqual(4);
	});

	it("a 70 bpm pulse while auto exposure hunts still reads 70: one eased change is one event", () => {
		const on = run(exposurePulseRows(45), true);
		expect(on.steps).toBeLessThan(10);
		expect(on.shown.length).toBeGreaterThan(0);
		for (const b of on.shown) expect(Math.abs(b - 70)).toBeLessThanOrEqual(4);
	});

	it("catches the screen when region means arrive as 0 to 1, as the session's skin-masked mean sends them", () => {
		// The session divides its skin-masked region mean by 255; a brightness floor written for 0 to 255
		// silently discarded every frame there, and the rule never fired live.
		for (const seed of [2, 4, 6]) {
			const unit = screenRows(45, seed).map((x) => [x[0], ...x.slice(1).map((v) => v / 255)]);
			const on = run(unit, true);
			expect(on.steps).toBeGreaterThanOrEqual(10);
			expect(on.shown).toEqual([]);
		}
	});

	it("steps on one region only are not counted", () => {
		// Same screen, but only the forehead takes it; the cheeks hold steady (a hand, a shadow, movement).
		const screen = screenRows(45, 3);
		const steady = pulseRows(45);
		const rows = screen.map((x, i) => [x[0], x[1], x[2], x[3], ...steady[i].slice(4, 10)]);
		expect(run(rows, true).steps).toBe(0);
	});
});
