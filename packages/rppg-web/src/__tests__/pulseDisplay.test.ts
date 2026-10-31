import { PULSE_DISPLAY_LIVE_MS, PULSE_DISPLAY_MEDIAN_MS, PULSE_DISPLAY_RECENT_MS, PulseDisplay } from "../pulseDisplay";

// What the screen shows from the check's shown numbers: the median of the last 5 s of numbers, updated every second,
// greyed as "recent" when no fresh number arrives, then the last reading with its age. Every app shows the same.

describe("PulseDisplay", () => {
	it("measures until the first number, then shows it at once", () => {
		const d = new PulseDisplay();
		d.push(0, null);
		expect(d.view(0)).toEqual({ kind: "measuring" });
		d.push(1000, 70);
		expect(d.view(1000)).toEqual({ kind: "live", bpm: 70 });
	});

	it("shows the median of the numbers of the last 5 s, so one stray number does not move it", () => {
		const d = new PulseDisplay();
		for (const [t, b] of [[0, 70], [1000, 71], [2000, 90], [3000, 70], [4000, 72]] as const) d.push(t, b);
		expect(d.view(4000)).toEqual({ kind: "live", bpm: 71 });
	});

	it("forgets numbers older than the median window", () => {
		const d = new PulseDisplay();
		for (let t = 0; t < 5000; t += 1000) d.push(t, 60);
		for (let t = 5000; t < 5000 + PULSE_DISPLAY_MEDIAN_MS; t += 1000) d.push(t, 80);
		expect(d.view(9000)).toEqual({ kind: "live", bpm: 80 });
	});

	it("greys the last value as recent when numbers stop, then shows it as the last reading with its age", () => {
		const d = new PulseDisplay();
		for (let t = 0; t <= 4000; t += 1000) d.push(t, 66);
		d.push(5000, null);
		expect(d.view(4000 + PULSE_DISPLAY_LIVE_MS)).toEqual({ kind: "live", bpm: 66 });
		expect(PULSE_DISPLAY_LIVE_MS).toBe(5000);
		expect(d.view(4000 + PULSE_DISPLAY_LIVE_MS + 1)).toEqual({ kind: "recent", bpm: 66, agoS: 5 });
		expect(d.view(4000 + PULSE_DISPLAY_RECENT_MS)).toEqual({ kind: "recent", bpm: 66, agoS: 10 });
		expect(d.view(4000 + PULSE_DISPLAY_RECENT_MS + 1000)).toEqual({ kind: "last", bpm: 66, agoS: 11 });
	});

	it("keeps the last value across a gap and resumes from fresh numbers only", () => {
		const d = new PulseDisplay();
		d.push(0, 60);
		d.push(30_000, 75);
		expect(d.view(30_000)).toEqual({ kind: "live", bpm: 75 });
	});

	it("ignores non-finite numbers and starts over on reset", () => {
		const d = new PulseDisplay();
		d.push(0, Number.NaN);
		expect(d.view(0)).toEqual({ kind: "measuring" });
		d.push(1000, 70);
		d.reset();
		expect(d.view(1000)).toEqual({ kind: "measuring" });
	});
});

describe('PulseDisplay follow: the shown number moves part of the way to each new median', () => {
	// Received recordings and a public lab set (2026-10-31): follow 0.6 cut updates over 5 bpm from 23% to 10% on
	// a Mac, 6% to 2% on laptops, 7% to 0% on phones and 10.8% to 6.0% in the lab, keeping every watch reference within
	// the bar (laptop 32/33, phone 15/15) and lab within-bar 80.8% to 80.4%.
	test('a jump from 60 to 70 shows 66 first, then closes in', () => {
		const d = new PulseDisplay({ showEveryMs: 5000, follow: 0.6 });
		for (let t = 0; t <= 4000; t += 1000) d.push(t, 60);
		expect(d.view(4000)).toEqual({ kind: 'live', bpm: 60 });
		for (let t = 5000; t <= 10000; t += 1000) d.push(t, 70);
		expect(d.view(10000)).toEqual({ kind: 'live', bpm: 66 });
		for (let t = 11000; t <= 15000; t += 1000) d.push(t, 70);
		expect(d.view(15000)).toEqual({ kind: 'live', bpm: 68 });
	});
	test('without follow (or follow 1) the number goes straight to the median, as before', () => {
		for (const opts of [{ showEveryMs: 5000 }, { showEveryMs: 5000, follow: 1 }]) {
			const d = new PulseDisplay(opts);
			for (let t = 0; t <= 4000; t += 1000) d.push(t, 60);
			for (let t = 5000; t <= 10000; t += 1000) d.push(t, 70);
			expect(d.view(10000)).toEqual({ kind: 'live', bpm: 70 });
		}
	});
	test('after a break of over 15 s the first number is the median itself, not a step from an old one', () => {
		const d = new PulseDisplay({ showEveryMs: 5000, follow: 0.6 });
		for (let t = 0; t <= 4000; t += 1000) d.push(t, 60);
		for (let t = 25000; t <= 29000; t += 1000) d.push(t, 80);
		expect(d.view(29000)).toEqual({ kind: 'live', bpm: 80 });
	});
	test('a follow outside (0, 1] is refused', () => {
		expect(() => new PulseDisplay({ follow: 0 })).toThrow(RangeError);
		expect(() => new PulseDisplay({ follow: 1.5 })).toThrow(RangeError);
	});
});
