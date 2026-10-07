import { averageRgbInROINonSkin } from "../frameSource";
import { PulseCheck, WALL_GAPS, WallTracker, wallBesideFace, wallCarries, wallMissReason, wallPatchFromLandmarks } from "../pulseCheck";

// Face regions with a rhythm at `bpm` (a real pulse is chromatic: green drops most), plus a
// patch of grey wall beside the face. `wall`: "same" is a pulsing lamp, which scales a grey
// wall's R, G and B alike (a change the colour method cancels, so only brightness shows it);
// "leak" is the person's own pulse reaching the wall through a sliver of face edge (5% of the
// patch); "quiet" carries only noise; "none" means no wall was visible.
function greyWall(wall: "same" | "leak" | "quiet" | "none", p: number, noise: () => number) {
	const lamp = wall === "same" ? p : 0;
	const edge = wall === "leak" ? 0.05 : 0;
	const mix = (grey: number, skin: number, depth: number) => (1 - edge) * grey * (1 + lamp) + edge * skin * (1 - depth * p) + noise();
	return { r: mix(100, 150, 0.3), g: mix(100, 120, 1), b: mix(100, 100, 0.6) };
}

function feed(check: PulseCheck, bpm: number, wall: "same" | "leak" | "quiet" | "none", seconds: number) {
	let s = 11;
	const noise = () => ((s = (s * 16807) % 2147483647) / 2147483647 - 0.5) * 0.4;
	for (let t = 0; t <= seconds * 1000; t += 1000 / 30) {
		const p = 0.01 * Math.sin((2 * Math.PI * bpm * t) / 60000);
		const region = () => ({ r: 150 * (1 - 0.3 * p) + noise(), g: 120 * (1 - p) + noise(), b: 100 * (1 - 0.6 * p) + noise() });
		const bg = greyWall(wall, p, noise);
		check.push(t, [region(), region(), region()], wall === "none" ? undefined : bg);
	}
}

// Every state seen once a second, to catch a rate that leaks out before the wall check acts.
function feedStates(bpm: number, wall: "same" | "leak" | "quiet", seconds: number) {
	const check = new PulseCheck();
	const states: ReturnType<PulseCheck["getState"]>[] = [];
	let s = 11;
	const noise = () => ((s = (s * 16807) % 2147483647) / 2147483647 - 0.5) * 0.4;
	let next = 1000;
	for (let t = 0; t <= seconds * 1000; t += 1000 / 30) {
		const p = 0.01 * Math.sin((2 * Math.PI * bpm * t) / 60000);
		const region = () => ({ r: 150 * (1 - 0.3 * p) + noise(), g: 120 * (1 - p) + noise(), b: 100 * (1 - 0.6 * p) + noise() });
		check.push(t, [region(), region(), region()], greyWall(wall, p, noise));
		if (t >= next) {
			states.push(check.getState());
			next += 1000;
		}
	}
	return states;
}

