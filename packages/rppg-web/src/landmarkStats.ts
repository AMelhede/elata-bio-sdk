/**
 * The face's landmark x and y, each clamped to 0..1 and sorted ascending, once per landmark array.
 * The region geometry and the wall patch read percentiles of them on every frame (478 points sorted
 * two or three times per frame); with the sparse face finder the same array carries several frames.
 * A source may also hand back one array with its points rewritten, so each entry carries a checksum of
 * every coordinate (one pass, far cheaper than the sort) and a changed array is sorted afresh. Null when
 * any coordinate is not a number (the callers then sort as before).
 */
type Entry = { sum: number; n: number; axes: { xs: Float64Array; ys: Float64Array } | null };
const cache = new WeakMap<readonly { x: number; y: number }[], Entry>();

/** Every coordinate, each with its own weight, so two points moved in opposite directions still change the total. */
function checksum(points: readonly { x: number; y: number }[]): number {
	let s = 0;
	for (let i = 0; i < points.length; i++) {
		const p = points[i];
		s += (i + 1) * p.x + (i + 0.5) * 1.6180339887 * p.y;
	}
	return s;
}

export function sortedLandmarkAxes(
	points: readonly { x: number; y: number }[],
): { xs: Float64Array; ys: Float64Array } | null {
	const sum = checksum(points);
	const n = points.length;
	const hit = cache.get(points);
	if (hit !== undefined && hit.n === n && Object.is(hit.sum, sum)) return hit.axes;
	const xs = new Float64Array(n);
	const ys = new Float64Array(n);
	for (let i = 0; i < n; i++) {
		const p = points[i];
		xs[i] = Math.min(1, Math.max(0, p.x));
		ys[i] = Math.min(1, Math.max(0, p.y));
		if (Number.isNaN(xs[i]) || Number.isNaN(ys[i])) {
			cache.set(points, { sum, n, axes: null });
			return null;
		}
	}
	// A typed array sorts numerically, as the (a, b) => a - b comparator does for these values (no
	// NaN, and clamping turns -0 into +0).
	xs.sort();
	ys.sort();
	const v = { xs, ys };
	cache.set(points, { sum, n, axes: v });
	return v;
}
