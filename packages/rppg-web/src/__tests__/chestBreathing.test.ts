import { DemoRunner } from "../demoRunner";
import { RppgSession } from "../rppgSession";
import {
	bandPass,
	breathingFromMotion,
	ChestMotion,
	type ChestSample,
	chestBox,
	verticalShift,
} from "../chestBreathing";

// Breathing from chest motion, by construction: each step is checked against an answer known in advance.

/** Shifts (frame-to-frame differences) of a displacement breathing at `bpm`, at `fps`, for `seconds`. */
function breathing(bpm: number, amp: number, fps = 30, seconds = 40, noise = 0): ChestSample[] {
	const out: ChestSample[] = [];
	let prev = 0;
	let seed = 3;
	const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) - 0.5;
	for (let i = 0; i < fps * seconds; i++) {
		const t = i / fps;
		const z = amp * Math.sin(2 * Math.PI * (bpm / 60) * t) + noise * rnd();
		out.push([t * 1000, z - prev]);
		prev = z;
	}
	return out;
}

describe("band-pass", () => {
	test("equals scipy.signal.filtfilt with butter(2, [0.1, 0.6], 'band', fs=4), to 1e-9", () => {
		const x = Array.from({ length: 40 }, (_, k) => Math.sin(0.37 * k) + 0.01 * k + 0.3 * Math.cos(1.9 * k));
		// scipy 1.x output for this input (filtfilt defaults: odd extension, 15 samples, lfilter_zi start).
		const want = [0.008097700176, 0.210264128433, 0.447549364566, 0.682608771494, 0.833406976455, 0.853642763528, 0.739180130866, 0.499626166197, 0.174767422613, -0.170542811132, -0.488684104876, -0.741753265694, -0.882765498487, -0.888983492552, -0.769018926306, -0.530857570554, -0.19657881282, 0.17957333435, 0.547417542739, 0.869637111559, 1.09643737408, 1.189797463462, 1.147551799254, 0.973739212239, 0.678224558775, 0.304883184054, -0.093922932589, -0.481544847367, -0.811415364382, -1.035789395483, -1.140784207816, -1.127085271008, -0.995553511508, -0.779499334242, -0.536445051006, -0.311864909734, -0.150982074668, -0.095668445662, -0.136893913778, -0.223124037114];
		const got = bandPass(x)!;
		expect(got).toHaveLength(40);
		got.forEach((v, i) => expect(Math.abs(v - want[i])).toBeLessThan(1e-9));
	});

	test("refuses a signal too short to pad", () => {
		expect(bandPass(Array.from({ length: 15 }, () => 1))).toBeNull();
	});
});

describe("breathing rate from motion", () => {
	test.each([9, 12, 15, 18, 24, 30])("a chest breathing %i times a minute reads within 1", (bpm) => {
		const o = breathingFromMotion(breathing(bpm, 0.01, 30, 40, 0.002), 40000);
		expect(o).not.toBeNull();
		expect(Math.abs(o!.rate - bpm)).toBeLessThanOrEqual(1);
		expect(o!.share).toBeGreaterThan(0.5);
	});

	test("reads the same at 15 frames a second as at 30", () => {
		const a = breathingFromMotion(breathing(16, 0.01, 30), 40000)!;
		const b = breathingFromMotion(breathing(16, 0.01, 15), 40000)!;
		expect(Math.abs(a.rate - b.rate)).toBeLessThanOrEqual(0.5);
	});

	test("a still chest gives no clear line", () => {
		const o = breathingFromMotion(breathing(15, 0, 30, 40, 0.002), 40000);
		expect(o == null || o.share < 0.5).toBe(true);
	});

	test("a window not covered gives nothing: under 90% of it, or under 10 samples a second", () => {
		expect(breathingFromMotion(breathing(15, 0.01, 30, 25), 40000)).toBeNull();
		expect(breathingFromMotion(breathing(15, 0.01, 8, 40), 40000)).toBeNull();
	});
});

describe("vertical shift", () => {
	const W = 80;
	const H = 60;
	// A smooth texture, sampled at a vertical offset: content moved down by `d` pixels.
	const tex = (d: number) => {
		const a = new Float32Array(W * H);
		for (let y = 0; y < H; y++)
			for (let x = 0; x < W; x++) a[y * W + x] = 100 + 40 * Math.sin(0.21 * (y - d) + 0.05 * x) + 25 * Math.cos(0.13 * (y - d) - 0.17 * x);
		return a;
	};
	test.each([0.1, 0.3, -0.25])("a %f pixel move reads within 5% of it", (d) => {
		const s = verticalShift(tex(0), tex(d), W, H)!;
		expect(Math.abs(s - d)).toBeLessThan(0.05 * Math.abs(d) + 0.005);
	});
	test("no texture, no answer", () => {
		expect(verticalShift(new Float32Array(W * H).fill(90), new Float32Array(W * H).fill(91), W, H)).toBeNull();
	});
});

