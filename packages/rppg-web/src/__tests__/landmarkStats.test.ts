import { sortedLandmarkAxes } from "../landmarkStats";

// The sorted landmark axes are cached per landmark array. A face finder that hands back the same array
// with its points rewritten (a custom source reusing one buffer) must get fresh axes, not the last face's.

function face(dx: number): { x: number; y: number }[] {
	return Array.from({ length: 478 }, (_, i) => ({ x: 0.3 + 0.4 * ((i * 37) % 478) / 478 + dx, y: 0.2 + 0.5 * ((i * 91) % 478) / 478 }));
}

function sortedCopy(points: { x: number; y: number }[]) {
	const xs = points.map((p) => Math.min(1, Math.max(0, p.x))).sort((a, b) => a - b);
	const ys = points.map((p) => Math.min(1, Math.max(0, p.y))).sort((a, b) => a - b);
	return { xs, ys };
}

test("equals a plain sort of the clamped coordinates", () => {
	const pts = face(0);
	pts[3] = { x: -0.2, y: 1.4 };
	const got = sortedLandmarkAxes(pts)!;
	const want = sortedCopy(pts);
	expect(Array.from(got.xs)).toEqual(want.xs);
	expect(Array.from(got.ys)).toEqual(want.ys);
});

test("the same array, unchanged, is sorted once", () => {
	const pts = face(0);
	expect(sortedLandmarkAxes(pts)).toBe(sortedLandmarkAxes(pts));
});

test("the same array rewritten in place gets fresh axes", () => {
	const pts = face(0);
	const before = Array.from(sortedLandmarkAxes(pts)!.xs);
	const moved = face(0.1);
	for (let i = 0; i < pts.length; i++) pts[i] = moved[i];
	const after = sortedLandmarkAxes(pts)!;
	expect(Array.from(after.xs)).toEqual(sortedCopy(moved).xs);
	expect(Array.from(after.xs)).not.toEqual(before);
});

test("the same array with each point object moved in place gets fresh axes", () => {
	const pts = face(0);
	sortedLandmarkAxes(pts);
	for (const p of pts) {
		p.x += 0.05;
		p.y -= 0.03;
	}
	const after = sortedLandmarkAxes(pts)!;
	expect(Array.from(after.xs)).toEqual(sortedCopy(pts).xs);
	expect(Array.from(after.ys)).toEqual(sortedCopy(pts).ys);
});

test("a NaN coordinate gives null", () => {
	const pts = face(0);
	pts[10] = { x: Number.NaN, y: 0.5 };
	expect(sortedLandmarkAxes(pts)).toBeNull();
});

test("two points moved in opposite directions, the plain total unchanged, still get fresh axes", () => {
	const pts = face(0);
	sortedLandmarkAxes(pts);
	pts[5].x += 0.2;
	pts[300].x -= 0.2;
	const after = sortedLandmarkAxes(pts)!;
	expect(Array.from(after.xs)).toEqual(sortedCopy(pts).xs);
});

test("moves that leave any weighted total equal still get fresh axes", () => {
	const pts = face(0);
	pts[0] = { x: 0.5, y: 0.5 };
	pts[1] = { x: 0.5, y: 0.5 };
	sortedLandmarkAxes(pts);
	pts[0].x = 0.75; // +0.25 at weight 1
	pts[1].x = 0.375; // -0.125 at weight 2
	expect(Array.from(sortedLandmarkAxes(pts)!.xs)).toEqual(sortedCopy(pts).xs);
});

test("a coordinate at Infinity does not pin the cache: the face moving is still seen", () => {
	const pts = face(0);
	pts[7] = { x: Number.POSITIVE_INFINITY, y: 0.5 };
	sortedLandmarkAxes(pts);
	for (const p of pts) if (Number.isFinite(p.x)) p.x += 0.2;
	expect(Array.from(sortedLandmarkAxes(pts)!.xs)).toEqual(sortedCopy(pts).xs);
});
