import { FOLLOW_RESUME_MS, PulseCheck, shownPulseBpm } from "../pulseCheck";
import { RecordingPulseCheck, replayPulseCheck } from "../pulseCheckRecording";
import { sessionPulseCheck } from "../rppgSession";

// A camera restart (the camera ended while the page was hidden, an HD fallback, a switch away from an infrared camera)
// makes a new check, and the frames of the new camera run on a new clock. The rate proven before it is handed over on
// the wall clock (resumePoint, then pulseCheckResume), so the same heart shows again about 6 s after the restart, as it
// does after a break that keeps the camera (followRecent across a break), instead of 16 s.
const RULES = { moreReadings: true, followRecent: true, blinkGate: false } as const;
let seed = 11;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5);
function feed(c: PulseCheck, t0Ms: number, seconds: number, bpm: number, every?: (s: number) => void) {
	for (let i = 0; i < 30 * seconds; i++) {
		const s = i / 30;
		const p = Math.sin(2 * Math.PI * bpm / 60 * s) * 0.004 + rnd() * 0.004;
		const px = { r: 0.6 - p * 0.3, g: 0.4 + p, b: 0.35 - p * 0.2 };
		c.push(t0Ms + s * 1000, [px, px, px]);
		if (i % 30 === 0) every?.(i / 30);
	}
}
/** A check proven on 66 bpm, its resume point read at wall time `leftAt`. */
function proven(now: () => number) {
	seed = 11;
	const a = new PulseCheck({ rules: RULES, now });
	feed(a, 0, 40, 66);
	return a;
}
function after(b: PulseCheck, bpm = 66) {
	const shown: (number | null)[] = [];
	feed(b, 500_000, 15, bpm, () => {
		const v = shownPulseBpm(b.getState());
		shown.push(v);
		if (b instanceof RecordingPulseCheck) b.noteRead(v, null); // as the session's getMetrics does
	}); // a new camera: another clock
	return shown;
}

describe("followRecent across a camera restart (pulseCheckResume)", () => {
	it("a proven check hands over its rate on the wall clock; none before a number", () => {
		let wall = 1_000_000;
		const fresh = new PulseCheck({ rules: RULES, now: () => wall });
		expect(fresh.resumePoint()).toBeNull();
		const a = proven(() => wall);
		const r = a.resumePoint();
		expect(r).not.toBeNull();
		expect(Math.abs((r?.bpm ?? 0) - 66)).toBeLessThanOrEqual(3);
		expect(r?.atEpochMs).toBe(1_000_000);
		wall += 5000;
		expect(a.resumePoint()?.atEpochMs).toBe(1_000_000);
	});

	it("the new check shows the same heart within about 6 s; without the hand-over not for 14 s", () => {
		let wall = 1_000_000;
		const r = proven(() => wall).resumePoint();
		wall += 20_000; // 20 s from the last proven number to the new camera's first frame
		const without = after(new PulseCheck({ rules: RULES, now: () => wall }));
		const withIt = after(new PulseCheck({ rules: RULES, now: () => wall, resumeFrom: r }));
		expect(without.slice(0, 14).every((b) => b == null)).toBe(true);
		const first = withIt.findIndex((b) => b != null);
		expect(first).toBeGreaterThanOrEqual(5);
		expect(first).toBeLessThanOrEqual(9);
		expect(Math.abs((withIt[first] as number) - 66)).toBeLessThanOrEqual(6);
	});

	it("not when the hand-over is older than FOLLOW_RESUME_MS, not for a different heart, not with followRecent off", () => {
		let wall = 1_000_000;
		const r = proven(() => wall).resumePoint();
		wall += FOLLOW_RESUME_MS + 1000;
		expect(after(new PulseCheck({ rules: RULES, now: () => wall, resumeFrom: r })).slice(0, 14).every((b) => b == null)).toBe(true);
		wall = 1_010_000;
		expect(after(new PulseCheck({ rules: RULES, now: () => wall, resumeFrom: r }), 80).slice(0, 14).every((b) => b == null)).toBe(true);
		expect(after(new PulseCheck({ rules: { ...RULES, followRecent: false }, now: () => wall, resumeFrom: r })).slice(0, 14).every((b) => b == null)).toBe(true);
	});

	it("rejects a malformed hand-over", () => {
		expect(() => new PulseCheck({ rules: RULES, resumeFrom: { bpm: Number.NaN, atEpochMs: 0 } })).toThrow(RangeError);
		expect(() => new PulseCheck({ rules: RULES, resumeFrom: { bpm: 66, atEpochMs: Number.POSITIVE_INFINITY } })).toThrow(RangeError);
	});

	it("a recording keeps the hand-over on its own clock, and its replay shows what the page showed", () => {
		let wall = 1_000_000;
		const r = proven(() => wall).resumePoint();
		wall += 20_000;
		const rec = new RecordingPulseCheck({ rules: RULES, now: () => wall, resumeFrom: r });
		const live = after(rec);
		const recording = rec.getRecording();
		expect(recording.resume?.bpm).toBe(r?.bpm);
		expect(recording.resume?.t).toBe(500_000 - 20_000);
		const replay = replayPulseCheck(recording, { rules: RULES });
		expect(recording.dropped).toBe(0);
		expect(replay.reads.length).toBeGreaterThan(0);
		expect(replay.reads.every((x) => x.bpm === x.live)).toBe(true);
		expect(live.findIndex((b) => b != null)).toBeLessThanOrEqual(9);
		// Without the hand-over in the file, the replay would not show what the page showed.
		const { resume: _drop, ...bare } = recording;
		const stripped = replayPulseCheck(bare, { rules: RULES });
		expect(stripped.reads.every((x) => x.bpm === x.live)).toBe(false);
	});

	it("the session option reaches the check", () => {
		const r = { bpm: 66, atEpochMs: Date.now() };
		const c = sessionPulseCheck({ pulseCheckRules: RULES, pulseCheckResume: r, recordPulseCheckInputs: { seconds: 60 } });
		expect(c).not.toBeNull();
		expect(c?.resumePending).toBe(true);
		expect(sessionPulseCheck({ pulseCheckRules: RULES })?.resumePending).toBe(false);
	});
});
