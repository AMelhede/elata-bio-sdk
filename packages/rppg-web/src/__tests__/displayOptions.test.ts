import { PULSE_DISPLAY_HYST_HOLD_MS, PULSE_DISPLAY_MEDIAN_MS, PulseDisplay } from "../pulseDisplay";

// PulseDisplay medianMs and hystBpm (2026-11-11): the display stages as options, so a display that changes less (one
// smoother where the tracker already smooths) can be built and replayed without a new class. Defaults are today's.

const live = (d: PulseDisplay, t: number) => {
	const v = d.view(t);
	return v.kind === "live" ? v.bpm : null;
};

describe("PulseDisplay medianMs: how far back the median on screen reaches", () => {
	test("left out it is PULSE_DISPLAY_MEDIAN_MS, so the default display is unchanged", () => {
		expect(PULSE_DISPLAY_MEDIAN_MS).toBe(5000);
		const a = new PulseDisplay();
		const b = new PulseDisplay({ medianMs: PULSE_DISPLAY_MEDIAN_MS });
		for (const [t, v] of [[0, 60], [1000, 61], [2000, 60], [3000, 80], [4000, 80]] as const) {
			a.push(t, v);
			b.push(t, v);
			expect(live(b, t)).toBe(live(a, t));
		}
	});

	test("2000 ms: the median of the last 2 s only, where the default still holds the older numbers", () => {
		const d = new PulseDisplay();
		const short = new PulseDisplay({ medianMs: 2000 });
		for (const [t, v] of [[0, 60], [1000, 60], [2000, 60], [3000, 80], [4000, 80]] as const) {
			d.push(t, v);
			short.push(t, v);
		}
		expect(live(d, 4000)).toBe(60);
		expect(live(short, 4000)).toBe(80);
	});

	test("0: the newest number alone", () => {
		const d = new PulseDisplay({ medianMs: 0 });
		for (const [t, v] of [[0, 60], [1000, 60], [2000, 90]] as const) d.push(t, v);
		expect(live(d, 2000)).toBe(90);
	});

	test("a negative or non-finite length is refused", () => {
		expect(() => new PulseDisplay({ medianMs: -1 })).toThrow(RangeError);
		expect(() => new PulseDisplay({ medianMs: Number.NaN })).toThrow(RangeError);
	});
});

describe("PulseDisplay hystBpm: the number on screen changes only by hystBpm or more, or by less held 3 s the same way", () => {
	const arm = { follow: 1, showEveryMs: 1000, medianMs: 0, hystBpm: 2 };

	test("a 1 bpm change waits PULSE_DISPLAY_HYST_HOLD_MS; without hystBpm it shows at once", () => {
		expect(PULSE_DISPLAY_HYST_HOLD_MS).toBe(3000);
		const plain = new PulseDisplay({ follow: 1, showEveryMs: 1000, medianMs: 0 });
		const hyst = new PulseDisplay(arm);
		const seenPlain: (number | null)[] = [];
		const seenHyst: (number | null)[] = [];
		plain.push(0, 70);
		hyst.push(0, 70);
		for (let t = 1000; t <= 5000; t += 1000) {
			plain.push(t, 71);
			hyst.push(t, 71);
			seenPlain.push(live(plain, t));
			seenHyst.push(live(hyst, t));
		}
		expect(seenPlain).toEqual([71, 71, 71, 71, 71]);
		// 71 first arrives at 1 s; it has differed for 3 s at 4 s.
		expect(seenHyst).toEqual([70, 70, 70, 71, 71]);
	});

	test("a change of hystBpm or more shows at once", () => {
		const d = new PulseDisplay(arm);
		d.push(0, 70);
		d.push(1000, 72);
		expect(live(d, 1000)).toBe(72);
		d.push(2000, 70);
		expect(live(d, 2000)).toBe(70);
	});

	test("a 1 bpm wobble that comes back never moves the number", () => {
		const d = new PulseDisplay(arm);
		const seen: (number | null)[] = [];
		const series = [70, 71, 70, 71, 70, 71, 70, 71];
		series.forEach((v, i) => {
			d.push(i * 1000, v);
			seen.push(live(d, i * 1000));
		});
		expect(seen).toEqual(series.map(() => 70));
	});

	test("a small change in the other direction starts the wait over", () => {
		const d = new PulseDisplay(arm);
		const seen: (number | null)[] = [];
		[70, 71, 71, 69, 69, 69, 69].forEach((v, i) => {
			d.push(i * 1000, v);
			seen.push(live(d, i * 1000));
		});
		// +1 from 1 s, then -1 from 3 s: the -1 has held 3 s at 6 s.
		expect(seen).toEqual([70, 70, 70, 70, 70, 70, 69]);
	});

	test("0 (the default) is off, and a negative value is refused", () => {
		const a = new PulseDisplay({ follow: 1, showEveryMs: 1000, medianMs: 0 });
		const b = new PulseDisplay({ follow: 1, showEveryMs: 1000, medianMs: 0, hystBpm: 0 });
		for (const [t, v] of [[0, 70], [1000, 71], [2000, 70]] as const) {
			a.push(t, v);
			b.push(t, v);
			expect(live(b, t)).toBe(live(a, t));
		}
		expect(() => new PulseDisplay({ hystBpm: -1 })).toThrow(RangeError);
	});
});
