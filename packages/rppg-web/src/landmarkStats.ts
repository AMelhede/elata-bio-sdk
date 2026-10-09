/**
 * The face's landmark x and y, each clamped to 0..1 and sorted ascending, once per landmark array.
 * The region geometry and the wall patch read percentiles of them on every frame (478 points sorted
 * two or three times per frame); with the sparse face finder the same array carries several frames.
 * A source may also hand back one array with its points rewritten, so each entry keeps a copy of the
 * coordinates it was sorted from and a changed array is sorted afresh (one comparison pass, far cheaper
 * than the sort, and exact: no total can hide a change). Null when any coordinate is not a number (the
 * callers then sort as before).
 */
type Entry = { raw: Float64Array; axes: { xs: Float64Array; ys: Float64Array } | null };
const cache = new WeakMap<readonly { x: number; y: number }[], Entry>();

/** Whether every coordinate still equals the copy (NaN equals NaN here: such a face stays null). */
function unchanged(points: readonly { x: number; y: number }[], raw: Float64Array): boolean {
	if (raw.length !== 2 * points.length) return false;
	for (let i = 0; i < points.length; i++) {
		const p = points[i];
		if (!Object.is(p.x, raw[2 * i]) || !Object.is(p.y, raw[2 * i + 1])) return false;
	}
	return true;
}

export function sortedLandmarkAxes(
	points: readonly { x: number; y: number }[],
): { xs: Float64Array; ys: Float64Array } | null {
	const hit = cache.get(points);
	if (hit !== undefined && unchanged(points, hit.raw)) return hit.axes;
	const n = points.length;
	const raw = new Float64Array(2 * n);
	const xs = new Float64Array(n);
	const ys = new Float64Array(n);
	let nan = false;
	for (let i = 0; i < n; i++) {
		const p = points[i];
		raw[2 * i] = p.x;
		raw[2 * i + 1] = p.y;
		xs[i] = Math.min(1, Math.max(0, p.x));
		ys[i] = Math.min(1, Math.max(0, p.y));
		if (Number.isNaN(xs[i]) || Number.isNaN(ys[i])) nan = true;
	}
	if (nan) {
		cache.set(points, { raw, axes: null });
		return null;
	}
	// A typed array sorts numerically, as the (a, b) => a - b comparator does for these values (no
	// NaN, and clamping turns -0 into +0).
	xs.sort();
	ys.sort();
	const v = { xs, ys };
	cache.set(points, { raw, axes: v });
	return v;
}
