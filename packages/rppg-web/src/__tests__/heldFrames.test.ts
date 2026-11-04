import { HELD_MAX_SHARE, HELD_RUN_FRAMES, PULSE_CHECK_RULE_NAMES, PulseCheck, heldFrameShare, resolvePulseCheckRules, shownPulseBpm } from "../pulseCheck";

// Rule heldFrames (on unless false): a window whose picture holds still between updates (a video encoder's) is not
// evidence. A clean 66 bpm pulse for 50 s at 30 fps, each value held for `hold` frames (1: a camera; 2: a camera sending
// each frame twice; 6: an encoder updating the face five times a second).
function run(opts: { heldFrames: boolean; hold: number }) {
	const c = new PulseCheck({ rules: { heldFrames: opts.heldFrames } });
	let seed = 5;
	const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5);
	let px = { r: 0.6, g: 0.4, b: 0.35 };
	let shown = 0;
	for (let i = 0; i < 30 * 50; i++) {
		if (i % opts.hold === 0) {
			const s = i / 30;
			const p = Math.sin(((2 * Math.PI * 66) / 60) * s) * 0.004 + rnd() * 0.004;
			px = { r: 0.6 - p * 0.3, g: 0.4 + p, b: 0.35 - p * 0.2 };
		}
		c.push((i * 1000) / 30, [px, px, px], undefined, undefined, { x: 300, y: 200, faceWidth: 100 });
		if (i % 30 === 29 && shownPulseBpm(c.getState()) != null) shown++;
	}
	return shown;
}

describe("rule heldFrames", () => {
	it("is on unless set to false, and is a named rule", () => {
		expect(resolvePulseCheckRules().heldFrames).toBe(true);
		expect(resolvePulseCheckRules({ heldFrames: false }).heldFrames).toBe(false);
		expect(new PulseCheck().rules.heldFrames).toBe(true);
		expect(PULSE_CHECK_RULE_NAMES).toContain("heldFrames");
	});
	it("off: a pulse whose picture is held 6 frames at a time still shows", () => {
		expect(run({ heldFrames: false, hold: 6 })).toBeGreaterThan(10);
	});
	it("on: the same held picture shows nothing", () => {
		expect(run({ heldFrames: true, hold: 6 })).toBe(0);
	});
	it("on: a camera that sends each frame twice (runs of 2) is not held, and shows as with the rule off", () => {
		expect(run({ heldFrames: true, hold: 2 })).toBe(run({ heldFrames: false, hold: 2 }));
		expect(run({ heldFrames: true, hold: 1 })).toBe(run({ heldFrames: false, hold: 1 }));
		expect(run({ heldFrames: true, hold: 1 })).toBeGreaterThan(10);
	});
	it("heldFrameShare: runs of HELD_RUN_FRAMES or more count, shorter ones do not", () => {
		const row = (t: number, v: number) => [t, v, v, v, v, v, v, v, v, v];
		const steady = Array.from({ length: 100 }, (_, i) => row(i * 33, 0.5 + 0.001 * Math.floor(i / HELD_RUN_FRAMES)));
		expect(heldFrameShare(steady, 99 * 33)).toBeGreaterThan(0.9);
		const pairs = Array.from({ length: 100 }, (_, i) => row(i * 33, 0.5 + 0.001 * Math.floor(i / 2)));
		expect(heldFrameShare(pairs, 99 * 33)).toBe(0);
		expect(HELD_MAX_SHARE).toBe(0.1);
	});
});
