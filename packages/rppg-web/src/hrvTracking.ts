/**
 * Experimental: beat timing for HRV from the three face regions, by a tracking band around the camera's own rate.
 *
 * Measured on recorded webcam captures against a frame-synced finger sensor, next to the Hilbert-phase timer the
 * engine's HRV uses (pulseAnalysis.ts, detectBeatsViaHilbertPhase): more one-minute windows within 20% of the finger,
 * a smaller bias, and a smaller beat-time error at a low local SNR. That is still no better than a constant guess, so
 * nothing here is shown to a person: it is reachable only through the session's experimental HRV switch, for research.
 *
 * The pipeline, each step as the lab study ran it (scipy), so a replay of the library reproduces its numbers:
 *  1. the frame clock de-jittered (dejitterFrameTimes): a browser reads frames on a coarse tick (32/48 ms intervals
 *     at 30 fps), worth more beat-time error than the pulse itself at rest;
 *  2. each region's R, G, B to the camera's own rate on a uniform grid (not-a-knot cubic), POS (1.6 s windows), a
 *     1.5 s double moving mean subtracted, and the three pulses scaled to unit sd and added (coherent sum);
 *  3. a rate track: 8 s Hann frames every 0.5 s, the periodogram peak in 0.7 to 3.5 Hz, a 5-frame median; and each
 *     frame's SNR, power within 0.1 Hz of the peak and its 2nd harmonic over the rest of the band (de Haan);
 *  4. the sum band-passed 0.7 to 3.5 Hz (4th-order Butterworth, zero phase) and upsampled to 240 Hz (cubic);
 *  5. a tracking band: the analytic signal shifted down by the track's phase, low-passed at 0.45 Hz (keeps the
 *     breathing sidebands of the beat, 0.15 to 0.4 Hz, rejects the rest of the band), shifted back;
 *  6. a beat at each 2 pi crossing of that signal's phase;
 *  7. intervals 0.3 to 2 s, none touching a frame gap over 90 ms, each within 20% of the median of the 11 around
 *     it; rMSSD over adjacent kept pairs (at least 5), SDNN over kept intervals (at least 6);
 *  8. a gate: no HRV unless the window's median frame SNR reaches HRV_MIN_SNR_DB.
 */
import { hilbertImag } from "./pulseAnalysis";

/** One frame: its time (ms) and the mean R, G, B of the face regions (forehead, left cheek, right cheek). */
export type HrvRegionFrame = { t: number; regions: readonly { r: number; g: number; b: number }[] };

export type HrvWindowResult = {
	/** RMSSD (ms) over the window, or null (too few pairs, gated, or too short). */
	rmssdMs: number | null;
	/** SDNN (ms) over the window's kept intervals, or null. */
	sdnnMs: number | null;
	/** The window's median frame SNR (dB) on the rate track, or null without a track frame in it. */
	snrDb: number | null;
	/** The median of the rate track over the window (bpm), or null. */
	centreBpm: number | null;
	/** Intervals in the window, those kept, and the adjacent kept pairs the rMSSD is over. */
	intervals: number;
	kept: number;
	pairs: number;
	/** The window's SNR fell under the gate, so no HRV is given. */
	gated: boolean;
	/** Why there is no HRV when there is none for a reason other than the counts: "short" or "gated". */
	reason: "short" | "gated" | null;
	/** The window, ms, on the de-jittered clock. */
	windowStartMs: number;
	windowEndMs: number;
	/** Every beat found (ms), over the whole input, for research. */
	beatTimesMs: number[];
};

export type HrvWindowOptions = {
	/** Window length, seconds (default 60). */
	windowS?: number;
	/** Window end (ms on the input's clock); default 1 s before the last frame (the filters' edge). */
	windowEndMs?: number;
	/** Window start (ms); default windowEndMs - windowS. */
	windowStartMs?: number;
	/** The analysis grid's rate (Hz); default the frame rate, rounded. */
	sampleRate?: number;
	/** Half-width of the tracking band (Hz), default 0.45. */
	trackHalfHz?: number;
	/** The SNR gate (dB), default HRV_MIN_SNR_DB; -Infinity for none. */
	minSnrDb?: number;
	/** De-jitter the frame clock first (default true). */
	dejitter?: boolean;
};

/** A frame interval longer than this is a gap (normal intervals read 31 to 49 ms on a 16 ms tick at 30 fps). */
export const HRV_GAP_MS = 90;
/** The window SNR gate, dB, as the study that measured this timer gated it (see the top of this file). */
export const HRV_MIN_SNR_DB = 1;
/** The beat-timing grid, Hz. */
export const HRV_UPSAMPLE_HZ = 240;
/** Half-width of the tracking band, Hz: wide enough for breathing's sidebands (to 0.4 Hz). */
export const HRV_TRACK_HALF_HZ = 0.45;
/** Lead the frames need before the window: half a rate-track frame, and the filters' settling. */
export const HRV_LEAD_S = 4;