describe("chest motion from frames", () => {
	const FW = 160;
	const FH = 120;
	// A face's landmarks (only their box is used): x 0.4..0.6, y 0.1..0.4 of the frame.
	const face = [
		{ x: 0.4, y: 0.1 },
		{ x: 0.6, y: 0.1 },
		{ x: 0.5, y: 0.4 },
		{ x: 0.4, y: 0.4 },
	];
	const frameAt = (t: number, bpm: number, ampPx: number) => {
		const data = new Uint8ClampedArray(FW * FH * 4);
		const d = ampPx * Math.sin(2 * Math.PI * (bpm / 60) * t);
		for (let y = 0; y < FH; y++)
			for (let x = 0; x < FW; x++) {
				const v = 120 + 50 * Math.sin(0.19 * (y - d) + 0.07 * x) + 20 * Math.cos(0.11 * (y - d));
				const i = (y * FW + x) * 4;
				data[i] = v;
				data[i + 1] = v;
				data[i + 2] = v;
				data[i + 3] = 255;
			}
		return { data, width: FW, height: FH, timestampMs: t * 1000 };
	};

	test("the box sits under the chin, 1.6 face widths wide, one face height tall", () => {
		const b = chestBox(face, FW, FH)!;
		expect(b.x0).toBe(Math.floor(80 - 0.8 * 32));
		expect(b.y0).toBe(Math.floor(48 + 0.15 * 36));
		expect(b.y1).toBe(Math.floor(48 + 1.15 * 36));
	});

	test("a chest moving 15 times a minute (half a pixel, 15 fps) reads 15 within 1; a still one gives no clear line", () => {
		const m = new ChestMotion();
		const still = new ChestMotion();
		for (let i = 0; i < 15 * 36; i++) {
			const t = i / 15;
			m.push(frameAt(t, 15, 0.5), face);
			still.push(frameAt(t, 15, 0), face);
		}
		const o = m.rate()!;
		expect(Math.abs(o.rate - 15)).toBeLessThanOrEqual(1);
		const s = still.rate();
		expect(s == null || s.share < 0.5).toBe(true);
	});

	test("a face gone for over a second drops the motion; a face that moves re-anchors the box", () => {
		const m = new ChestMotion();
		for (let i = 0; i < 15; i++) m.push(frameAt(i / 15, 15, 0.5), face);
		expect(m.getSamples().length).toBeGreaterThan(0);
		m.push(frameAt(1.1, 15, 0.5), null);
		m.push(frameAt(2.3, 15, 0.5), null);
		expect(m.getSamples()).toHaveLength(0);
		for (let i = 0; i < 15; i++) m.push(frameAt(3 + i / 15, 15, 0.5), face);
		const n = m.getSamples().length;
		m.push(frameAt(4.1, 15, 0.5), face.map((p) => ({ x: p.x + 0.12, y: p.y })));
		expect(m.getSamples().length).toBeLessThan(n);
	});
});

describe("wiring", () => {
	const face = [
		{ x: 0.4, y: 0.1 },
		{ x: 0.6, y: 0.1 },
		{ x: 0.5, y: 0.4 },
	];
	const frame = (t: number) => {
		const data = new Uint8ClampedArray(160 * 120 * 4);
		for (let i = 0; i < data.length; i += 4) {
			const y = Math.floor(i / 4 / 160);
			data[i] = data[i + 1] = data[i + 2] = 120 + 50 * Math.sin(0.19 * y + 0.01 * t);
			data[i + 3] = 255;
		}
		return { data, width: 160, height: 120, timestampMs: t, landmarks: face };
	};

	test("the runner feeds every analysed frame to the chest motion when one is given, and none when not", async () => {
		const src: { onFrame: ((f: unknown) => void) | null; start: () => Promise<void>; stop: () => Promise<void> } = { onFrame: null, start: async () => {}, stop: async () => {} };
		const proc = { pushSampleRgbMeta: jest.fn(), pushSampleRgb: jest.fn(), pushSample: jest.fn(), getMetrics: jest.fn(() => ({ bpm: null })) };
		const chest = new ChestMotion();
		const r = new DemoRunner(src as never, proc as never, { chestMotion: chest, multiRoiFusion: false });
		await r.start();
		for (let i = 0; i < 5; i++) src.onFrame!(frame(1000 + 33 * i) as never);
		expect(chest.getSamples().length).toBe(4);
		const plain = new DemoRunner({ ...src, onFrame: null } as never, proc as never, { multiRoiFusion: false });
		expect((plain as unknown as { opts: { chestMotion?: unknown } }).opts.chestMotion).toBeUndefined();
	});

	test("the session reports no chest breathing, and says so in its switches, unless asked", () => {
		const off = new RppgSession({} as never, { getMetrics: () => ({}) } as never, {} as never, "wasm", "face_mesh", {});
		expect(off.getChestBreathing()).toBeNull();
		expect(off.getChestMotionSamples()).toEqual([]);
		const chest = new ChestMotion();
		const on = new RppgSession({} as never, { getMetrics: () => ({}) } as never, { fixes: undefined } as never, "wasm", "face_mesh", { chestMotion: chest });
		expect(on.getBuildSwitches().chestBreathing).toBe(true);
		expect(off.getBuildSwitches().chestBreathing).toBe(false);
	});
});