describe("PulseCheck wall check", () => {
	it("sees a light at the edge of the band: 120 Hz mains filmed at 9 fps folds to 180", () => {
		// A lamp's line on the band's top edge (3.0 Hz) straddles it, so no in-band local maximum
		// exists; the wall must still be seen to carry it. Peak committed 180 on a face with no
		// pulse under exactly this light before the same fix (2026-10-07).
		for (const bpm of [180, 179, 42]) {
			let s = 7;
			const noise = () => ((s = (s * 16807) % 2147483647) / 2147483647 - 0.5) * 0.4;
			const wall: [number, number, number, number][] = [];
			for (let t = 0; t <= 30000; t += 1000 / 30) {
				const g = 1 + 0.03 * Math.sin((2 * Math.PI * bpm * t) / 60000);
				wall.push([t, 120 * g + noise(), 120 * g + noise(), 120 * g + noise()]);
			}
			expect(wallCarries(wall, 30000, bpm)).toBe(true);
		}
	});

	it("never lets the wall's rate out, not even for the first seconds", () => {
		const shown = feedStates(72, "same", 45).filter((st) => st.bpm != null);
		expect(shown).toHaveLength(0);
	});

	it("refuses a rate the wall beside the face also carries", () => {
		const check = new PulseCheck();
		feed(check, 72, "same", 45);
		expect(check.getState().bpm).toBeNull();
		expect(check.getState().verdict).toBe("not-measured");
		// Either the wall check withholds the rate, or (when this 8-bit, noisy synthetic colour
		// reads as damaged, OWN_PULSE_COLOUR_SWITCH) green minus the wall has already taken the
		// wall's rhythm out, so there is no rate left to withhold.
		const st = check.getState();
		expect(st.wallMatch || st.windowMethod === "greenMinusWall").toBe(true);
	});

	it("keeps a pulse that reaches the wall only through a sliver of face edge", () => {
		const check = new PulseCheck();
		feed(check, 72, "leak", 45);
		expect(check.getState().verdict).toBe("measured");
		expect(check.getState().wallMatch).toBe(false);
	});

	it("keeps a pulse the wall does not carry", () => {
		const check = new PulseCheck();
		feed(check, 72, "quiet", 45);
		expect(check.getState().verdict).toBe("measured");
		expect(Math.abs((check.getState().bpm ?? 0) - 72)).toBeLessThanOrEqual(2);
		expect(check.getState().wallMatch).toBe(false);
	});

	it("without a wall reading, behaves exactly as before", () => {
		const check = new PulseCheck();
		feed(check, 72, "none", 45);
		expect(check.getState().verdict).toBe("measured");
		expect(check.getState().wallMatch).toBe(false);
	});
});

// A face as a grid of points spanning the given normalized box.
function face(x0: number, x1: number, y0: number, y1: number) {
	const pts: { x: number; y: number }[] = [];
	for (let i = 0; i <= 20; i++) for (let j = 0; j <= 20; j++) pts.push({ x: x0 + ((x1 - x0) * i) / 20, y: y0 + ((y1 - y0) * j) / 20 });
	return pts;
}

describe("wallPatchFromLandmarks", () => {
	it("puts the patch beside the face, clear of it, at cheek height", () => {
		const p = wallPatchFromLandmarks(face(0.3, 0.6, 0.2, 0.8), 640, 480);
		expect(p).not.toBeNull();
		const faceLeft = 0.3 * 640;
		const faceRight = 0.6 * 640;
		// The right has more room (256 px against 192 px on the left), so it goes right.
		expect(p!.x).toBeGreaterThan(faceRight);
		expect(p!.y).toBeGreaterThan(0.2 * 480);
		expect(p!.y + p!.h).toBeLessThan(0.8 * 480);
		expect(p!.x + p!.w).toBeLessThanOrEqual(640);
		expect(p!.x).toBeGreaterThan(faceLeft);
	});

	it("returns null when the face fills the frame", () => {
		expect(wallPatchFromLandmarks(face(0.02, 0.98, 0.05, 0.95), 640, 480)).toBeNull();
	});
});

describe("averageRgbInROINonSkin", () => {
	// 10x10 frame: left half skin-coloured (200, 150, 120), right half grey wall (100, 100, 100).
	function frame() {
		const width = 10;
		const height = 10;
		const data = new Uint8ClampedArray(width * height * 4);
		for (let i = 0; i < width * height; i++) {
			const skin = i % width < 5;
			data.set(skin ? [200, 150, 120, 255] : [100, 100, 100, 255], i * 4);
		}
		return { data, width, height, timestampMs: 0 } as unknown as Parameters<typeof averageRgbInROINonSkin>[0];
	}

	it("averages only the pixels that do not look like skin", () => {
		const m = averageRgbInROINonSkin(frame(), 0, 0, 10, 10);
		expect(m).not.toBeNull();
		expect(m!.r).toBeCloseTo(100 / 255, 5);
		expect(m!.g).toBeCloseTo(100 / 255, 5);
	});

	it("returns null for a box that is all skin", () => {
		expect(averageRgbInROINonSkin(frame(), 0, 0, 5, 10)).toBeNull();
	});
});

