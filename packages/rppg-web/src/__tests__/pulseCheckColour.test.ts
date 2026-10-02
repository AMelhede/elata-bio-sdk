import {
	estimateOwnPulse,
	OWN_PULSE_COLOUR_DAMAGE,
	type RawRoiSample,
} from "../pulseCheckCore";

// Three skin regions at 30 fps, 8-bit like a camera, with a pulse at `bpm` (chromatic: green
// drops most) and a room light swinging 2% at 96/min that brightens skin and wall alike.
// `blue` is the skin's mean blue level: a dark camera crushes it to a few units of 255.
function capture(opts: { bpm: number; blue: number; wall: boolean; seconds?: number }) {
	const { bpm, blue, wall, seconds = 20 } = opts;
	let s = 11;
	const noise = () => ((s = (s * 16807) % 2147483647) / 2147483647 - 0.5) * 2;
	const rows: RawRoiSample[] = [];
	for (let t = 0; t <= seconds * 1000; t += 1000 / 30) {
		const p = 0.008 * Math.sin((2 * Math.PI * bpm * t) / 60000);
		const light = 1 + 0.02 * Math.sin((2 * Math.PI * 96 * t) / 60000);
		const px = (v: number) => Math.round(v * light + noise());
		const region = () => [px(150 * (1 - 0.3 * p)), px(110 * (1 - p)), px(blue * (1 - 0.6 * p))];
		const w = wall ? [px(180), px(175), px(170)] : [Number.NaN, Number.NaN, Number.NaN];
		rows.push([t, ...region(), ...region(), ...region(), ...w] as RawRoiSample);
	}
	return rows;
}

describe("pulse check: colour-damage switch", () => {
	it("stays on POS for a clean camera, and finds the pulse", () => {
		const e = estimateOwnPulse(capture({ bpm: 66, blue: 90, wall: true }), 16);
		expect(e?.method).toBe("pos");
		expect(e?.colourDamage ?? 0).toBeLessThan(OWN_PULSE_COLOUR_DAMAGE);
		expect(Math.abs((e?.bpm ?? 0) - 66)).toBeLessThanOrEqual(4);
	});

	it("reads green minus the wall when the blue channel is crushed, and finds the pulse, not the light", () => {
		const e = estimateOwnPulse(capture({ bpm: 66, blue: 4, wall: true }), 16);
		expect(e?.colourDamage ?? 0).toBeGreaterThanOrEqual(OWN_PULSE_COLOUR_DAMAGE);
		expect(e?.method).toBe("greenMinusWall");
		expect(Math.abs((e?.bpm ?? 0) - 66)).toBeLessThanOrEqual(4);
	});

	it("keeps POS when the wall was not visible, however damaged the colour", () => {
		const e = estimateOwnPulse(capture({ bpm: 66, blue: 4, wall: false }), 16);
		expect(e?.method).toBe("pos");
	});
});
