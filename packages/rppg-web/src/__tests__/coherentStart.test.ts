import { COHERENT_START_BPM, COHERENT_START_MS, COHERENT_START_SHARE, PulseCheck, resolvePulseCheckRules, shownPulseBpm } from "../pulseCheck";

// Rule coherentStart: a new number shows only when the recent window rates back it. Noise wanders; a pulse stays put.
describe("rule coherentStart", () => {
	it("is on unless false; its constants are the ones chosen on the lab tuning half", () => {
		expect(resolvePulseCheckRules().coherentStart).toBe(true);
		expect(resolvePulseCheckRules({ coherentStart: false }).coherentStart).toBe(false);
		expect([COHERENT_START_MS, COHERENT_START_BPM, COHERENT_START_SHARE]).toEqual([30_000, 6, 0.5]);
	});
	it("never shows a number that startGated withholds", () => {
		expect(shownPulseBpm({ verdict: "measured", bpm: 70, startGated: true })).toBeNull();
		expect(shownPulseBpm({ verdict: "measured", bpm: 70, startGated: false })).toBe(70);
	});

	// A pulse whose rate jumps every few seconds (noise-like, as in a dark room) and then settles on one rate: without the
	// rule the settled rate shows as soon as it is proven; with it, only once the recent windows mostly agree with it.
	const run = (coherentStart: boolean, wander: boolean) => {
		const c = new PulseCheck({ rules: { moreReadings: true, followRecent: true, coherentStart } });
		let seed = 3; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5);
		const rates = [72, 45, 94, 49, 105, 60];
		let phase = 0, first: number | null = null;
		for (let i = 0; i < 30 * 70; i++) {
			const s = i / 30;
			const bpm = wander && s < 40 ? rates[Math.floor(s / 3) % rates.length] : 53;
			phase += (2 * Math.PI * bpm) / 60 / 30;
			const p = Math.sin(phase) * 0.004 + rnd() * 0.003;
			const px = { r: 0.6 - p * 0.3, g: 0.4 + p, b: 0.35 - p * 0.2 };
			c.push(s * 1000, [px, px, px]);
			if (first == null && i % 30 === 0 && shownPulseBpm(c.getState()) != null) first = s;
		}
		return first;
	};
	it("a clean steady pulse shows as soon as without the rule", () => {
		expect(run(true, false)).toBe(run(false, false));
	});
	it("after wandering windows, the settled rate waits until the recent windows back it", () => {
		const off = run(false, true), on = run(true, true);
		expect(off).not.toBeNull();
		expect(on == null || (off != null && on > off)).toBe(true);
	});
});
