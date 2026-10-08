/**
 * The face's landmark x and y, each clamped to 0..1 and sorted ascending, once per landmark array.
 * The region geometry and the wall patch read percentiles of them on every frame (478 points sorted
 * two or three times per frame); a landmark array is never changed once made, and with the sparse
 * face finder the same array carries several frames. Null when any coordinate is not a number (the
 * callers then sort as before).
 */
const cache = new WeakMap();
export function sortedLandmarkAxes(points) {
    const hit = cache.get(points);
    if (hit !== undefined)
        return hit;
    const n = points.length;
    const xs = new Float64Array(n);
    const ys = new Float64Array(n);
    for (let i = 0; i < n; i++) {
        const p = points[i];
        xs[i] = Math.min(1, Math.max(0, p.x));
        ys[i] = Math.min(1, Math.max(0, p.y));
        if (Number.isNaN(xs[i]) || Number.isNaN(ys[i])) {
            cache.set(points, null);
            return null;
        }
    }
    // A typed array sorts numerically, as the (a, b) => a - b comparator does for these values (no
    // NaN, and clamping turns -0 into +0).
    xs.sort();
    ys.sort();
    const v = { xs, ys };
    cache.set(points, v);
    return v;
}
