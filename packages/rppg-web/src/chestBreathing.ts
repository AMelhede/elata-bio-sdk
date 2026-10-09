import type { FaceLandmarkPoint, Frame } from "./frameSource";

/**
 * Breathing rate from chest and shoulder motion, read in a box below the chin.
 *
 * Why motion and not the face's colour: on recorded captures against a finger-sensor breathing
 * reference, breathing read from the face pulse missed by more than always saying the median, while the
 * vertical motion of a box below the chin agreed within 2 breaths a minute in most windows. The same
 * principle is what a cleared product reads (FaceHeart FH Vitals SDK-RR, FDA K243966, April 2025:
 * chest-wall movement on video, spot checks of a still adult, RMSE 1.2 breaths a minute), and optical
 * flow on the chest reached a bias of -0.03 +- 1.38 breaths a minute in a 24-volunteer study (Massaroni
 * et al., Sensors 2021). Wang and den Brinker (Physiol. Meas. 2022) benchmark the motion estimators this
 * rests on. Box, window, band and filter: value chosen by measurement on recorded captures against a
 * reference breathing rate.
 *
 * Experimental: off unless an app asks for it, and not validated beyond the numbers above.
 */

/** The box: centred under the face, this many face widths wide (as measured). */
export const CHEST_BOX_WIDTH = 1.6;
/** From this many face heights below the chin ... */
export const CHEST_BOX_TOP = 0.15;
/** ... to this many. */
export const CHEST_BOX_BOTTOM = 1.15;
/** Below this many pixels high (after halving) the box is not read. */
const CHEST_BOX_MIN_ROWS = 10;
/** The box is anchored on the first face and moves only when the face moves this many face widths. */
export const CHEST_BOX_REANCHOR = 0.5;

/** The rate is read over this window, resampled at this rate, in this band (6 to 36 breaths a minute). */
export const CHEST_BREATH_WINDOW_S = 32;
export const CHEST_BREATH_FS = 4;
export const CHEST_BREATH_BAND_HZ = [0.1, 0.6] as const;
/** A window needs samples over this share of it, at this many a second or more. */
const CHEST_BREATH_COVERAGE = 0.9;
const CHEST_BREATH_MIN_RATE = 10;
/** The rate's line: power within this many hertz of the peak, as a share of the band's (the Hann main lobe of 32 s). */
export const CHEST_BREATH_SHARE_HALF_HZ = 0.05;
const CHEST_BREATH_NFFT = 2048;

/**
 * Second-order Butterworth band-pass, 0.1 to 0.6 Hz at 4 Hz (scipy.signal.butter(2, [0.1, 0.6], "band",
 * fs=4)), run forward and backward as scipy's filtfilt (odd extension of 15 samples, steady-state start
 * from lfilter_zi): the filter the measurement above used.
 */
const BP_B = [0.0976310729378175, 0.0, -0.195262145875635, 0.0, 0.0976310729378175];
const BP_A = [1.0, -2.715892166218743, 2.8814630412347912, -1.4853707481482175, 0.33333333333333304];
const BP_ZI = [-0.09763107293782074, -0.09763107293781194, 0.09763107293781377, 0.09763107293781856];
const BP_PAD = 15;

function lfilter(x: readonly number[], z0: number): number[] {
	const z = BP_ZI.map((v) => v * z0);
	const y = new Array<number>(x.length);
	for (let n = 0; n < x.length; n++) {
		const yn = BP_B[0] * x[n] + z[0];
		for (let k = 1; k < BP_B.length; k++) {
			const next = k < BP_B.length - 1 ? z[k] : 0;
			z[k - 1] = BP_B[k] * x[n] + next - BP_A[k] * yn;
		}
		y[n] = yn;
	}
	return y;
}

