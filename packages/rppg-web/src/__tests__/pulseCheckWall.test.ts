import { averageRgbInROINonSkin } from "../frameSource";
import { PulseCheck, wallPatchFromLandmarks } from "../pulseCheck";

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
	it("never lets the wall's rate out, not even for the first seconds", () => {
		const shown = feedStates(72, "same", 45).filter((st) => st.bpm != null);
		expect(shown).toHaveLength(0);
	});

	it("refuses a rate the wall beside the face also carries", () => {
		const check = new PulseCheck();
		feed(check, 72, "same", 45);
		expect(check.getState().bpm).toBeNull();
		expect(check.getState().verdict).toBe("not-measured");
		expect(check.getState().wallMatch).toBe(true);
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
