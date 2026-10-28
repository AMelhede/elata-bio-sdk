/**
 * Forehead pool (switch `foreheadPool`, OFF by default): the forehead region read from many small skin patches instead
 * of one box, weighted toward the cleanest patches. The two cheek regions stay the boxes the check always read.
 *
 * Why: a single box mixes skin of very different quality, and on weak cameras the forehead box alone rarely carries a
 * readable pulse. More forehead skin averages away sensor noise that is NOT shared between patches; the cheeks are left
 * as boxes because there more area mostly adds noise the regions share, which lets a no-pulse video look like a pulse.
 *
 * What it does, per frame (all decisions use only the PREVIOUS 16 s window and never look inside the pulse band, at
 * another region, or at a rate):
 * - 49 forehead patches (facePatches.ts FOREHEAD_POOL: 24 grid cells above the brows, 8 tiling today's forehead box,
 *   17 squares on forehead landmarks). A patch counts in a frame only under the library's own skin rule.
 * - Once a second, from the previous 16 s: drop patches whose median skin fraction is under FOREHEAD_TAU_SKIN or whose
 *   swing (peak to peak of the detrended relative green) is over FOREHEAD_TAU_SWING, prune the 1/8 that move most
 *   (mean change of skin fraction), weight the rest by 1 / their noise power above the pulse band (3 to 10 Hz of the
 *   colour difference signals the check's POS reads).
 * - Each patch is divided by its own 16 s running mean, the weighted mean of those ratios is scaled back to the
 *   region's level, and that is the forehead the check is fed.
 *
 * Value chosen by measurement on recorded captures against a reference pulse; constants fixed on one half of the
 * people and checked on the other.
 */
import { OWN_PULSE_BAND_HZ, OWN_PULSE_DETREND_S, OWN_PULSE_FS, OWN_PULSE_WINDOW_S } from "./pulseCheckCore";

/** Skin fraction below which a patch is dropped for the next second (the antimode of the measured histogram). */
export const FOREHEAD_TAU_SKIN = 0.5;
/** Relative swing above which a patch is dropped (a far outlier fence; it rarely fires). */
export const FOREHEAD_TAU_SWING = 15.751094366933657;
/** Share of the remaining patches pruned for movement. */
export const FOREHEAD_PRUNE = 1 / 8;
const WIN_MS = OWN_PULSE_WINDOW_S * 1000;
/** Noise band: from the top of the pulse band to the check's analysis Nyquist. */
const HI_BAND: readonly [number, number] = [OWN_PULSE_BAND_HZ[1], OWN_PULSE_FS / 2];

/** One frame of the pool's patches: per patch the skin-masked mean R, G, B (0..255), the skin and pixel counts. */
export type PoolFrame = { t: number; mean: Float64Array; skin: Float64Array; n: Float64Array };

type Row = {
	t: number;
	x: Float64Array; // P x 3 means (0..255)
	u: Uint8Array; // usable per patch
	frac: Float64Array; // skin fraction per patch
	m: Float64Array; // P x 3 running mean at this frame
};

/** The library's own fallback rule (frameSource.ts): a patch with too few skin pixels does not count. */
const usable = (mean: number, skin: number, n: number) => Number.isFinite(mean) && skin >= Math.max(10, Math.floor(0.1 * n));

/** pulseCheckCore.ts detrend on frames: subtract a double centred moving mean round(fps * OWN_PULSE_DETREND_S) wide. */
function detrend(x: Float64Array, fps: number): Float64Array {
	const w = Math.max(1, Math.round(fps * OWN_PULSE_DETREND_S));
	const half = w >> 1;
	const mm = (a: Float64Array) => {
		const n = a.length;
		const cs = new Float64Array(n + 1);
		for (let i = 0; i < n; i++) cs[i + 1] = cs[i] + a[i];
		const out = new Float64Array(n);
		for (let k = 0; k < n; k++) {
			const lo = Math.max(0, k - half);
			const hi = Math.min(n, k + half + 1);
			out[k] = (cs[hi] - cs[lo]) / (hi - lo);
		}
		return out;
	};
	const once = mm(mm(x));
	const out = new Float64Array(x.length);
	for (let i = 0; i < x.length; i++) out[i] = x[i] - once[i];
	return out;
}