/** scipy.signal.filtfilt(BP_B, BP_A, x) with its defaults. Null when x is too short to pad. */
export function bandPass(x: readonly number[]): number[] | null {
	const n = x.length;
	if (n <= BP_PAD) return null;
	const ext: number[] = [];
	for (let i = BP_PAD; i >= 1; i--) ext.push(2 * x[0] - x[i]);
	for (const v of x) ext.push(v);
	for (let i = n - 2; i >= n - 1 - BP_PAD; i--) ext.push(2 * x[n - 1] - x[i]);
	const fwd = lfilter(ext, ext[0]);
	const back = lfilter([...fwd].reverse(), fwd[fwd.length - 1]).reverse();
	return back.slice(BP_PAD, BP_PAD + n);
}

/** One sample: the frame's time (ms) and the box's vertical shift since the frame before, in face heights. */
export type ChestSample = [timestampMs: number, shift: number];

/**
 * The breathing rate over the window ending at `atMs`: the shifts added up into the box's position,
 * resampled at CHEST_BREATH_FS, its straight-line trend removed, band-passed, and the strongest line of a
 * Hann-windowed spectrum in the band. `share` is that line's power over the band's (1 for a pure
 * rhythm, near 0 for noise). Null when the window is not covered.
 */
export function breathingFromMotion(
	samples: readonly ChestSample[],
	atMs: number,
	windowS = CHEST_BREATH_WINDOW_S,
): { rate: number; share: number } | null {
	const from = atMs - windowS * 1000;
	const win = samples.filter((s) => s[0] > from && s[0] <= atMs && Number.isFinite(s[1]));
	if (win.length < CHEST_BREATH_COVERAGE * windowS * CHEST_BREATH_MIN_RATE) return null;
	const t = win.map((s) => s[0] / 1000);
	if (t[t.length - 1] - t[0] < CHEST_BREATH_COVERAGE * windowS) return null;
	// No large holes inside: the same share of the window's 1 s stretches must each hold a sample, so a
	// window that is mostly missing is not read through a straight line drawn across the gap.
	const bins = new Uint8Array(Math.ceil(windowS));
	for (const s of win) bins[Math.min(bins.length - 1, Math.floor((s[0] - from) / 1000))] = 1;
	if (bins.reduce((n, b) => n + b, 0) < CHEST_BREATH_COVERAGE * bins.length) return null;
	const z: number[] = [];
	let acc = 0;
	for (const s of win) {
		acc += s[1];
		z.push(acc);
	}
	// Resample at CHEST_BREATH_FS from the first sample (numpy.arange(t0, t1, 1 / fs) with interp).
	const y: number[] = [];
	let j = 0;
	for (let k = 0; ; k++) {
		const g = t[0] + k / CHEST_BREATH_FS;
		if (g >= t[t.length - 1]) break;
		while (j < t.length - 2 && t[j + 1] < g) j++;
		const span = t[j + 1] - t[j] || 1;
		const a = Math.min(1, Math.max(0, (g - t[j]) / span));
		y.push(z[j] + a * (z[j + 1] - z[j]));
	}
	const n = y.length;
	if (n <= BP_PAD + 1) return null;
	// Straight-line trend (numpy.polyfit degree 1) removed.
	const tu = y.map((_, k) => k / CHEST_BREATH_FS);
	const mt = tu.reduce((s, v) => s + v, 0) / n;
	const my = y.reduce((s, v) => s + v, 0) / n;
	let sxy = 0;
	let sxx = 0;
	for (let k = 0; k < n; k++) {
		sxy += (tu[k] - mt) * (y[k] - my);
		sxx += (tu[k] - mt) ** 2;
	}
	const slope = sxx > 0 ? sxy / sxx : 0;
	const flat = y.map((v, k) => v - (my + slope * (tu[k] - mt)));
	const f = bandPass(flat);
	if (!f) return null;
	const mean = f.reduce((s, v) => s + v, 0) / n;
	const w = f.map((v, k) => (v - mean) * (0.5 - 0.5 * Math.cos((2 * Math.PI * k) / (n - 1))));
	const [lo, hi] = CHEST_BREATH_BAND_HZ;
	const freqs: number[] = [];
	const power: number[] = [];
	for (let b = 0; b <= CHEST_BREATH_NFFT / 2; b++) {
		const fr = (b * CHEST_BREATH_FS) / CHEST_BREATH_NFFT;
		if (fr < lo) continue;
		if (fr > hi) break;
		let re = 0;
		let im = 0;
		for (let k = 0; k < n; k++) {
			const ang = (2 * Math.PI * b * k) / CHEST_BREATH_NFFT;
			re += w[k] * Math.cos(ang);
			im -= w[k] * Math.sin(ang);
		}
		freqs.push(fr);
		power.push(re * re + im * im);
	}
	const total = power.reduce((s, v) => s + v, 0);
	if (!(total > 0)) return null;
	let best = 0;
	for (let i = 1; i < power.length; i++) if (power[i] > power[best]) best = i;
	let line = 0;
	for (let i = 0; i < power.length; i++)
		if (Math.abs(freqs[i] - freqs[best]) <= CHEST_BREATH_SHARE_HALF_HZ) line += power[i];
	return { rate: freqs[best] * 60, share: line / total };
}

