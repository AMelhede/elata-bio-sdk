/**
 * Defaults. 0.5 Hz at rest passes a slow drift and cuts jitter at a resting pulse (1 to 1.5 Hz) to under half; 40 Hz
 * per face width a second raises it to about 4.5 Hz at 0.1 face widths a second, a quick head turn.
 */
export const STEADY_MIN_CUTOFF_HZ = 0.5;
export const STEADY_BETA = 40;
/** Cutoff of the speed estimate itself, Hz (the paper's d_cutoff). */
export const STEADY_SPEED_CUTOFF_HZ = 1;
/** A gap longer than this starts the filter again (a lost face, a paused camera), ms. */
export const STEADY_RESET_MS = 500;
const alpha = (cutoffHz, dtS) => 1 / (1 + 1 / (2 * Math.PI * cutoffHz * dtS));
export class SteadyLandmarks {
    constructor(o = {}) {
        this.prev = null;
        this.prevMs = 0;
        this.centre = null;
        this.speed = 0;
        this.minCutoffHz = o.minCutoffHz ?? STEADY_MIN_CUTOFF_HZ;
        this.beta = o.beta ?? STEADY_BETA;
    }
    reset() {
        this.prev = null;
        this.centre = null;
        this.speed = 0;
    }
    /** The filtered points for a new find at `tMs` (a new array; the input is not changed). */
    filter(points, tMs) {
        const dtS = (tMs - this.prevMs) / 1000;
        if (!this.prev || this.prev.length !== points.length || !(dtS > 0) || dtS * 1000 > STEADY_RESET_MS) {
            this.prev = points.map((p) => ({ x: p.x, y: p.y, z: p.z }));
            this.prevMs = tMs;
            this.centre = centreOf(points);
            this.speed = 0;
            return points.map((p) => ({ ...p }));
        }
        const c = centreOf(points);
        const w = widthOf(points);
        const raw = this.centre ? Math.hypot(c.x - this.centre.x, c.y - this.centre.y) / w / dtS : 0;
        this.centre = c;
        this.speed += alpha(STEADY_SPEED_CUTOFF_HZ, dtS) * (raw - this.speed);
        const a = alpha(this.minCutoffHz + this.beta * this.speed, dtS);
        const out = points.map((p, i) => {
            const q = this.prev[i];
            const x = q.x + a * (p.x - q.x);
            const y = q.y + a * (p.y - q.y);
            const z = p.z == null || q.z == null ? p.z : q.z + a * (p.z - q.z);
            return { ...p, x, y, ...(z == null ? {} : { z }) };
        });
        this.prev = out.map((p) => ({ x: p.x, y: p.y, z: p.z }));
        this.prevMs = tMs;
        return out;
    }
}
function centreOf(pts) {
    let x = 0, y = 0;
    for (const p of pts) {
        x += p.x;
        y += p.y;
    }
    return { x: x / pts.length, y: y / pts.length };
}
function widthOf(pts) {
    let lo = Infinity, hi = -Infinity;
    for (const p of pts) {
        if (p.x < lo)
            lo = p.x;
        if (p.x > hi)
            hi = p.x;
    }
    return Math.max(1e-6, hi - lo);
}
