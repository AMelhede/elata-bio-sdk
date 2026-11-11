import {
	SLOW_SWITCH_FPS,
	SLOW_SWITCH_RULES,
	SLOW_SWITCH_SECONDS,
	SLOW_SWITCH_WARMUP_MS,
	SlowSwitch,
} from "../slowSwitch";

// The slow-device switch's trigger (2026-11-11, owner: ship, off by default): the frames that reached pulse analysis in
// each whole second, under SLOW_SWITCH_FPS in SLOW_SWITCH_SECONDS seconds in a row, counted only while the face is
// tracked and the page visible, never in the first SLOW_SWITCH_WARMUP_MS. One way.

/** Frames at `fps` from `fromMs` for `seconds`, each handed to the switch; returns the times of the frames that switched it. */
function feed(
	s: SlowSwitch,
	fps: number,
	seconds: number,
	fromMs = 1000,
	tracked: (t: number) => boolean = () => true,
): number[] {
	const fired: number[] = [];
	const n = Math.floor(seconds * fps);
	for (let i = 0; i < n; i++) {
		const t = fromMs + (i * 1000) / fps;
		if (s.frame(t, tracked(t))) fired.push(t);
	}
	return fired;
}

describe("SlowSwitch trigger", () => {
	test("the tested settings: under 9 a second in 5 seconds in a row, after 3 s, tracker on the face patches", () => {
		expect([SLOW_SWITCH_FPS, SLOW_SWITCH_SECONDS, SLOW_SWITCH_WARMUP_MS]).toEqual([9, 5, 3000]);
		expect(SLOW_SWITCH_RULES).toEqual({ tracker: true, allPatches: true });
	});

	test("fires at a 7.5 fps clock once 5 counted seconds are over, at the first frame of the next second", () => {
		const s = new SlowSwitch({ visible: () => true });
		const fired = feed(s, 7.5, 20);
		expect(fired).toHaveLength(1);
		// Seconds 0 to 2 are warm-up; seconds 3 to 7 are slow; the first frame of second 8 switches it.
		expect(fired[0]).toBe(1000 + 8000);
		expect(s.switched).toBe(true);
		const r = s.record();
		// Seconds 3 to 7 held 7, 8, 7, 8 and 7 frames; seconds 8 to 17 averaged 7.5.
		expect(r).toEqual({ at_s: 8, fps_before: 7.4, fps_after_10s: 7.5, remembered: false });
	});

	test("does not fire at 10 fps", () => {
		const s = new SlowSwitch({ visible: () => true });
		expect(feed(s, 10, 60)).toEqual([]);
		expect(s.record()).toBeNull();
	});

	test("does not count the warm-up: 4 slow seconds then fast never fires, and slow warm-up seconds do not count", () => {
		const s = new SlowSwitch({ visible: () => true });
		// 7.5 fps for 7 s: seconds 3 to 6 are slow (4), then 10 fps.
		feed(s, 7.5, 7, 0);
		expect(feed(s, 10, 30, 7000)).toEqual([]);
		expect(s.switched).toBe(false);
	});

	test("not while the page is hidden", () => {
		const s = new SlowSwitch({ visible: () => false });
		expect(feed(s, 7.5, 30)).toEqual([]);
		expect(s.switched).toBe(false);
	});

	test("not while the face is lost: a second with a frame without a face breaks the run", () => {
		const s = new SlowSwitch({ visible: () => true });
		// The face is lost on one frame in every second from second 3 on: no second counts.
		const lostOnce = (t: number) => (t - 1000) % 1000 > 140 || t - 1000 < 3000;
		expect(feed(s, 7.5, 30, 1000, lostOnce)).toEqual([]);
		// No face at all: nothing reaches analysis, nothing starts.
		const none = new SlowSwitch({ visible: () => true });
		expect(feed(none, 7.5, 30, 1000, () => false)).toEqual([]);
		expect(none.record()).toBeNull();
	});

	test("a second with no frame at all breaks the run", () => {
		const s = new SlowSwitch({ visible: () => true });
		feed(s, 7.5, 7, 0);
		// Seconds 3 to 6 slow, then seconds 7 and 8 empty, then slow again from second 9: the run starts over after the
		// gap, so it switches at the first frame of second 14 (frame 38 of the second feed), not at the first of second 10.
		const fired = feed(s, 7.5, 12, 9000);
		expect(fired).toEqual([9000 + (38 * 1000) / 7.5]);
	});

	test("one way: it fires once, and a fast device afterwards does not switch it back", () => {
		const s = new SlowSwitch({ visible: () => true });
		const calls: unknown[] = [];
		s.onSwitch = (r) => calls.push(r);
		expect(feed(s, 7.5, 30)).toHaveLength(1);
		expect(feed(s, 30, 30, 31_000)).toEqual([]);
		expect(feed(s, 7.5, 30, 61_000)).toEqual([]);
		expect(s.switched).toBe(true);
		expect(calls).toHaveLength(1);
	});

	test("starts switched from memory: no trigger, no callback, the record says remembered", () => {
		const s = new SlowSwitch({ remembered: true, visible: () => true });
		const calls: unknown[] = [];
		s.onSwitch = (r) => calls.push(r);
		expect(s.switched).toBe(true);
		expect(s.record()).toEqual({ at_s: 0, fps_before: null, fps_after_10s: null, remembered: true });
		expect(feed(s, 7.5, 30)).toEqual([]);
		expect(calls).toEqual([]);
		expect(s.record()).toEqual({ at_s: 0, fps_before: null, fps_after_10s: 7.5, remembered: true });
	});

	test("the record is a copy", () => {
		const s = new SlowSwitch({ remembered: true });
		const r = s.record();
		if (r) r.at_s = 99;
		expect(s.record()?.at_s).toBe(0);
	});
});