/**
 * The box's vertical shift between two grey images of the same size, in pixels (positive: the image
 * content moved down): a single-parameter Lucas-Kanade fit, -sum(Iy It) / sum(Iy^2), with Iy the central
 * difference of the two frames' mean. Null when the box has no vertical texture.
 */
export function verticalShift(prev: Float32Array, cur: Float32Array, w: number, h: number): number | null {
	let num = 0;
	let den = 0;
	for (let y = 1; y < h - 1; y++) {
		const r = y * w;
		for (let x = 0; x < w; x++) {
			const i = r + x;
			const iy = (prev[i + w] - prev[i - w] + cur[i + w] - cur[i - w]) / 4;
			const it = cur[i] - prev[i];
			num += iy * it;
			den += iy * iy;
		}
	}
	return den > 1e-9 ? -num / den : null;
}

/** The box below the chin, in pixels, from the face's landmarks; null when it does not fit the frame. */
export function chestBox(
	landmarks: readonly FaceLandmarkPoint[],
	width: number,
	height: number,
): { x0: number; y0: number; x1: number; y1: number; faceWidth: number; faceHeight: number } | null {
	let minX = Infinity;
	let minY = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;
	for (const p of landmarks) {
		const x = (p.x ?? 0) * width;
		const y = (p.y ?? 0) * height;
		if (x < minX) minX = x;
		if (x > maxX) maxX = x;
		if (y < minY) minY = y;
		if (y > maxY) maxY = y;
	}
	const fw = maxX - minX;
	const fh = maxY - minY;
	if (!(fw > 0 && fh > 0)) return null;
	const cx = (minX + maxX) / 2;
	const x0 = Math.max(0, Math.floor(cx - (CHEST_BOX_WIDTH / 2) * fw));
	const x1 = Math.min(width, Math.floor(cx + (CHEST_BOX_WIDTH / 2) * fw));
	const y0 = Math.min(height, Math.floor(maxY + CHEST_BOX_TOP * fh));
	const y1 = Math.min(height, Math.floor(maxY + CHEST_BOX_BOTTOM * fh));
	if ((y1 - y0) / 2 < CHEST_BOX_MIN_ROWS || (x1 - x0) / 2 < CHEST_BOX_MIN_ROWS) return null;
	return { x0, y0, x1, y1, faceWidth: fw, faceHeight: fh };
}

/** The box as grey (BT.601 luma) at half size, each output pixel the mean of a 2x2 block. */
export function greyHalf(frame: Pick<Frame, "data" | "width">, box: { x0: number; y0: number; x1: number; y1: number }): { data: Float32Array; w: number; h: number } {
	const w = Math.floor((box.x1 - box.x0) / 2);
	const h = Math.floor((box.y1 - box.y0) / 2);
	const out = new Float32Array(w * h);
	const d = frame.data;
	const W = frame.width;
	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			let s = 0;
			for (let dy = 0; dy < 2; dy++) {
				const row = (box.y0 + 2 * y + dy) * W;
				for (let dx = 0; dx < 2; dx++) {
					const i = (row + box.x0 + 2 * x + dx) * 4;
					s += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
				}
			}
			out[y * w + x] = s / 4;
		}
	}
	return { data: out, w, h };
}

