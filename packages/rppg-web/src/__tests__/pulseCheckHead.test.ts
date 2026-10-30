import { HEAD_LANDMARKS, headCentre } from "../pulseCheck";

// The head's centre from the face mesh's bone landmarks (headCentre), which the blink gate's head rows use.

describe("headCentre", () => {
	const mesh = (n: number) => Array.from({ length: n }, () => ({ x: 0.9, y: 0.05 }));

	it("is the centre of the bone landmarks in pixels, whatever the other points do", () => {
		const points = mesh(478);
		// The nine bone landmarks spread around (0.5, 0.5); every other point off in a corner.
		HEAD_LANDMARKS.forEach((i, k) => {
			points[i] = { x: 0.4 + 0.025 * k, y: 0.3 + 0.05 * k };
		});
		const c = headCentre(points, 640, 480);
		expect(c?.x).toBeCloseTo(320, 6);
		expect(c?.y).toBeCloseTo(240, 6);
		// The head 3 px lower: its centre 3 px lower.
		const lower = points.map((p, i) => (HEAD_LANDMARKS.includes(i) ? { x: p.x, y: p.y + 3 / 480 } : p));
		expect(headCentre(lower, 640, 480)?.y).toBeCloseTo(243, 6);
	});

	it("carries the face's width in pixels, cheekbone to cheekbone (234 to 454), however the head is tilted", () => {
		const points = mesh(478);
		HEAD_LANDMARKS.forEach((i) => {
			points[i] = { x: 0.5, y: 0.5 };
		});
		points[234] = { x: 0.35, y: 0.5 };
		points[454] = { x: 0.65, y: 0.5 };
		expect(headCentre(points, 640, 480)?.faceWidth).toBeCloseTo(192, 6);
		// Tilted: 192 px across and 36 px down.
		points[454] = { x: 0.65, y: 0.5 + 36 / 480 };
		expect(headCentre(points, 640, 480)?.faceWidth).toBeCloseTo(Math.hypot(192, 36), 6);
	});

	it("reads the 468-point mesh (no iris points) as well as the 478-point one", () => {
		expect(headCentre(mesh(468), 640, 480)).not.toBeNull();
		expect(headCentre(mesh(455), 640, 480)).not.toBeNull(); // the highest index used is 454
	});

	// The README's "Things to know": the rule needs MediaPipe's mesh. A 68-point face detector's
	// landmarks give no head, so a check handed them sees every window blind and shows no rate.

	it("is null for a mesh without every bone landmark, or a frame with no size", () => {
		expect(headCentre(mesh(454), 640, 480)).toBeNull();
		expect(headCentre([], 640, 480)).toBeNull();
		expect(headCentre(mesh(478), 0, 480)).toBeNull();
		expect(headCentre(mesh(478), 640, 0)).toBeNull();
	});
});
