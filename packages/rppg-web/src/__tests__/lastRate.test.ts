import { LAST_RATE_KEY, LAST_RATE_MAX_AGE_MS, lastReadingResume, readLastReading, writeLastReading } from "../lastRate";
import { PulseDisplay } from "../pulseDisplay";

// The last proven rate kept between sessions (rememberRate) and shown with its age until a new number exists, as Apple's
// Heart Rate app shows the latest reading and when it was taken.
const mem = () => {
	const m = new Map<string, string>();
	return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
};

describe("lastRate: the kept reading", () => {
	it("comes back within LAST_RATE_MAX_AGE_MS, and as a hand-over with that age limit", () => {
		const s = mem();
		writeLastReading(s, { bpm: 66.04, atEpochMs: 1_000_000 });
		expect(readLastReading(s, 1_000_000 + 3_600_000)).toEqual({ bpm: 66, atEpochMs: 1_000_000 });
		expect(lastReadingResume(readLastReading(s, 1_000_000))).toEqual({ bpm: 66, atEpochMs: 1_000_000, maxAgeMs: LAST_RATE_MAX_AGE_MS });
		expect(readLastReading(s, 1_000_000 + LAST_RATE_MAX_AGE_MS + 1)).toBeNull();
		expect(readLastReading(s, 999_999)).toBeNull();
		expect(lastReadingResume(null)).toBeNull();
	});
	it("nothing kept, junk, or storage that throws: null, never an error", () => {
		expect(readLastReading(mem(), 0)).toBeNull();
		const s = mem();
		s.m.set(LAST_RATE_KEY, "not json");
		expect(readLastReading(s, 0)).toBeNull();
		const bad = { getItem: () => { throw new Error("denied"); }, setItem: () => { throw new Error("denied"); } };
		expect(readLastReading(bad, 0)).toBeNull();
		expect(() => writeLastReading(bad, { bpm: 60, atEpochMs: 0 })).not.toThrow();
		expect(readLastReading(null, 0)).toBeNull();
	});
});

describe("PulseDisplay.setLast: the last reading with its age until this session has a number", () => {
	it("shows the last reading and its age, then the first new number replaces it", () => {
		const d = new PulseDisplay();
		expect(d.view(1000)).toEqual({ kind: "measuring" });
		d.setLast({ bpm: 61.6, atMs: 0 });
		expect(d.view(600_000)).toEqual({ kind: "last", bpm: 62, agoS: 600 });
		d.push(600_500, 70);
		expect(d.view(600_600)).toEqual({ kind: "live", bpm: 70 });
	});
	it("ignores a malformed or future reading; null clears it", () => {
		const d = new PulseDisplay();
		d.setLast({ bpm: Number.NaN, atMs: 0 });
		expect(d.view(1000)).toEqual({ kind: "measuring" });
		d.setLast({ bpm: 60, atMs: 5000 });
		expect(d.view(1000)).toEqual({ kind: "measuring" });
		d.setLast({ bpm: 60, atMs: 0 });
		d.setLast(null);
		expect(d.view(1000)).toEqual({ kind: "measuring" });
	});
});