describe("a window with holes, and a chest that goes out of view", () => {
	test("a window mostly missing gives nothing: 12 s of data at its two ends, or a stray sample and a 10 s burst", () => {
		// Each passes the older rules (span and sample count), and each is mostly a straight line across a hole.
		const full = breathing(15, 0.01, 30, 40);
		const ends = full.filter(([t]) => (t > 8000 && t <= 14000) || t >= 34000);
		expect(breathingFromMotion(ends, 40000)).toBeNull();
		const stray = [full.find(([t]) => t > 8100)!, ...full.filter(([t]) => t >= 30000)];
		expect(breathingFromMotion(stray, 40000)).toBeNull();
	});

	test("a short hole (2 s) still reads", () => {
		const full = breathing(15, 0.01, 30, 40);
		const o = breathingFromMotion(full.filter(([t]) => t < 20000 || t >= 22000), 40000);
		expect(o).not.toBeNull();
		expect(Math.abs(o!.rate - 15)).toBeLessThanOrEqual(1);
	});

	const FW = 160;
	const FH = 120;
	const face = [
		{ x: 0.4, y: 0.1 },
		{ x: 0.6, y: 0.1 },
		{ x: 0.5, y: 0.4 },
		{ x: 0.4, y: 0.4 },
	];
	// So close that the box below the chin falls outside the picture: a face, but no chest.
	const leaningIn = [
		{ x: 0.1, y: 0.2 },
		{ x: 0.9, y: 0.2 },
		{ x: 0.5, y: 0.99 },
	];
	const frameAt = (t: number, w = FW, h = FH) => {
		const data = new Uint8ClampedArray(w * h * 4);
		const d = 0.5 * Math.sin(2 * Math.PI * (15 / 60) * t);
		for (let y = 0; y < h; y++)
			for (let x = 0; x < w; x++) {
				const v = 120 + 50 * Math.sin(0.19 * (y - d) + 0.07 * x) + 20 * Math.cos(0.11 * (y - d));
				const i = (y * w + x) * 4;
				data[i] = data[i + 1] = data[i + 2] = v;
				data[i + 3] = 255;
			}
		return { data, width: w, height: h, timestampMs: t * 1000 };
	};

	test("a face with no chest in view for over a second drops the motion, and no rate is given", () => {
		const wall = { t: 0 };
		const m = new ChestMotion({ now: () => wall.t });
		for (let i = 0; i < 15 * 36; i++) {
			wall.t = (i * 1000) / 15;
			m.push(frameAt(i / 15), face);
		}
		expect(m.rate()).not.toBeNull();
		for (let i = 0; i < 15 * 120; i++) {
			wall.t = 36000 + (i * 1000) / 15;
			m.push(frameAt(36 + i / 15), leaningIn);
		}
		expect(m.getSamples()).toHaveLength(0);
		expect(m.rate()).toBeNull();
	});

	test("frames that stop: no rate while stopped, and no shift taken across the gap", () => {
		const wall = { t: 0 };
		const m = new ChestMotion({ now: () => wall.t });
		for (let i = 0; i < 15 * 36; i++) {
			wall.t = (i * 1000) / 15;
			m.push(frameAt(i / 15), face);
		}
		expect(m.rate()).not.toBeNull();
		wall.t += 20000; // the tab is hidden for 20 s: no frames at all
		expect(m.rate()).toBeNull();
		m.push(frameAt(56), face);
		m.push(frameAt(56 + 1 / 15), face);
		expect(m.getSamples().length).toBeLessThanOrEqual(1);
		expect(m.getSamples().every(([t]) => t >= 56000)).toBe(true);
	});

	test("a change of frame size re-anchors the box, even when the box barely moves", () => {
		const m = new ChestMotion();
		for (let i = 0; i < 15; i++) m.push(frameAt(i / 15), face);
		expect(m.getSamples().length).toBeGreaterThan(0);
		m.push(frameAt(1, FW + 10, FH), face); // 5 px of box movement, under the re-anchor distance
		expect(m.getSamples()).toHaveLength(0);
	});
});