/** Fill a column's non-usable entries by linear interpolation over its usable ones, edges held (numpy interp). */
function interp(x: Float64Array, ok: Uint8Array): Float64Array | null {
	const idx: number[] = [];
	for (let i = 0; i < x.length; i++) if (ok[i]) idx.push(i);
	if (idx.length === x.length) return x;
	if (idx.length < 2) return null;
	const out = new Float64Array(x.length);
	let j = 0;
	for (let i = 0; i < x.length; i++) {
		if (ok[i]) { out[i] = x[i]; continue; }
		if (i <= idx[0]) { out[i] = x[idx[0]]; continue; }
		if (i >= idx[idx.length - 1]) { out[i] = x[idx[idx.length - 1]]; continue; }
		while (idx[j + 1] < i) j++;
		const a = idx[j], b = idx[j + 1];
		out[i] = x[a] + ((x[b] - x[a]) * (i - a)) / (b - a);
	}
	return out;
}

/** Mean power of a Hann-windowed DFT over the bins inside HI_BAND (numpy rfft bin k at k * fps / n). */
function bandPower(s1: Float64Array, s2: Float64Array, fps: number): number {
	const n = s1.length;
	// The Hann window applied once; each bin's twiddle advanced by rotation instead of a sine and cosine per sample.
	const h1 = new Float64Array(n), h2 = new Float64Array(n);
	for (let j = 0; j < n; j++) {
		const h = n > 1 ? 0.5 - 0.5 * Math.cos((2 * Math.PI * j) / (n - 1)) : 1;
		h1[j] = s1[j] * h;
		h2[j] = s2[j] * h;
	}
	let sum = 0, bins = 0;
	for (let k = 0; k <= n >> 1; k++) {
		const f = (k * fps) / n;
		if (f < HI_BAND[0] || f > HI_BAND[1]) continue;
		const a = (-2 * Math.PI * k) / n;
		const dc = Math.cos(a), ds = Math.sin(a);
		let c = 1, s = 0, r1 = 0, i1 = 0, r2 = 0, i2 = 0;
		for (let j = 0; j < n; j++) {
			r1 += h1[j] * c; i1 += h1[j] * s;
			r2 += h2[j] * c; i2 += h2[j] * s;
			const cn = c * dc - s * ds;
			s = c * ds + s * dc;
			c = cn;
		}
		sum += r1 * r1 + i1 * i1 + r2 * r2 + i2 * i2;
		bins++;
	}
	return bins ? sum / bins : NaN;
}

/**
 * The pool for one region. `push` takes each face frame's patches (in time order) and returns the region's colour on
 * the library's 0..1 scale, or null before it has one (the caller keeps the box then). `fpsOverride` exists only for
 * offline replay of a recording made at a known rate; live, the rate is measured from the frames.
 */
export class ForeheadPool {
	/** Frames of the last WIN_MS + 1 s: the weights read the window ending at the last whole second. */
	private rows: Row[] = [];
	/** Index into rows of the oldest frame inside the running mean's window. */
	private winStart = 0;
	private sum: Float64Array;
	private cnt: Float64Array;
	private weights: Float64Array | null = null;
	private weightSecond = -Infinity;
	private last: { r: number; g: number; b: number } | null = null;

	constructor(private readonly patches: number, private readonly fpsOverride?: number) {
		this.sum = new Float64Array(patches * 3);
		this.cnt = new Float64Array(patches);
	}

	reset(): void {
		this.rows = [];
		this.winStart = 0;
		this.sum.fill(0);
		this.cnt.fill(0);
		this.weights = null;
		this.weightSecond = -Infinity;
		this.last = null;
	}

	push(frame: PoolFrame): { r: number; g: number; b: number } | null {
		const P = this.patches;
		const x = new Float64Array(P * 3);
		const u = new Uint8Array(P);
		const frac = new Float64Array(P);
		for (let p = 0; p < P; p++) {
			for (let c = 0; c < 3; c++) x[3 * p + c] = frame.mean[3 * p + c];
			u[p] = usable(frame.mean[3 * p + 1], frame.skin[p], frame.n[p]) ? 1 : 0;
			frac[p] = frame.skin[p] / Math.max(frame.n[p], 1);
		}
		// Running mean over the trailing window (t - WIN_MS, t], usable values only.
		while (this.winStart < this.rows.length && this.rows[this.winStart].t <= frame.t - WIN_MS) {
			const old = this.rows[this.winStart++];
			for (let p = 0; p < P; p++) if (old.u[p]) { this.cnt[p]--; for (let c = 0; c < 3; c++) this.sum[3 * p + c] -= old.x[3 * p + c]; }
		}
		while (this.rows.length && this.rows[0].t <= frame.t - WIN_MS - 1000) { this.rows.shift(); this.winStart--; }
		for (let p = 0; p < P; p++) if (u[p]) { this.cnt[p]++; for (let c = 0; c < 3; c++) this.sum[3 * p + c] += x[3 * p + c]; }
		const m = new Float64Array(P * 3);
		for (let p = 0; p < P; p++) for (let c = 0; c < 3; c++) m[3 * p + c] = this.cnt[p] ? this.sum[3 * p + c] / this.cnt[p] : NaN;
		const row: Row = { t: frame.t, x, u, frac, m };
		this.rows.push(row);

		// Weights for frames in (s, s + 1] come from the window ending at whole second s.
		const s = Math.ceil(frame.t / 1000) - 1;
		if (s !== this.weightSecond) {
			this.weightSecond = s;
			this.weights = this.weightsAt(s);
		}
		const w = this.weights;
		let sw = 0;
		const num = [0, 0, 0], lev = [0, 0, 0];
		for (let p = 0; p < P; p++) {
			if (!u[p]) continue;
			const wp = w ? w[p] : 1;
			if (!(wp > 0)) continue;
			sw += wp;
			for (let c = 0; c < 3; c++) {
				const xs = x[3 * p + c] / m[3 * p + c];
				if (Number.isFinite(xs)) num[c] += xs * wp;
				if (Number.isFinite(m[3 * p + c])) lev[c] += m[3 * p + c] * wp;
			}
		}
		if (sw > 0) this.last = { r: (num[0] / sw) * (lev[0] / sw / 255), g: (num[1] / sw) * (lev[1] / sw / 255), b: (num[2] / sw) * (lev[2] / sw / 255) };
		return this.last;
	}

