import { PulseCheck } from "../pulseCheck";

// Rule roomLight (lane/wallroom step 3, off by default): a rate the room carries is withheld, judged as the wall is.
// The face carries a rhythm at `bpm` that the check reads as a pulse; no wall beside the face is handed over (as when
// the wall patch is too noisy to see the light), so only the room can witness a lamp.
function run(rules: { roomLight?: boolean }, room: "lamp" | "quiet" | "none", bpm = 72, seconds = 40) {
	const check = new PulseCheck({ rules });
	let s = 3;
	const noise = () => ((s = (s * 16807) % 2147483647) / 2147483647 - 0.5) * 0.4;
	const shown: number[] = [];
	let next = 1000;
	for (let t = 0; t <= seconds * 1000; t += 1000 / 30) {
		const p = 0.01 * Math.sin((2 * Math.PI * bpm * t) / 60000);
		const region = () => ({ r: 150 * (1 - 0.3 * p) + noise(), g: 120 * (1 - p) + noise(), b: 100 * (1 - 0.6 * p) + noise() });
		const g = room === "lamp" ? 1 + p : 1;
		const roomRgb = { r: (40 * g + noise()) / 255, g: (40 * g + noise()) / 255, b: (40 * g + noise()) / 255 };
		check.push(t, [region(), region(), region()], undefined, undefined, undefined, undefined, room === "none" ? undefined : { room: { left: { rgb: roomRgb, n: 5000 }, right: null } });
		if (t >= next) { const st = check.getState(); if (st.verdict === "measured" && st.bpm != null) shown.push(st.bpm); next += 1000; }
	}
	return { shown, state: check.getState() };
}

describe("rule roomLight", () => {
	it("is on by default; off, a room carrying the face's rhythm changes nothing", () => {
		expect(run({}, "lamp").shown).toEqual([]);
		expect(run({ roomLight: false }, "lamp").shown.length).toBeGreaterThan(0);
		expect(run({ roomLight: false }, "lamp").shown).toEqual(run({ roomLight: false }, "none").shown);
	});
	it("on, withholds a rate the room carries: the room is the light's witness", () => {
		const r = run({ roomLight: true }, "lamp");
		expect(r.shown).toEqual([]);
		expect(r.state.roomLine?.bpm).toBeCloseTo(72, -1);
	});
	it("on, leaves a pulse alone when the room is quiet or not handed over", () => {
		const quiet = run({ roomLight: true }, "quiet");
		expect(quiet.shown.length).toBeGreaterThan(0);
		expect(quiet.shown).toEqual(run({}, "quiet").shown);
		expect(run({ roomLight: true }, "none").shown).toEqual(run({}, "none").shown);
	});
});

// The room judged with its own bar (lane lampdef ROOM2): a room has no pulse, so its line only has to clear the room's
// own noise, not the wall's 6 dB. ROOM_MIN_SNR_DB is the 99th percentile of the room's line in the face rate's family
// on 150 MCD TUNE recordings without a lamp (2.46 dB).
import { roomCarries, ROOM_MIN_SNR_DB, resolvePulseCheckRules } from "../pulseCheck";
describe("the room's own bar", () => {
	const rules = resolvePulseCheckRules({ roomLight: true });
	it("withholds on a room line between its own bar and the wall's", () => {
		expect(ROOM_MIN_SNR_DB).toBeCloseTo(2.46, 2);
		expect(roomCarries({ bpm: 72, snrDb: 3 }, 72)).toBe(true);
		expect(roomCarries({ bpm: 36, snrDb: 3 }, 72)).toBe(false); // half the face's rate: the light family rule was deleted
	});
	it("does not withhold under the room's bar, at an unrelated rate, or without a room line", () => {
		expect(roomCarries({ bpm: 72, snrDb: 2 }, 72)).toBe(false);
		expect(roomCarries({ bpm: 80, snrDb: 9 }, 72)).toBe(false);
		expect(roomCarries(null, 72)).toBe(false);
	});
});
