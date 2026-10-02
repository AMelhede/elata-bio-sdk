import { PulseCheck, wallPatchFromLandmarks } from "../pulseCheck";

// Face regions with a rhythm at `bpm` (a real pulse is chromatic: green drops most), plus a
// patch of wall beside the face. `wall`: "same" carries the same rhythm (a pulsing lamp
// lights the wall too), "quiet" carries only noise, "none" means no wall was visible.
function feed(check: PulseCheck, bpm: number, wall: "same" | "quiet" | "none", seconds: number) {
	let s = 11;
	const noise = () => ((s = (s * 16807) % 2147483647) / 2147483647 - 0.5) * 0.4;
	for (let t = 0; t <= seconds * 1000; t += 1000 / 30) {
		const p = 0.01 * Math.sin((2 * Math.PI * bpm * t) / 60000);
		const region = () => ({ r: 150 * (1 - 0.3 * p) + noise(), g: 120 * (1 - p) + noise(), b: 100 * (1 - 0.6 * p) + noise() });
		const q = wall === "same" ? p : 0;
		const bg = { r: 90 * (1 + q) + noise(), g: 100 * (1 - 0.5 * q) + noise(), b: 110 * (1 + q) + noise() };
		check.push(t, [region(), region(), region()], wall === "none" ? undefined : bg);
	}
}

// Every state seen once a second, to catch a rate that leaks out before the wall check acts.
function feedStates(bpm: number, wall: "same" | "quiet", seconds: number) {
	const check = new PulseCheck();
	const states: ReturnType<PulseCheck["getState"]>[] = [];
	let s = 11;
	const noise = () => ((s = (s * 16807) % 2147483647) / 2147483647 - 0.5) * 0.4;
	let next = 1000;
	for (let t = 0; t <= seconds * 1000; t += 1000 / 30) {
		const p = 0.01 * Math.sin((2 * Math.PI * bpm * t) / 60000);
		const region = () => ({ r: 150 * (1 - 0.3 * p) + noise(), g: 120 * (1 - p) + noise(), b: 100 * (1 - 0.6 * p) + noise() });
		const q = wall === "same" ? p : 0;
		check.push(t, [region(), region(), region()], { r: 90 * (1 + q) + noise(), g: 100 * (1 - 0.5 * q) + noise(), b: 110 * (1 + q) + noise() });
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