/** How long the motion keeps: the rate window and a little more. */
const CHEST_KEEP_MS = (CHEST_BREATH_WINDOW_S + 4) * 1000;

/** No chest box, or no frames at all, for longer than this: the motion so far is dropped. */
const CHEST_GAP_MS = 1000;

/**
 * Follows the box below the chin frame by frame. The box is anchored on the first face and kept still
 * (a box that followed every small head movement would carry the head's motion into the chest's); it is
 * re-anchored, and the motion so far dropped, when the face moves CHEST_BOX_REANCHOR face widths or the frame
 * changes size. The motion is dropped when there is no chest box (no face, or the chest out of view) or no
 * frame for over CHEST_GAP_MS, and no rate is given while frames have stopped (by `now`, a wall clock, since
 * the frames' own media clock stops with them).
 */
export class ChestMotion {
	private box: (NonNullable<ReturnType<typeof chestBox>> & { frameW: number; frameH: number }) | null = null;
	private prev: { data: Float32Array; w: number; h: number } | null = null;
	private lastBoxMs: number | null = null;
	private lastFrameMs: number | null = null;
	private lastPushAt: number | null = null;
	private samples: ChestSample[] = [];
	private readonly now: () => number;

	constructor(opts: { now?: () => number } = {}) {
		this.now = opts.now ?? (() => (typeof performance !== "undefined" ? performance.now() : Date.now()));
	}

	push(frame: Pick<Frame, "data" | "width" | "height" | "timestampMs">, landmarks: readonly FaceLandmarkPoint[] | null | undefined): void {
		const t = frame.timestampMs;
		if (t == null || !Number.isFinite(t)) return;
		// Frames that stopped (a hidden tab) or a clock that went back: no shift is taken across the gap.
		if (this.lastFrameMs != null && (t - this.lastFrameMs > CHEST_GAP_MS || t < this.lastFrameMs)) this.reset();
		this.lastFrameMs = t;
		this.lastPushAt = this.now();
		const now = landmarks && landmarks.length >= 3 ? chestBox(landmarks, frame.width, frame.height) : null;
		if (!now) {
			if (this.lastBoxMs != null && t - this.lastBoxMs > CHEST_GAP_MS) this.reset();
			return;
		}
		this.lastBoxMs = t;
		const b = this.box;
		const moved =
			b != null &&
			(b.frameW !== frame.width ||
				b.frameH !== frame.height ||
				Math.hypot((now.x0 + now.x1 - b.x0 - b.x1) / 2, now.y0 - b.y0) > CHEST_BOX_REANCHOR * b.faceWidth);
		if (b == null || moved) {
			this.box = { ...now, frameW: frame.width, frameH: frame.height };
			this.prev = null;
			this.samples = [];
		}
		const grey = greyHalf(frame, this.box!);
		if (this.prev && this.prev.w === grey.w && this.prev.h === grey.h) {
			const px = verticalShift(this.prev.data, grey.data, grey.w, grey.h);
			if (px != null) this.samples.push([t, (2 * px) / this.box!.faceHeight]);
		}
		this.prev = grey;
		while (this.samples.length && this.samples[0][0] < t - CHEST_KEEP_MS) this.samples.shift();
	}

	/** The rate over the window ending at the latest frame (or `atMs`), or null; null while frames have stopped. */
	rate(atMs?: number): { rate: number; share: number } | null {
		if (!this.samples.length || this.lastFrameMs == null) return null;
		if (this.lastPushAt != null && this.now() - this.lastPushAt > CHEST_GAP_MS) return null;
		return breathingFromMotion(this.samples, atMs ?? this.lastFrameMs);
	}

	/** The motion kept (for recording and replay). */
	getSamples(): readonly ChestSample[] {
		return this.samples;
	}

	reset(): void {
		this.box = null;
		this.prev = null;
		this.lastBoxMs = null;
		this.samples = [];
	}
}
