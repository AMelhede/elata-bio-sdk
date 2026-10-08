import { PulseCheck, type PulseCheckRules } from "../pulseCheck";

// Jest provides require; this package's tests carry no Node type declarations.
declare const require: (id: string) => unknown;

// Rule headMotion: a rate the head's own movement keeps time with is the movement's, not a pulse.
// Fixtures recorded by Peak on its fake camera from generated faces (no person in them):
// nod60-nopulse, NO pulse with the head nodding 3 px at 60 a minute (Peak read 60 on it before the
// same rule); nod90-pulse70, a pulse at 70 under a nod at 90 (Peak read 70).
type Fx = { rawRois: number[][]; motion: number[][]; background: number[][] };

/** Rates shown, once a second, replaying a fixture through a check with these rules. */
function shown(fx: Fx, rules: PulseCheckRules): number[] {
	const check = new PulseCheck({ rules });
	const wallAt = new Map(fx.background.map((w) => [w[0], w]));
	let m = 0;
	const out: number[] = [];
	let next = fx.rawRois[0][0] + 1000;
	for (const r of fx.rawRois) {
		while (m + 1 < fx.motion.length && fx.motion[m + 1][0] <= r[0]) m++;
		const row = fx.motion[m];
		let head: { x: number; y: number } | null = null;
		if (row && row[0] <= r[0] && r[0] - row[0] < 200) {
			let x = 0;
			let y = 0;
			const n = (row.length - 1) / 2;
			for (let i = 1; i + 1 < row.length; i += 2) {
				x += row[i];
				y += row[i + 1];
			}
			head = { x: x / n, y: y / n };
		}
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
			head,
		);
		if (r[0] >= next) {
			const b = check.getState().bpm;
			if (b != null) out.push(b);
			next += 1000;
		}
	}
	return out;
}

describe("PulseCheck rule headMotion", () => {
	const nod = require("./fixtures/nod60-nopulse.json") as Fx;
	const pulse = require("./fixtures/nod90-pulse70.json") as Fx;

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
});
