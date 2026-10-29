import { LIGHT_CLIP_MAX, LIGHT_DIM_LUMA, LIGHT_DIM_LUMA_CENTRE, LIGHT_LATCH_MS, LIGHT_START, RED_CLIP_LEVEL, centreLightFromFrame, faceLightFromFrame, lightAfter } from "../lightLevel";
import { RecordingPulseCheck, parsePulseCheckRecording, replayPulseCheck, serializePulseCheckRecording } from "../pulseCheckRecording";
import { shownPulseBpm } from "../pulseCheck";

// Session switch light: how much light the screen should put on the face (lightLevel.ts).

const dim = { luma: LIGHT_DIM_LUMA - 0.1, redClip: 0, source: "face" as const };
const lit = { luma: LIGHT_DIM_LUMA + 0.1, redClip: 0, source: "face" as const };
const burnt = { luma: 0.6, redClip: LIGHT_CLIP_MAX, source: "face" as const };

describe("lightAfter", () => {
	it("asks for full light once the face reads dim for 2 s, and not before", () => {
		let s = lightAfter(LIGHT_START, dim, 0, 0);
		expect(s.level).toBe(0);
		s = lightAfter(s, dim, 0, LIGHT_LATCH_MS - 1);
		expect(s.level).toBe(0);
		s = lightAfter(s, dim, 0, LIGHT_LATCH_MS);
		expect(s.level).toBe(1);
	});

	it("a camera settling dark for under 2 s does not light", () => {
		let s = lightAfter(LIGHT_START, dim, 0, 0);
		s = lightAfter(s, dim, 0, 1600);
		s = lightAfter(s, lit, 0, 1700);
		expect(s).toEqual(LIGHT_START);
		expect(lightAfter(s, dim, 0, 1800).level).toBe(0);
	});

	it("full light that brightens the face never switches back off (Peak 2026-09-24)", () => {
		const on = { level: 1 as const, darkSince: 0, clipSince: null };
		expect(lightAfter(on, lit, 1, 10_000).level).toBe(1);
	});

	it("steps down to half once the rendered full light burns the face out for 2 s, and stays there", () => {
		let s = { level: 1 as const, darkSince: 0, clipSince: null } as Parameters<typeof lightAfter>[0];
		s = lightAfter(s, burnt, 1, 5000);
		s = lightAfter(s, burnt, 1, 5000 + LIGHT_LATCH_MS - 1);
		expect(s.level).toBe(1);
		s = lightAfter(s, burnt, 1, 5000 + LIGHT_LATCH_MS);
		expect(s.level).toBe(0.5);
		// Half light lowers the clipping, and a dim face again: neither sends it back up.
		expect(lightAfter(s, lit, 0.5, 20_000).level).toBe(0.5);
		expect(lightAfter(s, dim, 0.5, 40_000).level).toBe(0.5);
	});

	it("never asks an app that did not render full light to light less", () => {
		let s = { level: 1 as const, darkSince: 0, clipSince: null } as Parameters<typeof lightAfter>[0];
		for (let t = 0; t <= 10_000; t += 100) s = lightAfter(s, burnt, 0, t);
		expect(s.level).toBe(1);
	});

	it("a short burst of clipping does not step down", () => {
		let s = { level: 1 as const, darkSince: 0, clipSince: null } as Parameters<typeof lightAfter>[0];
		s = lightAfter(s, burnt, 1, 0);
		s = lightAfter(s, burnt, 1, 1600);
		s = lightAfter(s, { luma: 0.5, redClip: 0.1, source: "face" }, 1, 1700);
		s = lightAfter(s, burnt, 1, 1800);
		expect(lightAfter(s, burnt, 1, 1800 + LIGHT_LATCH_MS - 1).level).toBe(1);
	});

	it("no face, or a broken measurement, leaves the level as it is", () => {
		const on = { level: 1 as const, darkSince: 0, clipSince: null };
		expect(lightAfter(on, null, 1, 10_000)).toBe(on);
		expect(lightAfter(LIGHT_START, { luma: Number.NaN, redClip: 0, source: "face" }, 0, 10_000)).toBe(LIGHT_START);
	});
});

