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
		expect(d.view(4000 + PULSE_DISPLAY_LIVE_MS + 1)).toEqual({ kind: "recent", bpm: 66, agoS: 2 });
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
