import { PulseCheck } from "../pulseCheck";

// Three face regions at 30 fps. `amp` is the pulse as a fraction of the light: a real
// pulse is chromatic (green drops most), so each channel is scaled differently.
function feed(check: PulseCheck, bpm: number, amp: number, seconds: number, seed = 7) {
	let s = seed;
	const noise = () => ((s = (s * 16807) % 2147483647) / 2147483647 - 0.5) * 0.4;
	for (let t = 0; t <= seconds * 1000; t += 1000 / 30) {
		const p = amp * Math.sin((2 * Math.PI * bpm * t) / 60000);
		const region = () => ({ r: 150 * (1 - 0.3 * p) + noise(), g: 120 * (1 - p) + noise(), b: 100 * (1 - 0.6 * p) + noise() });
		check.push(t, [region(), region(), region()]);
	}
}

describe("PulseCheck", () => {
	it("proves a real pulse and reports its rate", () => {
		const check = new PulseCheck();
		feed(check, 72, 0.01, 40);
		const state = check.getState();
		expect(state.verdict).toBe("measured");
		expect(Math.abs((state.bpm ?? 0) - 72)).toBeLessThanOrEqual(2);
	});

	it("never proves a pulse when there is none", () => {
		const check = new PulseCheck();
		feed(check, 72, 0, 60);
		expect(check.getState().verdict).not.toBe("measured");
		expect(check.getState().bpm).toBeNull();
	});

	it("reports nothing before it has enough evidence", () => {
		const check = new PulseCheck();
		feed(check, 72, 0.01, 10);
		expect(check.getState().bpm).toBeNull();
	});

	it("ignores frames without three regions", () => {
		const check = new PulseCheck();
		check.push(0, [{ r: 1, g: 1, b: 1 }]);
		expect(check.getState().verdict).toBe("unknown");
	});
});