describe("with no face found, the centre of the picture stands in, on its own bar", () => {
	it("a centre reading under 0.38 for 2 s lights; one between 0.38 and the face bar does not", () => {
		const dark = { luma: LIGHT_DIM_LUMA_CENTRE - 0.05, redClip: 0, source: "centre" as const };
		const mid = { luma: (LIGHT_DIM_LUMA_CENTRE + LIGHT_DIM_LUMA) / 2, redClip: 0, source: "centre" as const };
		expect(lightAfter(lightAfter(LIGHT_START, dark, 0, 0), dark, 0, LIGHT_LATCH_MS).level).toBe(1);
		expect(lightAfter(lightAfter(LIGHT_START, mid, 0, 0), mid, 0, LIGHT_LATCH_MS).level).toBe(0);
	});
	it("reads the plain luma and red clip of the centre box", () => {
		const W = 20;
		const H = 20;
		const data = new Uint8ClampedArray(W * H * 4).fill(255);
		for (let i = 0; i < data.length; i += 4) {
			data[i] = 51;
			data[i + 1] = 51;
			data[i + 2] = 51;
		}
		const c = centreLightFromFrame(data, W, H)!;
		expect(c.source).toBe("centre");
		expect(c.luma).toBeCloseTo(0.2, 6);
		expect(c.redClip).toBe(0);
	});
});

describe("faceLightFromFrame", () => {
	it("counts red clipping over every pixel in the boxes, skin or not, and luma from the given means", () => {
		const W = 40;
		const H = 20;
		const data = new Uint8ClampedArray(W * H * 4);
		for (let y = 0; y < H; y++)
			for (let x = 0; x < W; x++) {
				const i = (y * W + x) * 4;
				// Left half burnt white, right half ordinary skin.
				data[i] = x < W / 2 ? 255 : 180;
				data[i + 1] = x < W / 2 ? 255 : 120;
				data[i + 2] = x < W / 2 ? 255 : 100;
				data[i + 3] = 255;
			}
		const f = faceLightFromFrame(data, W, [{ x: 0, y: 0, w: W, h: H }], [{ r: 0.6, g: 0.4, b: 0.3 }]);
		expect(f!.redClip).toBeCloseTo(0.5, 5);
		expect(f!.luma).toBeCloseTo(0.2126 * 0.6 + 0.7152 * 0.4 + 0.0722 * 0.3, 9);
		expect(RED_CLIP_LEVEL).toBe(250);
	});

	it("null with no box or no pixel", () => {
		expect(faceLightFromFrame(new Uint8ClampedArray(16), 2, [], [{ r: 0, g: 0, b: 0 }])).toBeNull();
		expect(faceLightFromFrame(new Uint8ClampedArray(16), 2, [{ x: 5, y: 5, w: 0, h: 0 }], [{ r: 0, g: 0, b: 0 }])).toBeNull();
	});
});

describe("a recording with the light switch keeps the face light and both levels, and replays unchanged", () => {
	function feed(check: RecordingPulseCheck, withLight: boolean) {
		const live: (number | null)[] = [];
		for (let i = 0; i < 30 * 40; i++) {
			const t = (i * 1000) / 30;
			const p = Math.sin((2 * Math.PI * 1.2 * t) / 1000);
			const region = () => ({ r: 0.6 * (1 + 0.002 * p), g: 0.4 * (1 + 0.006 * p), b: 0.3 * (1 + 0.003 * p) });
			const before = check.evaluations;
			check.push(t, [region(), region(), region()], undefined, undefined, undefined, undefined, withLight ? { light: { face: { luma: 0.4123456789, redClip: 0.25 }, wanted: 1, applied: 1 } } : undefined);
			if (check.evaluations !== before) live.push(shownPulseBpm(check.getState()));
		}
		return live;
	}
	it("writes [luma, red clip, asked, rendered] after a null forehead box, and the same numbers replay", () => {
		const a = new RecordingPulseCheck({ rules: { moreReadings: true } });
		const live = feed(a, true);
		const fa = a.getRecording().events.find((e) => e[0] === "f")!;
		expect(fa.length).toBe(11);
		expect(fa[9]).toBeNull();
		expect(fa[10]).toEqual([0.412346, 0.25, 1, 1]);
		const back = parsePulseCheckRecording(serializePulseCheckRecording(a.getRecording()));
		const replayed = replayPulseCheck(back).evaluations.map((e) => e.bpm);
		expect(replayed).toEqual(live);
		const b = new RecordingPulseCheck({ rules: { moreReadings: true } });
		expect(feed(b, false)).toEqual(live);
		expect(b.getRecording().events.find((e) => e[0] === "f")!.length).toBe(9);
	});
});