// ---------------------------------------------------------------------------------------------------------------
// Numerics as numpy/scipy define them (the lab pipeline is in numpy; equal results let a replay compare the two)
// ---------------------------------------------------------------------------------------------------------------

/** Python's round(): halves go to the even integer. */
function roundHalfEven(x: number): number {
	const f = Math.floor(x);
	const d = x - f;
	if (d > 0.5) return f + 1;
	if (d < 0.5) return f;
	return f % 2 === 0 ? f : f + 1;
}

function median(v: ArrayLike<number>): number {
	const s = Array.from(v).sort((a, b) => a - b);
	const m = s.length >> 1;
	return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** numpy.arange(start, stop, step) for float steps. */
function arange(start: number, stop: number, step: number): Float64Array {
	const n = Math.max(0, Math.ceil((stop - start) / step));
	const out = new Float64Array(n);
	for (let i = 0; i < n; i++) out[i] = start + i * step;
	return out;
}

/** numpy.interp: linear, clamped at both ends; xp increasing. */
function interp(x: ArrayLike<number>, xp: ArrayLike<number>, fp: ArrayLike<number>): Float64Array {
	const out = new Float64Array(x.length);
	let j = 0;
	const n = xp.length;
	for (let i = 0; i < x.length; i++) {
		const q = x[i];
		if (q <= xp[0]) out[i] = fp[0];
		else if (q >= xp[n - 1]) out[i] = fp[n - 1];
		else {
			while (j > 0 && xp[j] > q) j--;
			while (j < n - 2 && xp[j + 1] <= q) j++;
			out[i] = fp[j] + ((q - xp[j]) * (fp[j + 1] - fp[j])) / (xp[j + 1] - xp[j]);
		}
	}
	return out;
}

/**
 * scipy.interpolate.CubicSpline(t, v) (not-a-knot ends) evaluated at q; t strictly increasing, at least 4 knots
 * (fewer: linear).
 */
export function cubicSplineNotAKnot(t: ArrayLike<number>, v: ArrayLike<number>, q: ArrayLike<number>): Float64Array {
	const n = t.length;
	if (n < 4) return interp(q, t, v);
	const h = new Float64Array(n - 1);
	const d = new Float64Array(n - 1);
	for (let i = 0; i < n - 1; i++) {
		h[i] = t[i + 1] - t[i];
		d[i] = (v[i + 1] - v[i]) / h[i];
	}
	// Second derivatives M[1..n-2] from a tridiagonal system; M[0] and M[n-1] from the not-a-knot conditions
	// (third derivative continuous across the second and the second-to-last knots).
	const m = n - 2;
	const lo = new Float64Array(m);
	const di = new Float64Array(m);
	const up = new Float64Array(m);
	const rhs = new Float64Array(m);
	for (let k = 0; k < m; k++) {
		const i = k + 1;
		lo[k] = h[i - 1];
		di[k] = 2 * (h[i - 1] + h[i]);
		up[k] = h[i];
		rhs[k] = 6 * (d[i] - d[i - 1]);
	}
	const h0 = h[0];
	const h1 = h[1];
	const ha = h[n - 3];
	const hb = h[n - 2];
	if (m === 2) {
		// n = 4: both conditions fold into a 2x2 system.
		const a11 = di[0] + h0 * (1 + h0 / h1);
		const a12 = up[0] - (h0 * h0) / h1;
		const a21 = lo[1] - (hb * hb) / ha;
		const a22 = di[1] + hb * (1 + hb / ha);
		const det = a11 * a22 - a12 * a21;
		const M1 = (rhs[0] * a22 - a12 * rhs[1]) / det;
		const M2 = (a11 * rhs[1] - a21 * rhs[0]) / det;
		return evalSpline(t, v, h, [M1 * (1 + h0 / h1) - (M2 * h0) / h1, M1, M2, M2 * (1 + hb / ha) - (M1 * hb) / ha], q);
	}
	di[0] += h0 * (1 + h0 / h1);
	up[0] -= (h0 * h0) / h1;
	di[m - 1] += hb * (1 + hb / ha);
	lo[m - 1] -= (hb * hb) / ha;
	// Thomas algorithm.
	for (let k = 1; k < m; k++) {
		const w = lo[k] / di[k - 1];
		di[k] -= w * up[k - 1];
		rhs[k] -= w * rhs[k - 1];
	}
	const M = new Float64Array(n);
	M[m] = rhs[m - 1] / di[m - 1];
	for (let k = m - 2; k >= 0; k--) M[k + 1] = (rhs[k] - up[k] * M[k + 2]) / di[k];
	M[0] = M[1] * (1 + h0 / h1) - (M[2] * h0) / h1;
	M[n - 1] = M[n - 2] * (1 + hb / ha) - (M[n - 3] * hb) / ha;
	return evalSpline(t, v, h, M, q);
}

function evalSpline(t: ArrayLike<number>, v: ArrayLike<number>, h: Float64Array, M: ArrayLike<number>, q: ArrayLike<number>): Float64Array {
	const n = t.length;
	const out = new Float64Array(q.length);
	let i = 0;
	for (let k = 0; k < q.length; k++) {
		const x = q[k];
		while (i > 0 && x < t[i]) i--;
		while (i < n - 2 && x >= t[i + 1]) i++;
		const hi = h[i];
		const a = t[i + 1] - x;
		const b = x - t[i];
		out[k] = (M[i] * a * a * a + M[i + 1] * b * b * b) / (6 * hi) + (v[i] / hi - (M[i] * hi) / 6) * a + (v[i + 1] / hi - (M[i + 1] * hi) / 6) * b;
	}
	return out;
}

type C = { re: number; im: number };
const cmul = (a: C, b: C): C => ({ re: a.re * b.re - a.im * b.im, im: a.re * b.im + a.im * b.re });
const cdiv = (a: C, b: C): C => {
	const den = b.re * b.re + b.im * b.im;
	return { re: (a.re * b.re + a.im * b.im) / den, im: (a.im * b.re - a.re * b.im) / den };
};
const csqrt = (a: C): C => {
	const r = Math.hypot(a.re, a.im);
	const re = Math.sqrt((r + a.re) / 2);
	const im = Math.sign(a.im || 1) * Math.sqrt(Math.max(0, (r - a.re) / 2));
	return { re, im };
};

/**
 * Digital Butterworth second-order sections, as scipy.signal.butter(order, cutoff, 'low' | 'band', fs=fs,
 * output='sos'): a low-pass for one cutoff (Hz), a band-pass for [low, high]. Rows [b0, b1, b2, 1, a1, a2].
 * The sections are paired differently from scipy's zpk2sos; the cascade (and so any filtfilt through it) is the same.
 */
export function butterworthSos(order: number, cutoff: number | readonly [number, number], fs: number): number[][] {
	const fs2 = 4; // scipy designs at fs = 2 (normalised frequency): it warps with 2 * fs = 4 and transforms with the same
	const warp = (f: number) => fs2 * Math.tan((Math.PI * ((2 * f) / fs)) / 2);
	// Analogue prototype poles (buttap).
	const proto: C[] = [];
	for (let k = -order + 1; k < order; k += 2) {
		const a = (Math.PI * k) / (2 * order);
		proto.push({ re: -Math.cos(a), im: -Math.sin(a) });
	}
	let poles: C[];
	let zeros: C[];
	let gain: number;
	if (typeof cutoff === "number") {
		const wo = warp(cutoff);
		poles = proto.map((p) => ({ re: p.re * wo, im: p.im * wo }));
		zeros = [];
		gain = wo ** order;
	} else {
		const w1 = warp(cutoff[0]);
		const w2 = warp(cutoff[1]);
		const bw = w2 - w1;
		const wo2 = w1 * w2;
		poles = [];
		for (const p of proto) {
			const pl = { re: (p.re * bw) / 2, im: (p.im * bw) / 2 };
			const s = csqrt({ re: pl.re * pl.re - pl.im * pl.im - wo2, im: 2 * pl.re * pl.im });
			poles.push({ re: pl.re + s.re, im: pl.im + s.im }, { re: pl.re - s.re, im: pl.im - s.im });
		}
		zeros = Array.from({ length: order }, () => ({ re: 0, im: 0 }));
		gain = bw ** order;
	}
	// Bilinear transform.
	const bil = (z: C) => cdiv({ re: fs2 + z.re, im: z.im }, { re: fs2 - z.re, im: -z.im });
	let num: C = { re: 1, im: 0 };
	let den: C = { re: 1, im: 0 };
	for (const z of zeros) num = cmul(num, { re: fs2 - z.re, im: -z.im });
	for (const p of poles) den = cmul(den, { re: fs2 - p.re, im: -p.im });
	gain *= cdiv(num, den).re;
	const zd = zeros.map(bil);
	while (zd.length < poles.length) zd.push({ re: -1, im: 0 });
	const pd = poles.map(bil);
	// Pair each pole with its conjugate (upper half-plane ones lead); real poles pair with each other.
	const upper = pd.filter((p) => p.im > 1e-14);
	const real = pd.filter((p) => Math.abs(p.im) <= 1e-14);
	const sections: number[][] = [];
	for (const p of upper) sections.push([1, -2 * p.re, p.re * p.re + p.im * p.im]);
	for (let i = 0; i < real.length; i += 2) {
		const a = real[i].re;
		const b = i + 1 < real.length ? real[i + 1].re : 0;
		sections.push(i + 1 < real.length ? [1, -(a + b), a * b] : [1, -a, 0]);
	}
	// Zeros (all real here: +1 or -1), two per section.
	const zr = zd.map((z) => z.re).sort((a, b) => a - b);
	const out: number[][] = [];
	for (let s = 0; s < sections.length; s++) {
		const z1 = zr[2 * s];
		const z2 = 2 * s + 1 < zr.length ? zr[2 * s + 1] : null;
		const b = z2 == null ? [1, -z1, 0] : [1, -(z1 + z2), z1 * z2];
		const g = s === 0 ? gain : 1;
		out.push([b[0] * g, b[1] * g, b[2] * g, ...sections[s]]);
	}
	return out;
}

/** scipy.signal.sosfilt with initial state zi (n_sections x 2), direct form II transposed; returns [y, zf]. */
function sosfilt(sos: number[][], x: Float64Array, zi: number[][]): Float64Array {
	const y = Float64Array.from(x);
	for (let s = 0; s < sos.length; s++) {
		const [b0, b1, b2, , a1, a2] = sos[s];
		let z0 = zi[s][0];
		let z1 = zi[s][1];
		for (let i = 0; i < y.length; i++) {
			const xi = y[i];
			const yi = b0 * xi + z0;
			z0 = b1 * xi - a1 * yi + z1;
			z1 = b2 * xi - a2 * yi;
			y[i] = yi;
		}
	}
	return y;
}

/** scipy.signal.sosfilt_zi: each section's steady state for a unit step, scaled by the sections before it. */
function sosfiltZi(sos: number[][]): number[][] {
	let scale = 1;
	return sos.map(([b0, b1, b2, a0, a1, a2]) => {
		// lfilter_zi: (I - companion(a).T) zi = b[1:] - a[1:] b0, with a normalised (a0 = 1).
		const B1 = b1 / a0 - (a1 / a0) * (b0 / a0);
		const B2 = b2 / a0 - (a2 / a0) * (b0 / a0);
		const A1 = a1 / a0;
		const A2 = a2 / a0;
		// [[1 + A1, -1], [A2, 1]] zi = [B1, B2]
		const det = 1 + A1 + A2;
		const zi0 = (B1 + B2) / det;
		const zi1 = B2 - A2 * zi0;
		const out = [scale * zi0, scale * zi1];
		scale *= (b0 + b1 + b2) / (a0 + a1 + a2);
		return out;
	});
}

/** scipy.signal.sosfiltfilt (odd extension, padlen 3 (2 n_sections + 1), sosfilt_zi states). */
export function sosFiltFilt(sos: number[][], xIn: ArrayLike<number>): Float64Array {
	const n = xIn.length;
	let zb2 = 0;
	let za2 = 0;
	for (const s of sos) {
		if (s[2] === 0) zb2++;
		if (s[5] === 0) za2++;
	}
	const padlen = Math.min(n - 1, 3 * (2 * sos.length + 1 - Math.min(zb2, za2)));
	const ext = new Float64Array(n + 2 * padlen);
	for (let i = 0; i < padlen; i++) ext[i] = 2 * xIn[0] - xIn[padlen - i];
	for (let i = 0; i < n; i++) ext[padlen + i] = xIn[i];
	for (let i = 0; i < padlen; i++) ext[padlen + n + i] = 2 * xIn[n - 1] - xIn[n - 2 - i];
	const zi = sosfiltZi(sos);
	const x0 = ext[0];
	let y = sosfilt(sos, ext, zi.map((r) => [r[0] * x0, r[1] * x0]));
	y.reverse();
	const y0 = y[0];
	y = sosfilt(sos, y, zi.map((r) => [r[0] * y0, r[1] * y0]));
	y.reverse();
	return y.slice(padlen, padlen + n);
}

// ---------------------------------------------------------------------------------------------------------------
// The frame clock
// ---------------------------------------------------------------------------------------------------------------

/**
 * The frame times on the camera's own steady clock: frames a whole number of periods apart (a dropped frame stays a
 * gap), the period refitted on those counts, plus a slowly varying offset (a 2 s running median of the residual,
 * then its 2 s mean). `fps`: the camera's nominal rate, if known; else the mean of the intervals under HRV_GAP_MS.
 */
export function dejitterFrameTimes(timesMs: readonly number[], fps?: number): number[] {
	const n = timesMs.length;
	if (n < 3) return [...timesMs];
	const s = timesMs.map((t) => t / 1000);
	const d = new Float64Array(n - 1);
	for (let i = 0; i < n - 1; i++) d[i] = s[i + 1] - s[i];
	let T: number;
	if (fps != null && fps > 0) T = 1 / fps;
	else {
		let sum = 0;
		let c = 0;
		for (const v of d)
			if (v > 0 && v <= HRV_GAP_MS / 1000) {
				sum += v;
				c++;
			}
		if (!c) return [...timesMs];
		T = sum / c;
	}
	const counts = (T: number) => {
		const out = new Float64Array(n);
		for (let i = 0; i < n - 1; i++) out[i + 1] = out[i] + Math.max(1, roundHalfEven(d[i] / T));
		return out;
	};
	for (let it = 0; it < 3; it++) {
		const k = counts(T);
		// The least-squares slope of s on k (numpy.polyfit degree 1).
		let mk = 0;
		let ms = 0;
		for (let i = 0; i < n; i++) {
			mk += k[i];
			ms += s[i];
		}
		mk /= n;
		ms /= n;
		let num = 0;
		let den = 0;
		for (let i = 0; i < n; i++) {
			num += (k[i] - mk) * (s[i] - ms);
			den += (k[i] - mk) ** 2;
		}
		T = num / den;
	}
	const k = counts(T);
	const u = new Float64Array(n);
	const r = new Float64Array(n);
	for (let i = 0; i < n; i++) {
		u[i] = s[0] + k[i] * T;
		r[i] = s[i] - u[i];
	}
	const w = roundHalfEven(2 / T) | 1;
	const half = w >> 1;
	const at = (a: Float64Array, i: number) => a[Math.min(n - 1, Math.max(0, i))];
	const med = new Float64Array(n);
	const buf = new Float64Array(w);
	for (let i = 0; i < n; i++) {
		for (let j = 0; j < w; j++) buf[j] = at(r, i - half + j);
		buf.sort();
		med[i] = buf[half];
	}
	const out = new Array<number>(n);
	for (let i = 0; i < n; i++) {
		let acc = 0;
		for (let j = 0; j < w; j++) acc += at(med, i - half + j);
		out[i] = (u[i] + acc / w) * 1000;
	}
	return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Pulse, rate track, beats
// ---------------------------------------------------------------------------------------------------------------

function movingMean(x: Float64Array, w: number): Float64Array {
	const half = w >> 1;
	const n = x.length;
	const p = new Float64Array(n + 1);
	for (let i = 0; i < n; i++) p[i + 1] = p[i] + x[i];
	const out = new Float64Array(n);
	for (let k = 0; k < n; k++) {
		const lo = Math.max(0, k - half);
		const hi = Math.min(n, k + half + 1);
		out[k] = (p[hi] - p[lo]) / (hi - lo);
	}
	return out;
}

/** POS (Wang et al. 2017) over 1.6 s windows at rate fs, in closed form (each window's projection is linear). */
function posAt(R: Float64Array, G: Float64Array, B: Float64Array, fs: number): Float64Array {
	const w = roundHalfEven(1.6 * fs);
	const n = R.length;
	const out = new Float64Array(n);
	if (n < w) return out;
	const cs = (f: (i: number) => number) => {
		const c = new Float64Array(n + 1);
		for (let i = 0; i < n; i++) c[i + 1] = c[i] + f(i);
		return c;
	};
	const sums = [
		cs((i) => R[i]),
		cs((i) => G[i]),
		cs((i) => B[i]),
		cs((i) => G[i] * G[i]),
		cs((i) => B[i] * B[i]),
		cs((i) => R[i] * R[i]),
		cs((i) => G[i] * B[i]),
		cs((i) => G[i] * R[i]),
		cs((i) => B[i] * R[i]),
	];
	const nw = n - w + 1;
	const cgW = new Float64Array(nw);
	const cbW = new Float64Array(nw);
	const crW = new Float64Array(nw);
	for (let m = 0; m < nw; m++) {
		const ws = (c: Float64Array) => (c[m + w] - c[m]) / w;
		const mR = ws(sums[0]);
		const mG = ws(sums[1]);
		const mB = ws(sums[2]);
		const vG = ws(sums[3]) - mG * mG;
		const vB = ws(sums[4]) - mB * mB;
		const vR = ws(sums[5]) - mR * mR;
		const cGB = ws(sums[6]) - mG * mB;
		const cGR = ws(sums[7]) - mG * mR;
		const cBR = ws(sums[8]) - mB * mR;
		const v1 = vG / mG ** 2 + vB / mB ** 2 - (2 * cGB) / (mG * mB);
		const v2 = vG / mG ** 2 + vB / mB ** 2 + (4 * vR) / mR ** 2 + (2 * cGB) / (mG * mB) - (4 * cGR) / (mG * mR) - (4 * cBR) / (mB * mR);
		const sd1 = Math.sqrt(Math.max(v1, 0)) || 1;
		const sd2 = Math.sqrt(Math.max(v2, 0)) || 1;
		const al = sd1 / sd2;
		cgW[m] = (1 + al) / mG;
		cbW[m] = (al - 1) / mB;
		crW[m] = (-2 * al) / mR;
	}
	// For each sample k, the sum of the coefficients of the windows m with m <= k < m + w.
	const cover = (c: Float64Array) => {
		const z = new Float64Array(n + 1);
		for (let m = 0; m < nw; m++) {
			z[m] += c[m];
			z[m + w] -= c[m];
		}
		const o = new Float64Array(n);
		let acc = 0;
		for (let k = 0; k < n; k++) {
			acc += z[k];
			o[k] = acc;
		}
		return o;
	};
	const kg = cover(cgW);
	const kb = cover(cbW);
	const kr = cover(crW);
	for (let k = 0; k < n; k++) out[k] = G[k] * kg[k] + B[k] * kb[k] + R[k] * kr[k];
	return out;
}

function unitSd(x: Float64Array): Float64Array {
	let m = 0;
	for (const v of x) m += v;
	m /= x.length;
	let s = 0;
	for (const v of x) s += (v - m) ** 2;
	s = Math.sqrt(s / x.length) || 1;
	return x.map((v) => (v - m) / s);
}

type Track = { tc: Float64Array; bpm: Float64Array; snr: Float64Array };

/** The rate track: 8 s Hann frames every 0.5 s, the peak in 0.7 to 3.5 Hz (zero-padded to 0.005 Hz), 5-frame median. */
function rateTrack(g: Float64Array, x: Float64Array, fs: number): Track {
	const w = Math.floor(8 * fs);
	const hop = Math.floor(0.5 * fs);
	const nfft = roundHalfEven(fs / 0.005);
	const val = 1 / (nfft * (1 / fs));
	const bins: number[] = [];
	for (let k = 0; k <= nfft >> 1; k++) {
		const f = k * val;
		if (f >= 0.7 && f <= 3.5) bins.push(k);
	}
	const cosT = new Float64Array(nfft);
	const sinT = new Float64Array(nfft);
	for (let j = 0; j < nfft; j++) {
		cosT[j] = Math.cos((2 * Math.PI * j) / nfft);
		sinT[j] = Math.sin((2 * Math.PI * j) / nfft);
	}
	const han = new Float64Array(w);
	for (let i = 0; i < w; i++) han[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (w - 1));
	const starts: number[] = [];
	for (let i = 0; i + w <= x.length; i += hop) starts.push(i);
	const f0 = new Float64Array(starts.length);
	const snr = new Float64Array(starts.length);
	const seg = new Float64Array(w);
	const P = new Float64Array(bins.length);
	starts.forEach((s0, fi) => {
		let m = 0;
		for (let i = 0; i < w; i++) m += x[s0 + i];
		m /= w;
		for (let i = 0; i < w; i++) seg[i] = (x[s0 + i] - m) * han[i];
		let best = 0;
		for (let b = 0; b < bins.length; b++) {
			const k = bins[b];
			let re = 0;
			let im = 0;
			for (let i = 0; i < w; i++) {
				const j = (k * i) % nfft;
				re += seg[i] * cosT[j];
				im -= seg[i] * sinT[j];
			}
			P[b] = re * re + im * im;
			if (P[b] > P[best]) best = b;
		}
		const pk = bins[best] * val;
		let sig = 0;
		let rest = 0;
		for (let b = 0; b < bins.length; b++) {
			const f = bins[b] * val;
			if (Math.abs(f - pk) <= 0.1 || Math.abs(f - 2 * pk) <= 0.1) sig += P[b];
			else rest += P[b];
		}
		f0[fi] = pk;
		snr[fi] = 10 * Math.log10(sig / Math.max(rest, 1e-12));
	});
	const tc = new Float64Array(starts.length);
	const bpm = new Float64Array(starts.length);
	for (let i = 0; i < starts.length; i++) {
		tc[i] = g[starts[i]] + 4;
		bpm[i] = median(f0.subarray(Math.max(0, i - 2), i + 3)) * 60;
	}
	return { tc, bpm, snr };
}

/** Beats at the 2 pi crossings of the phase of the tracking band (complex demodulation on the rate track). */
function trackingBeats(gu: Float64Array, y: Float64Array, tr: Track, halfHz: number, up: number): number[] {
	const n = y.length;
	const f = interp(gu, tr.tc, tr.bpm.map((b) => b / 60));
	const ph = new Float64Array(n);
	let acc = 0;
	for (let i = 0; i < n; i++) {
		acc += f[i];
		ph[i] = (2 * Math.PI * acc) / up;
	}
	const yi = hilbertImag(Array.from(y));
	const zr = new Float64Array(n);
	const zi = new Float64Array(n);
	for (let i = 0; i < n; i++) {
		const c = Math.cos(ph[i]);
		const s = Math.sin(ph[i]);
		zr[i] = y[i] * c + yi[i] * s;
		zi[i] = yi[i] * c - y[i] * s;
	}
	const sos = butterworthSos(4, halfHz, up);
	const lr = sosFiltFilt(sos, zr);
	const li = sosFiltFilt(sos, zi);
	// Phase of (lr + i li) e^{i ph}, unwrapped as numpy.unwrap does.
	const uw = new Float64Array(n);
	let prev = 0;
	let corr = 0;
	for (let i = 0; i < n; i++) {
		const c = Math.cos(ph[i]);
		const s = Math.sin(ph[i]);
		const a = Math.atan2(li[i] * c + lr[i] * s, lr[i] * c - li[i] * s);
		if (i > 0) {
			const dd = a - prev;
			let ddm = ((((dd + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) - Math.PI;
			if (ddm === -Math.PI && dd > 0) ddm = Math.PI;
			if (Math.abs(dd) >= Math.PI) corr += ddm - dd;
		}
		prev = a;
		uw[i] = a + corr;
	}
	const beats: number[] = [];
	const TWO_PI = 2 * Math.PI;
	for (let i = 0; i < n - 1; i++) {
		const k0 = Math.floor(uw[i] / TWO_PI);
		const k1 = Math.floor(uw[i + 1] / TWO_PI);
		if (k1 > k0) {
			const lv = (k0 + 1) * TWO_PI;
			beats.push(gu[i] + (lv - uw[i]) / (uw[i + 1] - uw[i]) / up);
		}
	}
	return beats;
}

/** Spans (ms) between consecutive frames more than HRV_GAP_MS apart. */
export function frameGaps(timesMs: readonly number[]): [number, number][] {
	const out: [number, number][] = [];
	for (let i = 0; i < timesMs.length - 1; i++)
		if (timesMs[i + 1] - timesMs[i] > HRV_GAP_MS) out.push([timesMs[i], timesMs[i + 1]]);
	return out;
}

/**
 * HRV over a window from beat times (ms): intervals 0.3 to 2 s, none touching a gap (within 50 ms of it), each within
 * 20% of the median of the kept intervals among the 11 around it; rMSSD over adjacent kept pairs whose midpoints lie
 * in [w0, w1] (at least 5), SDNN (sample sd) over the kept ones (at least 6).
 */
export function hrvFromBeats(
	beatTimesMs: readonly number[],
	gapsMs: readonly (readonly [number, number])[],
	w0: number,
	w1: number,
): { rmssdMs: number | null; sdnnMs: number | null; intervals: number; kept: number; pairs: number } {
	const bt = [...beatTimesMs].sort((a, b) => a - b);
	const none = { rmssdMs: null, sdnnMs: null, intervals: 0, kept: 0, pairs: 0 };
	if (bt.length < 3) return none;
	const m = bt.length - 1;
	const ibi = new Float64Array(m);
	const mid = new Float64Array(m);
	const ok = new Array<boolean>(m);
	for (let i = 0; i < m; i++) {
		const a = bt[i];
		const b = bt[i + 1];
		ibi[i] = b - a;
		mid[i] = (a + b) / 2;
		ok[i] = ibi[i] > 300 && ibi[i] < 2000 && !gapsMs.some(([g0, g1]) => a < g1 + 50 && b > g0 - 50);
	}
	const half = 5;
	const med = new Float64Array(m);
	for (let i = 0; i < m; i++) {
		const near: number[] = [];
		for (let j = Math.max(0, i - half); j <= Math.min(m - 1, i + half); j++) if (ok[j]) near.push(ibi[j]);
		med[i] = near.length ? median(near) : Number.NaN;
	}
	const kept = ok.map((o, i) => o && Math.abs(ibi[i] - med[i]) <= 0.2 * med[i]);
	const I: number[] = [];
	const O: boolean[] = [];
	for (let i = 0; i < m; i++)
		if (mid[i] >= w0 && mid[i] <= w1) {
			I.push(ibi[i]);
			O.push(kept[i]);
		}
	const dif: number[] = [];
	for (let i = 0; i < I.length - 1; i++) if (O[i] && O[i + 1]) dif.push(I[i + 1] - I[i]);
	const nn = I.filter((_, i) => O[i]);
	let sdnn: number | null = null;
	if (nn.length >= 6) {
		const mu = nn.reduce((a, b) => a + b, 0) / nn.length;
		sdnn = Math.sqrt(nn.reduce((a, b) => a + (b - mu) ** 2, 0) / (nn.length - 1));
	}
	return {
		rmssdMs: dif.length >= 5 ? Math.sqrt(dif.reduce((a, b) => a + b * b, 0) / dif.length) : null,
		sdnnMs: sdnn,
		intervals: I.length,
		kept: nn.length,
		pairs: dif.length,
	};
}

/**
 * HRV (rMSSD, SDNN) over a window from the face regions' colours, by the tracking-band beat timer (see the top of
 * this file). Experimental: not a measurement, and not to be shown to a person.
 */
export function hrvFromRegions(frames: readonly HrvRegionFrame[], options: HrvWindowOptions = {}): HrvWindowResult {
	const windowS = options.windowS ?? 60;
	const halfHz = options.trackHalfHz ?? HRV_TRACK_HALF_HZ;
	const minSnr = options.minSnrDb ?? HRV_MIN_SNR_DB;
	const ok = frames.filter((f) => Number.isFinite(f.t) && f.regions.length >= 1);
	const raw = ok.map((f) => f.t);
	const tMs = options.dejitter === false ? raw : dejitterFrameTimes(raw);
	const lastMs = tMs.length ? tMs[tMs.length - 1] : 0;
	const w1 = options.windowEndMs ?? lastMs - 1000;
	const w0 = options.windowStartMs ?? w1 - windowS * 1000;
	const empty: HrvWindowResult = {
		rmssdMs: null,
		sdnnMs: null,
		snrDb: null,
		centreBpm: null,
		intervals: 0,
		kept: 0,
		pairs: 0,
		gated: false,
		reason: "short",
		windowStartMs: w0,
		windowEndMs: w1,
		beatTimesMs: [],
	};
	if (tMs.length < 300 || tMs[0] > w0 - HRV_LEAD_S * 1000 || lastMs < w1) return empty;
	const t = tMs.map((v) => v / 1000);
	const diffs: number[] = [];
	for (let i = 1; i < t.length; i++) if (t[i] - t[i - 1] <= HRV_GAP_MS / 1000) diffs.push(t[i] - t[i - 1]);
	const fs = options.sampleRate ?? roundHalfEven(1 / median(diffs));
	const g = arange(t[0], t[t.length - 1], 1 / fs);
	const nReg = Math.min(...ok.map((f) => f.regions.length));
	const x = new Float64Array(g.length);
	const winDetrend = Math.max(1, roundHalfEven(fs * 1.5));
	for (let reg = 0; reg < nReg; reg++) {
		const ch = (["r", "g", "b"] as const).map((c) => {
			const v = ok.map((f) => f.regions[reg][c]);
			// Missing values (NaN) filled linearly, as the lab's fill_nan.
			const good = v.map((q) => Number.isFinite(q));
			const vv = good.every(Boolean)
				? v
				: Array.from(interp(t, t.filter((_, i) => good[i]), v.filter((_, i) => good[i])));
			return cubicSplineNotAKnot(t, vv, g);
		});
		const p = posAt(ch[0], ch[1], ch[2], fs);
		const tr = movingMean(movingMean(p, winDetrend), winDetrend);
		const u = unitSd(p.map((v, i) => v - tr[i]));
		for (let i = 0; i < x.length; i++) x[i] += u[i];
	}
	const track = rateTrack(g, x, fs);
	const xb = sosFiltFilt(butterworthSos(4, [0.7, 3.5], fs), x);
	const gu = arange(g[0], g[g.length - 1], 1 / HRV_UPSAMPLE_HZ);
	const yu = cubicSplineNotAKnot(g, xb, gu);
	const beats = trackingBeats(gu, yu, track, halfHz, HRV_UPSAMPLE_HZ).map((b) => b * 1000);
	const h = hrvFromBeats(beats, frameGaps(tMs), w0, w1);
	const inWin: number[] = [];
	const bpmWin: number[] = [];
	for (let i = 0; i < track.tc.length; i++)
		if (track.tc[i] * 1000 >= w0 && track.tc[i] * 1000 <= w1) {
			inWin.push(track.snr[i]);
			bpmWin.push(track.bpm[i]);
		}
	const snrDb = inWin.length ? median(inWin) : null;
	const gated = snrDb == null || snrDb < minSnr;
	return {
		...h,
		rmssdMs: gated ? null : h.rmssdMs,
		sdnnMs: gated ? null : h.sdnnMs,
		snrDb,
		centreBpm: bpmWin.length ? median(bpmWin) : null,
		gated,
		reason: gated ? "gated" : null,
		windowStartMs: w0,
		windowEndMs: w1,
		beatTimesMs: beats,
	};
}

/** How long HrvRegionBuffer keeps frames, seconds: a 60 s window, its 1 s edge guard and HRV_LEAD_S, with room. */
export const HRV_KEEP_S = 70;
/** HrvRegionBuffer recomputes at most once per this many ms of frames (a 60 s window moves little in a second). */
export const HRV_READ_EVERY_MS = 1000;

/**
 * The newest frames of the three face regions (forehead, left cheek, right cheek) for hrvFromRegions, fed by the
 * session's runner with the regions the pulse check reads; `read()` gives the latest window's HRV, or null before
 * any frame. Experimental (the session's `experimentalHrv: "tracking"`).
 */
export class HrvRegionBuffer {
	private frames: HrvRegionFrame[] = [];
	private last: { at: number; result: HrvWindowResult } | null = null;
	constructor(
		private readonly keepS = HRV_KEEP_S,
		private readonly options: HrvWindowOptions = {},
	) {}

	get size(): number {
		return this.frames.length;
	}

	push(timestampMs: number, regions: readonly { r: number; g: number; b: number }[]): void {
		if (regions.length < 3 || !Number.isFinite(timestampMs)) return;
		this.frames.push({ t: timestampMs, regions: regions.slice(0, 3).map((q) => ({ r: q.r, g: q.g, b: q.b })) });
		let drop = 0;
		while (drop < this.frames.length && this.frames[drop].t < timestampMs - this.keepS * 1000) drop++;
		if (drop) this.frames.splice(0, drop);
	}

	reset(): void {
		this.frames = [];
		this.last = null;
	}

	read(): HrvWindowResult | null {
		const n = this.frames.length;
		if (!n) return null;
		const at = this.frames[n - 1].t;
		if (this.last && at - this.last.at < HRV_READ_EVERY_MS && at >= this.last.at) return this.last.result;
		const result = hrvFromRegions(this.frames, this.options);
		this.last = { at, result };
		return result;
	}
}