	/** D3 weights from the frames in (s - 16 s, s]; null (equal weights) under 2 s of frames. */
	private weightsAt(s: number): Float64Array | null {
		const P = this.patches;
		const sel = this.rows.filter((r) => r.t > s * 1000 - WIN_MS && r.t <= s * 1000);
		const n = sel.length;
		let fps = this.fpsOverride;
		if (fps == null) fps = n > 1 ? ((n - 1) * 1000) / (sel[n - 1].t - sel[0].t) : 0;
		if (!(n >= 2 * fps) || n < 2) return null;
		const skinMed = new Float64Array(P), motion = new Float64Array(P), swing = new Float64Array(P), phi = new Float64Array(P);
		for (let p = 0; p < P; p++) {
			const fr = sel.map((r) => r.frac[p]).sort((a, b) => a - b);
			skinMed[p] = fr.length % 2 ? fr[fr.length >> 1] : (fr[fr.length / 2 - 1] + fr[fr.length / 2]) / 2;
			let md = 0;
			for (let i = 1; i < n; i++) md += Math.abs(sel[i].frac[p] - sel[i - 1].frac[p]);
			motion[p] = n > 1 ? md / (n - 1) : NaN;
			const ok = new Uint8Array(n);
			let used = 0;
			for (let i = 0; i < n; i++) { ok[i] = sel[i].u[p]; used += ok[i]; }
			const ch = (c: number) => {
				const v = new Float64Array(n);
				for (let i = 0; i < n; i++) v[i] = sel[i].x[3 * p + c] / sel[i].m[3 * p + c];
				return interp(v, ok);
			};
			const r = ch(0), g = ch(1), b = ch(2);
			if (used < 2 || !r || !g || !b) { swing[p] = NaN; phi[p] = NaN; continue; }
			const nz = (a: Float64Array, fill: number) => a.map((v) => (Number.isFinite(v) ? v : fill));
			const gd = detrend(nz(g, 1), fps);
			let lo = Infinity, hi = -Infinity;
			for (const v of gd) { if (v < lo) lo = v; if (v > hi) hi = v; }
			swing[p] = hi - lo;
			const s1 = detrend(nz(g.map((v, i) => v - b[i]), 0), fps);
			const s2 = detrend(nz(g.map((v, i) => v + b[i] - 2 * r[i]), 0), fps);
			phi[p] = bandPower(s1, s2, fps);
		}
		const w = new Float64Array(P);
		const cand: number[] = [];
		for (let p = 0; p < P; p++) {
			if (skinMed[p] >= FOREHEAD_TAU_SKIN && !(swing[p] > FOREHEAD_TAU_SWING) && Number.isFinite(phi[p]) && phi[p] > 0) cand.push(p);
		}
		const k = Math.floor(cand.length * FOREHEAD_PRUNE);
		// numpy argsort (stable), NaN sorted last: keep the len - k least moving.
		const order = cand
			.map((p, i) => ({ p, i, v: motion[p] }))
			.sort((a, b) => (Number.isNaN(a.v) ? 1 : 0) - (Number.isNaN(b.v) ? 1 : 0) || a.v - b.v || a.i - b.i);
		for (const { p } of order.slice(0, cand.length - k)) w[p] = 1 / phi[p];
		return w;
	}
}
