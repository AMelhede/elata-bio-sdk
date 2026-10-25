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
		check.push(t, [region(), region(), region()], undefined, undefined, undefined, undefined, room === "none" ? undefined : { room: { rgb: roomRgb, n: 5000 } });
		if (t >= next) { const st = check.getState(); if (st.verdict === "measured" && st.bpm != null) shown.push(st.bpm); next += 1000; }
	}
	return { shown, state: check.getState() };
}

describe("rule roomLight", () => {
	it("is off by default: a room carrying the face's rhythm changes nothing", () => {
		expect(run({}, "lamp").shown.length).toBeGreaterThan(0);
		expect(run({}, "lamp").shown).toEqual(run({}, "none").shown);
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