describe("wallBesideFace", () => {
	// A turned head, as a side camera sees it: skin (cheek, ear, neck) carries on past the
	// face finder's points for `skinPast` of the face's width, then grey wall.
	function turnedHead(skinPast: number) {
		const width = 640;
		const height = 480;
		const faceRight = 0.35 * width;
		const fw = 0.25 * width;
		const data = new Uint8ClampedArray(width * height * 4);
		for (let i = 0; i < width * height; i++) {
			const skin = i % width < faceRight + skinPast * fw;
			data.set(skin ? [200, 150, 120, 255] : [100, 100, 100, 255], i * 4);
		}
		return { points: face(0.1, 0.35, 0.2, 0.8), frame: { data, width, height, timestampMs: 0 } as unknown as Parameters<typeof wallBesideFace>[1] };
	}

	it("finds the wall past skin that sticks out beyond the face's points", () => {
		const { points, frame } = turnedHead(0.3);
		const w = wallBesideFace(points, frame, 0);
		expect(w).not.toBeNull();
		expect(w!.rgb.g).toBeCloseTo(100 / 255, 3);
		expect(WALL_GAPS[w!.gapIndex]).toBeGreaterThan(0.3);
	});

	it("keeps the same distance while it still shows wall, so the wall is one patch, not several", () => {
		const { points, frame } = turnedHead(0);
		expect(wallBesideFace(points, frame, 2)!.gapIndex).toBe(2);
	});

	it("returns null when every distance shows skin", () => {
		const { points, frame } = turnedHead(5);
		expect(wallBesideFace(points, frame, 0)).toBeNull();
	});
});

describe("why the wall was not seen", () => {
	it("says no room when the face fills the frame", () => {
		expect(wallMissReason(face(0.02, 0.98, 0.05, 0.95), 640, 480)).toBe("no-room");
	});

	it("says skin when there is room but every patch looks like skin", () => {
		expect(wallMissReason(face(0.1, 0.35, 0.2, 0.8), 640, 480)).toBe("skin");
	});

	it("counts, per one-second window, the frames with the wall seen and why it was missed", () => {
		const check = new PulseCheck();
		const region = { r: 150, g: 120, b: 100 };
		const wall = { r: 100, g: 100, b: 100 };
		for (let t = 0; t <= 2000; t += 50) {
			const k = Math.round(t / 50) % 4;
			check.push(t, [region, region, region], k === 0 ? wall : undefined, k === 1 ? "no-room" : k >= 2 ? "skin" : undefined);
		}
		const f = check.getState().wallFrames;
		expect(f).toBeDefined();
		expect(f!.seen + f!.noRoom + f!.skin).toBe(20);
		expect(f!.seen).toBe(5);
		expect(f!.noRoom).toBe(5);
		expect(f!.skin).toBe(10);
	});
});

describe("WallTracker: the wall as one signal across patches", () => {
	// The wall seen through two patches at different distances (a darker and a brighter part of
	// the room), switching every 2 s, both under one lamp swinging 1% at 72/min.
	function series(tracker: WallTracker) {
		const out: number[] = [];
		for (let t = 0; t <= 20000; t += 1000 / 30) {
			const lamp = 1 + 0.01 * Math.sin((2 * Math.PI * 72 * t) / 60000);
			const gap = Math.floor(t / 2000) % 2;
			const level = gap === 0 ? 0.4 : 0.63;
			const rgb = tracker.continuous(gap, { r: level * lamp, g: level * lamp, b: level * lamp });
			out.push(rgb.r + rgb.g + rgb.b);
		}
		return out;
	}

	it("does not step when the patch changes", () => {
		const s = series(new WallTracker());
		const steps = s.slice(1).map((v, i) => Math.abs(v - s[i]));
		const mean = s.reduce((a, v) => a + v, 0) / s.length;
		// A 1% swing at 72/min moves at most 1% x 2 pi x 1.2 Hz / 30 fps = 0.25% of the level per
		// frame; switching between the raw patches (0.4 and 0.63) would step by about 45%.
		expect(Math.max(...steps) / mean).toBeLessThan(0.003);
	});

	it("keeps the lamp's swing", () => {
		const s = series(new WallTracker());
		const mean = s.reduce((a, v) => a + v, 0) / s.length;
		const sd = Math.sqrt(s.reduce((a, v) => a + (v - mean) ** 2, 0) / s.length);
		// A 1% sine has a standard deviation of 0.71% of its level.
		expect(sd / mean).toBeGreaterThan(0.005);
		expect(sd / mean).toBeLessThan(0.009);
	});
});
