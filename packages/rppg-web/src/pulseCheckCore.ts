/**
 * Real-pulse check, the estimator. Pure: it takes the per-frame mean colour of three skin
 * regions (forehead, left cheek, right cheek), optionally with a patch of wall beside the
 * face, and returns per-region estimates and a verdict. No DOM and no SDK state, so it runs
 * the same in a browser, in unit tests and offline. See pulseCheck.ts for how the SDK uses it.
 *
 * Each region's pulse is read with POS (Wang et al., IEEE TBME 2017). A pulse is the one
 * rhythm all three regions share; noise is not shared, so the check asks the regions to agree
 * on one rate, clearly above the noise, over consecutive windows before it reports anything.
 * The thresholds below were chosen by measurement on recorded captures against a reference
 * pulse sensor; the measurement notes are kept in the source repository, not in this package.
 */
/**
 * [timestampMs, foreheadR, G, B, leftCheekR, G, B, rightCheekR, G, B], optionally followed by
 * the wall beside the face [wallR, G, B] (NaN when it was not visible in that frame), and after
 * that optionally the same wall as the camera read it [R, G, B]: the patch's own colour, before
 * the runner rescales a new patch to carry on from the last one (WallTracker in pulseCheck.ts).
 * Without that reading the wall columns are taken as read.
 */
export type RawRoiSample = [
	number,
	number,
	number,
	number,
	number,
	number,
	number,
	number,
	number,
	number,
	...number[],
];

/** Analysis sample rate: above twice the 3 Hz band edge, below any camera. */
export const OWN_PULSE_FS = 20;
/** Heart-rate band, Hz: 42 to 180 bpm, the SDK's own limits. */
export const OWN_PULSE_BAND_HZ: readonly [number, number] = [0.7, 3.0];
/**
 * Window, seconds. Spectral resolution is 60/window bpm: 16 s gives 3.75 bpm,
 * enough to separate cheeks that agree from cheeks that do not, and short
 * enough that a 60 s capture yields several independent verdicts.
 */
export const OWN_PULSE_WINDOW_S = 16;
/** Two regions agreeing within this many bpm counts as agreement (one bin + a half). */
export const OWN_PULSE_AGREE_BPM = 6;

export type RegionName = "forehead" | "leftCheek" | "rightCheek";
export const REGIONS: readonly RegionName[] = [
	"forehead",
	"leftCheek",
	"rightCheek",
];

export interface RegionEstimate {
	region: RegionName;
	bpm: number;
	/** de Haan SNR, dB: power within 0.1 Hz of the peak and its harmonic over the rest of the band. */
	snrDb: number;
	/** Mean R, G, B over the window, for the saturation check. */
	meanRgb: [number, number, number];
}

export interface OwnPulseEstimate {
	windowS: number;
	frames: number;
	fps: number;
	regions: RegionEstimate[];
	/** Regions whose own peak sits within OWN_PULSE_AGREE_BPM of the combined line. */
	agreeing: RegionName[];
	/** The line in the three regions' combined spectrum, or null when there is no line. */
	bpm: number | null;
	/** That line's SNR in the combined spectrum, dB, or null. */
	snrDb: number | null;
	/**
	 * The same line's rate estimated between bins (fineBpm), for the rate the
	 * app REPORTS. Everything that decides (agreement, streaks, holds) stays on
	 * `bpm`, the bin. Optional so a hand-built estimate need not carry it.
	 */
	bpmFine?: number | null;
	/**
	 * How far the line stands above its runner-up, dB: the strongest local maximum of the same whitened spectrum in the
	 * band at least CLEAR_RUNNER_UP_BPM away on either side (Infinity with none, null with no line). Rule clearWindows.
	 */
	lineMarginDb?: number | null;
	/** Rule trackLine: the window's whitened combined spectrum in the band, [bpm, power] per bin (only when asked for). */
	band?: Array<[number, number]>;
	/** How the pulse was read from the colours this window (see OWN_PULSE_COLOUR_DAMAGE). */
	method?: "pos" | "greenMinusWall";
	/** The colour-damage measure this window (see OWN_PULSE_COLOUR_DAMAGE), or null. */
	colourDamage?: number | null;
	/** Whether the wall beside the face was seen through the whole window. */
	wallSeen?: boolean;
	/**
	 * The wall's mean level over the window as the camera saw it: R + G + B of the patch or patches
	 * read, each on the scale handed over, before any rescaling between patches (a diagnostic; rule
	 * darkWall judges wallToFace). Null when
	 * the wall was not seen through the whole window.
	 */
	wallLevel?: number | null;
	/**
	 * The wall against the face, as rule darkWall judges it: per sample, the wall's R + G + B as the
	 * camera saw it over the three regions' mean R + G + B, at the window's
	 * OWN_PULSE_SWAP_WALL_QUANTILE (its darkest tenth). Independent of the colour scale and of the
	 * camera's exposure. Null when the wall was not seen through the whole window.
	 */
	wallToFace?: number | null;
}

export function resample(
	t: number[],
	v: number[],
	from: number,
	to: number,
): number[] {
	const out: number[] = [];
	let j = 0;
	for (let g = from; g <= to; g += 1 / OWN_PULSE_FS) {
		while (j < t.length - 2 && t[j + 1] < g) j++;
		const span = t[j + 1] - t[j] || 1;
		const a = Math.min(1, Math.max(0, (g - t[j]) / span));
		out.push(v[j] + a * (v[j + 1] - v[j]));
	}
	return out;
}

function movingMean(x: number[], w: number): number[] {
	const half = w >> 1;
	const prefix = [0];
	for (const v of x) prefix.push(prefix[prefix.length - 1] + v);
	return x.map((_, k) => {
		const lo = Math.max(0, k - half);
		const hi = Math.min(x.length, k + half + 1);
		return (prefix[hi] - prefix[lo]) / (hi - lo);
	});
}

/**
 * Remove drift slower than the band: subtract a 2 s TRIANGULAR moving mean
 * (a 2 s moving mean applied twice).
 *
 * Value chosen by measurement on recorded captures against a reference pulse.
 */
/**
 * The high-pass before the pulse is read: a double moving mean this many
 * seconds wide.
 *
 * Value chosen by measurement on recorded captures against a reference pulse.
 */
export const OWN_PULSE_DETREND_S = 1.5;

export function detrend(x: number[], seconds = 2): number[] {
	const w = Math.max(1, Math.round(OWN_PULSE_FS * seconds));
	const trend = movingMean(movingMean(x, w), w);
	return x.map((v, k) => v - trend[k]);
}

/**
 * A window length's Hann window and its N cosines and sines (of 2 pi k / N), made once per length:
 * bin fi at sample k reads entry (fi k) mod N. The check sees a handful of lengths (its windows at
 * the camera's rates), so the cache stays small; it is cleared past SPECTRUM_TABLES_MAX lengths.
 */
const spectrumTables = new Map<number, { han: Float64Array; cos: Float64Array; sin: Float64Array }>();
const SPECTRUM_TABLES_MAX = 32;
function tablesFor(N: number) {
	let t = spectrumTables.get(N);
	if (!t) {
		if (spectrumTables.size >= SPECTRUM_TABLES_MAX) spectrumTables.clear();
		const han = new Float64Array(N);
		const cos = new Float64Array(N);
		const sin = new Float64Array(N);
		for (let k = 0; k < N; k++) {
			han[k] = 0.5 - 0.5 * Math.cos((2 * Math.PI * k) / (N - 1));
			cos[k] = Math.cos((2 * Math.PI * k) / N);
			sin[k] = Math.sin((2 * Math.PI * k) / N);
		}
		t = { han, cos, sin };
		spectrumTables.set(N, t);
	}
	return t;
}

/**
 * Hann-windowed power spectrum over the band and a little either side. The values of the textbook
 * transform (a cosine and a sine per bin per sample), read from tables made once per window length:
 * those sines and cosines were half the check's time, measured on recorded input.
 */
export function spectrum(x: number[]): Array<[number, number]> {
	const N = x.length;
	const out: Array<[number, number]> = [];
	if (N < 2) return out;
	const { han: w, cos, sin } = tablesFor(N);
	const han = new Float64Array(N);
	for (let k = 0; k < N; k++) han[k] = x[k] * w[k];
	for (let fi = 1; fi < N / 2; fi++) {
		const f = (fi * OWN_PULSE_FS) / N;
		if (f > 4) break;
		let re = 0;
		let im = 0;
		let j = 0;
		for (let k = 0; k < N; k++) {
			re += han[k] * cos[j];
			im -= han[k] * sin[j];
			j += fi;
			if (j >= N) j -= N;
		}
		out.push([f, re * re + im * im]);
	}
	return out;
}

/**
 * Weight of a line's second harmonic when choosing the line (harmonic
 * summation, as in pitch detection). A heartbeat is not a sine: its sharp
 * upstroke puts a line at twice the rate, which the band-floor noise that
 * fooled the estimator in poor light does not have.
 *
 * Value chosen by measurement on recorded captures against a reference pulse.
 */
export const OWN_PULSE_HARMONIC_WEIGHT = 0.5;

/**
 * The strongest in-band LINE of a spectrum and its de Haan SNR. NaN when the
 * maximum is not a local peak. With `harmonicWeight`, the line is chosen on
 * its power plus that share of its second harmonic's; the SNR is unchanged.
 */
export function peakOfSpectrum(
	P: Array<[number, number]>,
	harmonicWeight = 0,
	/** The spectrum as measured, when `P` is a reshaped copy of it (whitenedSpectrum). */
	measured?: Array<[number, number]>,
): { bpm: number; snrDb: number } {
	const [lo, hi] = OWN_PULSE_BAND_HZ;
	// The SNR is always judged on the spectrum as measured, which the -3 dB bar was set on.
	const measuredBand = (measured ?? P).filter(([f]) => f >= lo && f <= hi);
	if (harmonicWeight > 0) {
		// Nearest bin to twice each frequency; none when it lies past the spectrum.
		const step = P.length > 1 ? P[1][0] - P[0][0] : 0;
		const at = (hz: number) => {
			const i = step > 0 ? Math.round((hz - P[0][0]) / step) : -1;
			return i >= 0 && i < P.length ? P[i][1] : 0;
		};
		// biome-ignore lint/style/noParameterAssign: kept as in the source this was measured as
		P = P.map(
			([f, p]) => [f, p + harmonicWeight * at(2 * f)] as [number, number],
		);
	}
	const band = P.filter(([f]) => f >= lo && f <= hi);
	if (!band.length) return { bpm: NaN, snrDb: -Infinity };
	const peak = band.reduce((a, b) => (b[1] > a[1] ? b : a));
	// A line is a local maximum. The largest in-band bin with a larger bin just
	// below the band is the skirt of below-band drift (breathing, slow motion)
	// running into the band floor, not a pulse.
	const i = P.indexOf(peak);
	const below = P[i - 1];
	const above = P[i + 1];
	if ((below && below[1] >= peak[1]) || (above && above[1] >= peak[1]))
		return { bpm: NaN, snrDb: -Infinity };
	const f0 = peak[0];
	const inWin = (f: number) =>
		Math.abs(f - f0) <= 0.1 || Math.abs(f - 2 * f0) <= 0.1;
	let sig = 0;
	let rest = 0;
	for (const [f, p] of measuredBand)
		if (inWin(f)) sig += p;
		else rest += p;
	return { bpm: f0 * 60, snrDb: 10 * Math.log10(sig / Math.max(rest, 1e-12)) };
}

/**
 * The rate of the line at `bpm` estimated between bins: a Gaussian (log-parabolic) fit through
 * the line's bin and its two neighbours, the standard fit for a Hann-windowed line. A 16 s
 * window has 3.75 bpm bins, so the bin centre alone can be up to 1.9 bpm from the line. Used for
 * the reported rate only; every decision stays on the bins.
 */
export function fineBpm(P: Array<[number, number]>, bpm: number): number {
	const i = P.findIndex(([f]) => Math.abs(f * 60 - bpm) < 1e-6);
	if (i <= 0 || i >= P.length - 1) return bpm;
	const ln = (p: number) => Math.log(Math.max(p, 1e-30));
	const a = ln(P[i - 1][1]);
	const b = ln(P[i][1]);
	const c = ln(P[i + 1][1]);
	const den = a - 2 * b + c;
	const d = den !== 0 ? (a - c) / (2 * den) : 0;
	if (!(Math.abs(d) <= 0.5)) return bpm;
	return (P[i][0] + d * (P[i + 1][0] - P[i][0])) * 60;
}

export function peakAndSnr(x: number[]): { bpm: number; snrDb: number } {
	return peakOfSpectrum(spectrum(detrend(x)));
}

/**
 * The three regions' spectra, each normalised to unit in-band power, summed.
 *
 * Value chosen by measurement on recorded captures against a reference pulse.
 */
/**
 * Rule coherentFusion: the line read from the three regions' detrended pulses, each scaled to unit spread, added in
 * time, then one spectrum. A pulse is in step across the face (DistancePPG, Kumar 2015: under 10 ms of delay), so it
 * adds in amplitude while noise that the regions do not share adds only in power; the spectra's sum (combinedSpectrum)
 * gains nothing from that. The cost: a light that steps every region alike adds coherently too.
 */
export function coherentSpectrum(pulses: readonly number[][]): Array<[number, number]> {
	const N = pulses[0].length;
	const sum = new Array<number>(N).fill(0);
	for (const d of pulses) {
		let m = 0;
		for (const v of d) m += v;
		m /= N;
		let v2 = 0;
		for (const v of d) v2 += (v - m) ** 2;
		const sd = Math.sqrt(v2 / N) || 1;
		for (let k = 0; k < N; k++) sum[k] += (d[k] - m) / sd;
	}
	return spectrum(sum);
}

/**
 * Rule coherentFusion: dB taken off the coherent line's SNR so that on pure noise it clears the check's bars as often
 * as the spectra's sum does (white-noise simulation, the null's own calibration; it is not tuned on people).
 */
export const COHERENT_SNR_OFFSET_DB = 1.8;

/**
 * Rule allPatches: one frame's 115 face patches (facePatches.ts) as colour means, [timestamp ms, R G B per patch in
 * layout order], NaN for a patch with no skin pixels that frame.
 */
export type PatchSample = [number, Float32Array];

/**
 * Rule allPatches: a patch is read in a window only when it has skin on at least this share of the window's frames
 * (the all-data harness's loader, evsave tools/alldata: an interpolated guess over more is not a measurement).
 */
export const ALL_PATCHES_MIN_VALID = 0.9;
/** Rule allPatches: the fewest such patches for the patch line; with fewer, the three regions' line is read. */
export const ALL_PATCHES_MIN_COUNT = 8;

/**
 * Rule allPatches: each valid patch's POS pulse, detrended as the regions' are, for the coherent line (coherentSpectrum).
 * The pulse is in step across the face while each patch's camera noise is its own, so 115 small patches added at
 * equal spread average more noise away than three large regions; measured on the all-data harness (evsave
 * tools/alldata, combining.py "all patches"): public lab set held-out people within 10 bpm 90.5 to 92.7 (Full HD), 64.0 to
 * 67.8 (USB), 50.2 to 50.6 (Iriun); received references one laptop 67 to 80, one phone 77 to 92, the rest
 * within one reference; no-pulse copies' line SNR median -5.4 to -5.3 dB (no added risk on average).
 * Null when the window holds too few patch frames or too few valid patches.
 */
export function patchPulses(
	patches: readonly PatchSample[],
	from: number,
	to: number,
	startMs: number,
	endMs: number,
	frames: number,
	/** With colour damage the regions read green minus the wall (greenMinusWall); the patches then do the same. */
	wall: number[] | null = null,
): number[][] | null {
	const pw = patches.filter((p) => p[0] >= startMs && p[0] <= endMs);
	if (pw.length < ALL_PATCHES_MIN_VALID * frames || pw.length < 8) return null;
	const count = pw[0][1].length / 3;
	const out: number[][] = [];
	for (let i = 0; i < count; i++) {
		const t: number[] = [];
		const ch: number[][] = [[], [], []];
		for (const [ms, v] of pw) {
			const r = v[i * 3];
			if (!Number.isFinite(r)) continue;
			t.push(ms / 1000);
			ch[0].push(r);
			ch[1].push(v[i * 3 + 1]);
			ch[2].push(v[i * 3 + 2]);
		}
		if (t.length < ALL_PATCHES_MIN_VALID * pw.length || t.length < 8) continue;
		const [R, G, B] = ch.map((c) => resample(t, c, from, to));
		out.push(detrend(wall ? greenMinusWall(G, wall) : pos(R, G, B), OWN_PULSE_DETREND_S));
	}
	return out.length >= ALL_PATCHES_MIN_COUNT ? out : null;
}

export function combinedSpectrum(
	spectra: Array<Array<[number, number]>>,
): Array<[number, number]> {
	const [lo, hi] = OWN_PULSE_BAND_HZ;
	const out: Array<[number, number]> = spectra[0].map(([f]) => [f, 0]);
	for (const P of spectra) {
		const total =
			P.filter(([f]) => f >= lo && f <= hi).reduce((a, [, p]) => a + p, 0) || 1;
		P.forEach(([, p], i) => {
			out[i][1] += p / total;
		});
	}
	return out;
}

/**
 * The combined spectrum judged against its LOCAL noise floor.
 *
 * It chooses the line and fits its rate; the line's SNR is still judged on
 * the spectrum as measured, so every bar keeps the meaning it was set with.
 * Judging the SNR on the whitened spectrum instead moved the bars under the
 * lines and lost real pulses.
 *
 * Value chosen by measurement on recorded captures against a reference pulse.
 */
export const OWN_PULSE_WHITEN_HALF_HZ = 0.65;
export const OWN_PULSE_WHITEN_POWER = 0.4;

export function whitenedSpectrum(
	P: Array<[number, number]>,
): Array<[number, number]> {
	if (P.length < 3) return P;
	const step = P[1][0] - P[0][0];
	const h = Math.max(2, Math.round(OWN_PULSE_WHITEN_HALF_HZ / step));
	return P.map(([f, p], i) => {
		const nb: number[] = [];
		for (let j = i - h; j <= i + h; j++)
			if (j >= 0 && j < P.length && Math.abs(j - i) > 2) nb.push(P[j][1]);
		nb.sort((a, b) => a - b);
		const floor = nb[nb.length >> 1] || 1e-12;
		return [f, p / floor ** OWN_PULSE_WHITEN_POWER] as [number, number];
	});
}

/** POS (Wang 2017): temporally normalised RGB, S1 = G - B, S2 = G + B - 2R, h = S1 + alpha S2, 1.6 s sliding windows, overlap-added. */
export function pos(R: number[], G: number[], B: number[]): number[] {
	const win = Math.round(1.6 * OWN_PULSE_FS);
	const h = new Array<number>(R.length).fill(0);
	// One buffer per signal for every window, and every operation in the order first written, so
	// the output is the same to the bit (a test pins it) without an allocation per window.
	const s1 = new Float64Array(win);
	const s2 = new Float64Array(win);
	const sd = (a: Float64Array) => {
		let m = 0;
		for (let i = 0; i < win; i++) m += a[i];
		m /= win;
		let v = 0;
		for (let i = 0; i < win; i++) v += (a[i] - m) ** 2;
		return Math.sqrt(v / win) || 1;
	};
	for (let n = win; n <= R.length; n++) {
		const m = n - win;
		let mr = 0;
		let mg = 0;
		let mb = 0;
		for (let k = m; k < n; k++) {
			mr += R[k];
			mg += G[k];
			mb += B[k];
		}
		mr /= win;
		mg /= win;
		mb /= win;
		for (let k = m; k < n; k++) {
			const r = R[k] / mr;
			const g = G[k] / mg;
			const b = B[k] / mb;
			s1[k - m] = g - b;
			s2[k - m] = g + b - 2 * r;
		}
		const alpha = sd(s1) / sd(s2);
		let mean = 0;
		for (let i = 0; i < win; i++) mean += s1[i] + alpha * s2[i];
		mean /= win;
		for (let k = 0; k < win; k++) h[m + k] += s1[k] + alpha * s2[k] - mean;
	}
	return h;
}

/**
 * When the camera's colour channels are too damaged for POS, read the pulse from green minus
 * what the wall beside the face shares with it.
 *
 * POS compares the three colour channels, which cancels changes of light and movement, but
 * only while each channel is clean: a near-dead channel (a dark camera's blue reading 4 to 20
 * of 255) has rounding noise that POS's per-channel normalisation multiplies, and video
 * compression (a phone streaming as a webcam) discards colour detail first. Green alone
 * survives both but follows the room light; the wall carries the room light and never the
 * pulse, so subtracting the share of green that the wall explains leaves the pulse.
 *
 * Value chosen by measurement on recorded captures against a reference pulse.
 */
export const OWN_PULSE_COLOUR_DAMAGE = 50;
/**
 * The colour-damage level at which the live check switches from POS to green minus the wall.
 *
 * Value chosen by measurement on recorded captures against a reference pulse.
 */
export const OWN_PULSE_COLOUR_SWITCH = 20;

/**
 * Green minus the wall replaces POS only over a wall that shows the light falling on the face: the
 * wall's level as the camera saw it (wallLevelSeen) over the face's (the three regions' mean
 * R + G + B), per sample, at least this through the darkest OWN_PULSE_SWAP_WALL_QUANTILE of the
 * window. A light that falls on the face and not on the wall (a screen) makes the face far brighter
 * than the wall. The ratio does not depend on the scale the colours are handed over on (0..1 or
 * 0..255) or on the camera's exposure, and its low quantile asks for a lit wall through nearly the
 * whole window, so a lit patch seen earlier in it cannot lift a dark one over the bar. A generated
 * video with no person (a chromatic pulse at 70 a minute under a screen light at 90 on the face, the
 * wall at 0.036 of the face) showed 88 to 91 with the swap and reads 67 to 73 by colour (POS).
 *
 * Value chosen by measurement on recorded captures against a reference pulse: real windows where the
 * swap fires leave no clean gap below it, so the bar is set where the outcome on real people does not
 * change and the known failure is excluded with the widest margin. Rule darkWall.
 */
export const OWN_PULSE_SWAP_MIN_WALL_TO_FACE = 0.1;
/** The window's quantile rule darkWall judges the wall against the face on (its darkest tenth). */
export const OWN_PULSE_SWAP_WALL_QUANTILE = 0.1;

/** The face's level in one sample: the three regions' mean R + G + B, on the scale handed over. */
function faceLevel(s: RawRoiSample): number {
	return (s[1] + s[2] + s[3] + s[4] + s[5] + s[6] + s[7] + s[8] + s[9]) / 3;
}

/** The value at quantile q (0..1) of a non-empty array, by the nearest rank below. */
function quantile(a: readonly number[], q: number): number {
	const b = [...a].sort((x, y) => x - y);
	return b[Math.floor(q * (b.length - 1))];
}

/**
 * The wall's level in one sample as the camera saw it: R + G + B of the patch as read (the reading
 * after the wall columns, see RawRoiSample), or of the wall columns when the sample has no reading.
 */
function wallLevelSeen(s: RawRoiSample): number {
	const at = s.length >= 16 && Number.isFinite(s[13]) ? 13 : 10;
	return s[at] + s[at + 1] + s[at + 2];
}

const zeroMeanNorm = (x: number[]): number[] => {
	const m = x.reduce((a, v) => a + v, 0) / x.length || 1;
	return x.map((v) => v / m - 1);
};
const fastNoise = (x: number[]): number => {
	const d = x.slice(1).map((v, i) => v - x[i]);
	const m = d.reduce((a, v) => a + v, 0) / d.length;
	return Math.sqrt(d.reduce((a, v) => a + (v - m) ** 2, 0) / d.length) || 1e-12;
};

/** Green minus the share of it the wall's brightness explains (least squares), sign as POS. */
export function greenMinusWall(G: number[], wall: number[]): number[] {
	const g = detrend(zeroMeanNorm(G), OWN_PULSE_DETREND_S);
	const w = detrend(zeroMeanNorm(wall), OWN_PULSE_DETREND_S);
	const ww = w.reduce((a, v) => a + v * v, 0) || 1e-12;
	const beta = g.reduce((a, v, i) => a + v * w[i], 0) / ww;
	return g.map((v, i) => -(v - beta * w[i]));
}

/**
 * Rule clearWindows: the building number counts only windows whose line stands at least this far above its runner-up.
 * On recorded lab webcam sessions (three cameras, finger reference) the building number read low at raised heart rates
 * (above 90 bpm, 29% of its evaluations more than 10 bpm low against 3.4% of proven ones, at 55 to 70 bpm where no-pulse
 * noise lands); 1 and 3 dB tried on one half of the people, 3 dB held out once on the other with the display's recent
 * stage at 20 s: more seconds with a number, lower error, fewer numbers on no-pulse copies.
 */
export const CLEAR_MARGIN_DB = 3;
/** Rule clearWindows: how far from the line a runner-up must sit to count as another rate (twice the agreement width, 15 bpm). */
export const CLEAR_RUNNER_UP_BPM = 15;

/** The line's margin over its runner-up in a spectrum, dB (lineMarginDb). */
export function lineMargin(P: readonly [number, number][], bpm: number): number {
	const [lo, hi] = OWN_PULSE_BAND_HZ;
	const f0 = bpm / 60;
	let top = 0;
	let run = 0;
	for (let i = 1; i < P.length - 1; i++) {
		const [f, p] = P[i];
		if (f < lo || f > hi) continue;
		if (Math.abs(f - f0) <= 0.5 / 60) top = Math.max(top, p);
		if (Math.abs(f - f0) * 60 >= CLEAR_RUNNER_UP_BPM && p > P[i - 1][1] && p >= P[i + 1][1]) run = Math.max(run, p);
	}
	return run > 0 && top > 0 ? 10 * Math.log10(top / run) : Number.POSITIVE_INFINITY;
}

/**
 * Rule driftLine (on unless false): a combined line under OWN_PULSE_DRIFT_LINE_BPM that fewer than all three regions
 * carry cannot count under any rule (counts: below the low band only with all three; rest band from 52 only), so it
 * must not hide the pulse: the window reads the strongest line at or above OWN_PULSE_LOW_BAND_BPM instead, when that
 * is a local maximum of the whitened spectrum, its SNR judged on the spectrum as measured as for every line. On still
 * laptop recordings a 45 to 49 line kept breaking streaks on a true 64 to 71, and 45 on a true 90 to 96. Every received
 * recording of the test page, its rules: seconds with a number per 100 laptop 51.0 to 51.5, phone 46.2 to 46.5, Mac 39.7
 * to 40.3; shown numbers within 5 bpm or 10% of the reference laptop 97 to 96 of 100, phone 90 to 90. Public lab set, finger reference: tuning half shown 39.9% to 40.6%, MAE 3.22 to 3.07, over 10 off
 * 4.8% to 4.8%, no-pulse 1.66 to 1.78 per 100; held-out half (scored once) shown 52.7% to 53.7%, MAE 2.32 to 2.33,
 * over 10 off 2.0% to 2.1%, no-pulse 2.17 to 2.28. Skipping every low-band line that lacks three regions (up to 58)
 * hurt strong-signal recordings (it threw away rest-band rates); gating on the line's own SNR removed the gain.
 */
export const OWN_PULSE_DRIFT_LINE_BPM = 52;

function pastDriftLine(
	line: { bpm: number; snrDb: number },
	comb: Array<[number, number]>,
	measured: Array<[number, number]>,
	regions: readonly RegionEstimate[],
): { bpm: number; snrDb: number } {
	if (!Number.isFinite(line.bpm) || line.bpm >= OWN_PULSE_DRIFT_LINE_BPM) return line;
	if (regions.filter((r) => Math.abs(r.bpm - line.bpm) <= OWN_PULSE_AGREE_BPM).length >= REGIONS.length) return line;
	const lo = OWN_PULSE_LOW_BAND_BPM / 60;
	const alt = peakOfSpectrum(comb.map(([f, p]) => [f, f < lo ? 0 : p] as [number, number]), OWN_PULSE_HARMONIC_WEIGHT, measured);
	const i = comb.findIndex(([f]) => Math.abs(f * 60 - alt.bpm) < 1e-6);
	const isPeak = i > 0 && i < comb.length - 1 && comb[i - 1][1] < comb[i][1] && comb[i + 1][1] < comb[i][1];
	return Number.isFinite(alt.bpm) && isPeak ? alt : line;
}

/**
 * Rule slowDouble: a heart under the band (30 to 47 bpm) shows in the band as twice its rate, because a pulse's second
 * harmonic carries 10 to 40% of the fundamental's power (Allen 2007, Physiol Meas 28:R1) while the fundamental sits
 * below the band's floor. Face-wide drift has a line at its own rate but none at twice it. So a line within
 * OWN_PULSE_AGREE_BPM of twice a slow line is withheld when (1) the slow line is the whitened spectrum's strongest local
 * maximum in SLOW_DOUBLE_HZ, (2) the measured spectrum has a local maximum within one bin of twice it standing
 * SLOW_DOUBLE_HARMONIC_FLOOR times its local floor (the median within 0.4 Hz, the bins beside the line left out), and
 * (3) the slow line's measured power is at least SLOW_DOUBLE_FUNDAMENTAL_OVER_HARMONIC times the harmonic's, so the slow
 * line is the fundamental and not the harmonic of something slower. It only withholds: no slow rate is ever shown.
 */
export const SLOW_DOUBLE_HZ: readonly [number, number] = [0.5, 0.78];
export const SLOW_DOUBLE_HARMONIC_FLOOR = 3;
export const SLOW_DOUBLE_FUNDAMENTAL_OVER_HARMONIC = 4;

function isLocalMax(P: Array<[number, number]>, i: number): boolean {
	return i > 0 && i < P.length - 1 && P[i - 1][1] < P[i][1] && P[i + 1][1] < P[i][1];
}

export function lineIsSlowDouble(comb: Array<[number, number]>, measured: Array<[number, number]>, lineBpm: number): boolean {
	if (comb.length < 3 || !Number.isFinite(lineBpm)) return false;
	const [lo, hi] = SLOW_DOUBLE_HZ;
	let i = -1;
	for (let k = 1; k < comb.length - 1; k++) {
		const f = comb[k][0];
		if (f < lo || f > hi || !isLocalMax(comb, k)) continue;
		if (i < 0 || comb[k][1] > comb[i][1]) i = k;
	}
	if (i < 0) return false;
	const fs = comb[i][0];
	if (Math.abs(lineBpm - 2 * fs * 60) > OWN_PULSE_AGREE_BPM) return false;
	const step = comb[1][0] - comb[0][0];
	const j0 = Math.round((2 * fs - measured[0][0]) / step);
	let j = -1;
	for (const k of [j0 - 1, j0, j0 + 1])
		if (k > 0 && k < measured.length - 1 && isLocalMax(measured, k) && (j < 0 || measured[k][1] > measured[j][1])) j = k;
	if (j < 0) return false;
	const nb: number[] = [];
	for (let k = 0; k < measured.length; k++)
		if (Math.abs(measured[k][0] - measured[j][0]) <= 0.4 && Math.abs(k - j) > 2) nb.push(measured[k][1]);
	nb.sort((a, b) => a - b);
	const floor = nb[nb.length >> 1] || 1e-12;
	if (measured[j][1] < SLOW_DOUBLE_HARMONIC_FLOOR * floor) return false;
	return measured[i][1] >= SLOW_DOUBLE_FUNDAMENTAL_OVER_HARMONIC * measured[j][1];
}

/**
 * Estimate over the most recent `windowS` seconds of raw samples. Returns null
 * when the window is not yet full or the frame rate is too low to resolve the
 * band (below 2x the band edge, i.e. 6 fps).
 */
export function estimateOwnPulse(
	samples: readonly RawRoiSample[],
	windowS: number = OWN_PULSE_WINDOW_S,
	/** The instant to judge at; defaults to the last sample. A window whose newest sample is older than 1 s is stale and yields null. */
	atMs: number = samples.length ? samples[samples.length - 1][0] : 0,
	/** Colour damage at which green minus the wall replaces POS (OWN_PULSE_COLOUR_SWITCH). */
	colourSwitch: number = OWN_PULSE_COLOUR_SWITCH,
	/** The least wall against the face at which it does (OWN_PULSE_SWAP_MIN_WALL_TO_FACE); 0 swaps over any wall seen. */
	swapMinWallToFace: number = OWN_PULSE_SWAP_MIN_WALL_TO_FACE,
	/** Rule coherentFusion: read the line from the regions' pulses added in time (coherentSpectrum), not their spectra. */
	coherent = false,
	/** Rule driftLine (OWN_PULSE_DRIFT_LINE_BPM): a drift line no rule can count does not hide the strongest line above the low band. */
	driftLine = false,
	/** Rule slowDouble (lineIsSlowDouble): a line at twice a slow line the spectrum itself supports is withheld. */
	slowDouble = false,
	/** Rule trackLine: hand back the whitened in-band spectrum (`band`) for the line track across windows. */
	wantBand = false,
	/** Rule allPatches: the frames' face patches (PatchSample); with coherent on and POS in use, the line is read from them. */
	patches: readonly PatchSample[] | null = null,
): OwnPulseEstimate | null {
	if (samples.length < 8) return null;
	const end = atMs;
	const start = end - windowS * 1000;
	const win = samples.filter((s) => s[0] >= start && s[0] <= end);
	if (
		win.length < 8 ||
		win[0][0] - start > 1000 ||
		end - win[win.length - 1][0] > 1000
	)
		return null;
	const t = win.map((s) => s[0] / 1000);
	const span = t[t.length - 1] - t[0];
	const fps = win.length / Math.max(span, 1e-6);
	if (fps < 2 * OWN_PULSE_BAND_HZ[1]) return null;
	const from = t[0];
	const to = t[t.length - 1];
	const spectra: Array<Array<[number, number]>> = [];
	const channels = REGIONS.map((_, ri) =>
		[1, 2, 3].map((c) =>
			resample(
				t,
				win.map((s) => s[c + ri * 3]),
				from,
				to,
			),
		),
	);
	// The wall is used only when it was visible for the whole window.
	const wallSeen = win.every((s) => s.length >= 13 && Number.isFinite(s[11]));
	const wall = wallSeen
		? resample(
				t,
				win.map((s) => s[10] + s[11] + s[12]),
				from,
				to,
			)
		: null;
	// POS once per region: the colour damage and the region's pulse read the same projection.
	const posOf = channels.map(([R, G, B]) => pos(R, G, B));
	const damages = channels
		.map(([, G], ri) => fastNoise(posOf[ri]) / fastNoise(zeroMeanNorm(G)))
		.sort((a, b) => a - b);
	const colourDamage = Math.round(damages[1] * 10) / 10;
	// The level as the camera saw it (wallLevelSeen); `wall` is carried on across patches.
	const seen = wallSeen ? resample(t, win.map(wallLevelSeen), from, to) : null;
	const wallLevel = seen ? seen.reduce((a, v) => a + v, 0) / seen.length : null;
	const face = seen ? resample(t, win.map(faceLevel), from, to) : null;
	const wallToFace =
		seen && face ? quantile(seen.map((v, i) => v / Math.max(face[i], 1e-9)), OWN_PULSE_SWAP_WALL_QUANTILE) : null;
	// Rule darkWall: a wall too dark against the face to show the light on it cannot take it out of green.
	const wallLit = swapMinWallToFace <= 0 || (wallToFace != null && wallToFace >= swapMinWallToFace);
	const method =
		wall && wallLit && colourDamage >= colourSwitch ? "greenMinusWall" : "pos";
	const pulses: number[][] = [];
	const regions: RegionEstimate[] = REGIONS.map((region, ri) => {
		const [R, G, B] = channels[ri];
		const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
		const pulse =
			method === "greenMinusWall" && wall
				? greenMinusWall(G, wall)
				: posOf[ri];
		const dpulse = detrend(pulse, OWN_PULSE_DETREND_S);
		pulses.push(dpulse);
		const P = spectrum(dpulse);
		spectra.push(P);
		const { bpm, snrDb } = peakOfSpectrum(P);
		return { region, bpm, snrDb, meanRgb: [mean(R), mean(G), mean(B)] };
	});
	// The rate is the line in the COMBINED spectrum (combinedSpectrum); the
	// per-region peaks stay for diagnostics and for the low-band agreement rule.
	// The line is chosen, and its rate fitted, against its local noise floor
	// (whitenedSpectrum); its SNR is judged on the spectrum as measured.
	// Rule allPatches: the coherent line from every valid face patch instead of the three regions (patchPulses).
	const fromPatches = coherent && patches ? patchPulses(patches, from, to, start, end, win.length, method === "greenMinusWall" ? wall : null) : null;
	const measured = coherent ? coherentSpectrum(fromPatches ?? pulses) : combinedSpectrum(spectra);
	const comb = whitenedSpectrum(measured);
	let line = peakOfSpectrum(comb, OWN_PULSE_HARMONIC_WEIGHT, measured);
	if (driftLine) line = pastDriftLine(line, comb, measured, regions);
	if (slowDouble && lineIsSlowDouble(comb, measured, line.bpm)) line = { bpm: Number.NaN, snrDb: Number.NEGATIVE_INFINITY };
	const combined = coherent && Number.isFinite(line.snrDb) ? { ...line, snrDb: line.snrDb - COHERENT_SNR_OFFSET_DB } : line;
	const found = Number.isFinite(combined.bpm);
	const lineMarginDb = found ? lineMargin(comb, combined.bpm) : null;
	const agreeing = found
		? regions
				.filter((r) => Math.abs(r.bpm - combined.bpm) <= OWN_PULSE_AGREE_BPM)
				.map((r) => r.region)
		: [];
	return {
		windowS,
		frames: win.length,
		fps: Math.round(fps * 10) / 10,
		regions,
		agreeing,
		bpm: found ? Math.round(combined.bpm * 10) / 10 : null,
		snrDb: found ? Math.round(combined.snrDb * 10) / 10 : null,
		bpmFine: found ? Math.round(fineBpm(comb, combined.bpm) * 10) / 10 : null,
		// Unrounded: the 3 dB bar was measured on the exact margin, and a rounding would move windows across it.
		lineMarginDb,
		method,
		colourDamage,
		wallSeen,
		wallLevel: wallLevel == null ? null : Math.round(wallLevel * 1000) / 1000,
		wallToFace: wallToFace == null ? null : Math.round(wallToFace * 1000) / 1000,
		...(wantBand
			? {
					band: comb
						.filter(([f]) => f >= OWN_PULSE_BAND_HZ[0] && f <= OWN_PULSE_BAND_HZ[1])
						.map(([f, p]) => [f * 60, p] as [number, number]),
				}
			: {}),
	};
}

/**
 * Walk a whole recording in `stepS` steps and return the estimate at each
 * step: what the app would have concluded, second by second, offline.
 */
export function ownPulseSeries(
	samples: readonly RawRoiSample[],
	windowS: number = OWN_PULSE_WINDOW_S,
	stepS = 2,
): Array<{ tS: number; est: OwnPulseEstimate | null }> {
	if (!samples.length) return [];
	const t0 = samples[0][0];
	const tEnd = samples[samples.length - 1][0];
	const out: Array<{ tS: number; est: OwnPulseEstimate | null }> = [];
	for (let end = t0 + windowS * 1000; end <= tEnd; end += stepS * 1000) {
		out.push({
			tS: Math.round((end - t0) / 100) / 10,
			est: estimateOwnPulse(samples, windowS, end),
		});
	}
	return out;
}

/**
 * The verdict over time: one agreeing window is not a pulse; the same rate
 * held across consecutive windows is.
 *
 * Value chosen by measurement on recorded captures against a reference pulse.
 */
export const OWN_PULSE_STREAK = 8;
export const OWN_PULSE_MIN_SNR_DB = -3;

/**
 * A strong line is proven sooner than a weak one.
 *
 * The streak above is a fixed wait: eight windows whatever their strength, so
 * a clear pulse in good light waited as long as a marginal one. A sequential
 * stop (Wald's sequential probability ratio test) spends evidence instead of
 * time: at least OWN_PULSE_STRONG_STREAK agreeing windows whose SNR above the
 * bar (OWN_PULSE_MIN_SNR_DB) sums to OWN_PULSE_STRONG_EXCESS_DB, which for
 * four windows is a mean of 0 dB, 3 dB above the ordinary bar.
 *
 * Value chosen by measurement on recorded captures against a reference pulse.
 */
export const OWN_PULSE_STRONG_STREAK = 4;
export const OWN_PULSE_STRONG_EXCESS_DB = 12;

/**
 * Below this rate a line counts only when all three regions see it.
 *
 * Value chosen by measurement on recorded captures against a reference pulse.
 */
export const OWN_PULSE_LOW_BAND_BPM = 58;

/**
 * Below this delivered frame rate the camera has slowed itself to lengthen its exposure: it is
 * telling us the light is low. Cameras typically run near 16.6 fps when exposure-limited and
 * 20 to 30 when not; 18 sits in the gap.
 *
 * Value chosen by measurement on recorded captures against a reference pulse.
 */
export const OWN_PULSE_SLOW_CAMERA_FPS = 18;

/**
 * The bottom of that exposure-limited band: a lower rate is frames being dropped, not light.
 *
 * Value chosen by measurement on recorded captures against a reference pulse.
 */
export const OWN_PULSE_SLOW_CAMERA_MIN_FPS = 15;

/**
 * The SNR a window from a camera slowed for light needs to count.
 *
 * Value chosen by measurement on recorded captures against a reference pulse.
 */
export const OWN_PULSE_SLOW_CAMERA_MIN_SNR_DB = -2;

/**
 * In the dark, a longer agreement stands in for a stronger window.
 *
 * A camera slowed for light (OWN_PULSE_SLOW_CAMERA_*) whose windows each fall
 * under the slowed bar can still confirm on OWN_PULSE_DARK_STREAK windows in a
 * row agreeing on one rate, at a mean SNR of OWN_PULSE_DARK_MIN_SNR_DB, none
 * under OWN_PULSE_DARK_FLOOR_DB. Evidence that is weak per window but steady
 * over time: a chance line does not hold for sixteen seconds.
 *
 * Value chosen by measurement on recorded captures against a reference pulse.
 */
export const OWN_PULSE_DARK_STREAK = 16;
export const OWN_PULSE_DARK_MIN_SNR_DB = -4.5;
/**
 * Rule quickerProof (on unless false), its two halves. The dark entry proves from OWN_PULSE_QUICK_DARK_STREAK windows at
 * a mean of OWN_PULSE_QUICK_DARK_MIN_SNR_DB (-5 dB is BUILDING_MIN_SNR_DB and FOLLOW_MIN_SNR_DB, the bar every other
 * weak-window rule already uses); and a streak longer than OWN_PULSE_STREAK also proves when its newest OWN_PULSE_STREAK
 * windows reach OWN_PULSE_MIN_SNR_DB, so older weak windows of the same rate cannot hold back a proof the newest make.
 * Every received recording of the test page, its rules: laptop 51.0 to 52.3 seconds with a number per 100, shown
 * numbers within 5 bpm or 10% of the reference 96 of 100 held; a silent 128 s still run 0 to 19 s with a number. Public
 * lab set, finger reference: tuning half MAE 3.22 to 3.07, the tuning half thinned to 16.5 fps (a camera slowed for
 * light) shown 28.3% to 31.3%; held-out half (scored once) shown 53.7% to 54.3%, MAE 2.33 to 2.33, over 10 off 2.1% to
 * 2.1%, no-pulse 2.28 to 2.39 per 100. Off: 16 windows at -4.5, and the whole streak's mean.
 */
export const OWN_PULSE_QUICK_DARK_STREAK = 12;
export const OWN_PULSE_QUICK_DARK_MIN_SNR_DB = -5;
/** No single dark window below this counts (the sweep's floor). */
export const OWN_PULSE_DARK_FLOOR_DB = -7;
/**
 * The regions themselves must see a dark line: every window at least one region on it alone,
 * and on average OWN_PULSE_DARK_MEAN_AGREEING over the streak. SNR alone cannot separate a
 * weak real pulse from a combined-spectrum line the regions do not carry; agreement does.
 *
 * Value chosen by measurement on recorded captures against a reference pulse.
 */
export const OWN_PULSE_DARK_MIN_AGREEING = 1;
export const OWN_PULSE_DARK_MEAN_AGREEING = 1.5;

/**
 * The bar a dark pulse is HELD at, once the dark entry has confirmed it.
 *
 * Value chosen by measurement on recorded captures against a reference pulse.
 */
export const OWN_PULSE_DARK_HOLD_SNR_DB = -5.5;

function slowedForLight(e: OwnPulseEstimate): boolean {
	return (
		e.fps >= OWN_PULSE_SLOW_CAMERA_MIN_FPS && e.fps < OWN_PULSE_SLOW_CAMERA_FPS
	);
}

/** A window from a camera slowed for light that the dark streak may count. */
function countsInDark(
	e: OwnPulseEstimate | null,
	lowBand: number,
): e is OwnPulseEstimate & { bpm: number; snrDb: number } {
	if (
		e == null ||
		e.bpm == null ||
		e.snrDb == null ||
		!Number.isFinite(e.snrDb)
	)
		return false;
	if (!slowedForLight(e) || e.snrDb < OWN_PULSE_DARK_FLOOR_DB) return false;
	if (e.agreeing.length < OWN_PULSE_DARK_MIN_AGREEING) return false;
	return e.bpm >= lowBand || e.agreeing.length >= REGIONS.length;
}

/**
 * Regions that must carry a window's line for it to count, outside the dark
 * (the dark path keeps its own rule, OWN_PULSE_DARK_MIN_AGREEING), with rule oneRegion off.
 */
export const OWN_PULSE_MIN_AGREEING = 2;

/**
 * Rule oneRegion (on unless false): one region carrying the line is enough. A pulse that the other two regions
 * miss (a shadow, hair, a moving cheek) counts, at the same SNR bar and streak. The pulse is under the whole face, so
 * the measure of a wrong number is the share far from a reference, not agreement between regions. Public lab set,
 * finger reference: tuning half shown 34.7% to 40.1%, MAE 2.95 to 3.24, over 10 off 4.4% to 5.1%; held-out half
 * (scored once) 44.9% to 52.7%, MAE 2.15 to 2.32, over 10 off 1.5% to 2.0%, numbers on shuffled no-pulse copies 1.12
 * to 2.19 per 100. Requiring a strong line from the lone region (-2, 0, +2 dB) removed the whole gain: the added
 * readings are the weak one-region windows.
 */
export const OWN_PULSE_ONE_REGION_MIN_AGREEING = 1;

/** Whether a window counts toward the verdict: a line and an SNR, every region behind a low-band line, and stronger evidence from a camera slowed by low light. */
function counts(
	e: OwnPulseEstimate | null,
	lowBand: number,
	minAgreeing: number,
): e is OwnPulseEstimate & { bpm: number; snrDb: number } {
	if (e == null || e.bpm == null || e.snrDb == null) return false;
	if (slowedForLight(e) && e.snrDb < OWN_PULSE_SLOW_CAMERA_MIN_SNR_DB)
		return false;
	if (!slowedForLight(e) && e.agreeing.length < minAgreeing)
		return false;
	if (e.bpm < OWN_PULSE_EDGE_BPM && e.snrDb < OWN_PULSE_EDGE_MIN_SNR_DB)
		return false;
	if (e.bpm >= OWN_PULSE_LOW_BAND_BPM || e.agreeing.length >= REGIONS.length) return true;
	// Only rule restBand (lowBand below OWN_PULSE_LOW_BAND_BPM) reaches here with a line at or over lowBand.
	if (e.bpm < lowBand) return false;
	return e.snrDb >= OWN_PULSE_REST_BAND_MIN_SNR_DB;
}
/**
 * Rule restBand only: a line from lowBand to OWN_PULSE_LOW_BAND_BPM that two of the three regions carry also needs
 * this much SNR. Without it the rule let no-pulse video show invented seconds in that band (sitting at 52 to 58,
 * the band floor's drift); with it, a pre-registered test on people and no-pulse video it had not been tuned on
 * added no invented and no wrong second. The value was chosen on earlier recordings, where -3 (the usual bar) let
 * invented seconds through and -2 did not; that test is what checked it.
 */
export const OWN_PULSE_REST_BAND_MIN_SNR_DB = -2;
/**
 * The bottom of the band (OWN_PULSE_BAND_HZ, 42 bpm) is where slow drift that every region shares (room
 * light, exposure, a slowly moving head) piles up, and all three regions can agree on it. Below
 * OWN_PULSE_EDGE_BPM a window counts only at OWN_PULSE_EDGE_MIN_SNR_DB or more.
 *
 * Value chosen by measurement on recorded captures against a reference pulse.
 */
export const OWN_PULSE_EDGE_BPM = 52;
export const OWN_PULSE_EDGE_MIN_SNR_DB = 0;

/**
 * Once measured, the verdict HOLDS while at least this many of the last
 * OWN_PULSE_STREAK windows still agree with the held rate.
 *
 * Value chosen by measurement on recorded captures against a reference pulse.
 */
export const OWN_PULSE_HOLD_MIN = 6;

export type OwnPulseVerdict = "measured" | "not-measured" | "unknown";

/**
 * How a "measured" verdict was reached: "proof" (the streak, or the strong windows), "dark" (the dark
 * entry), or "hold" (a rate measured before, still carried by most of the newest windows). The first two
 * are fresh proofs; the hold is not.
 */
export type OwnPulseVerdictPath = "proof" | "dark" | "hold" | "relock";

export function ownPulseVerdict(
	history: readonly (OwnPulseEstimate | null)[],
	/** The rate the previous verdict was measured at, if it was; enables the hold. */
	held: number | null = null,
	/** Where the low band starts (OWN_PULSE_LOW_BAND_BPM; OWN_PULSE_EDGE_BPM with rule restBand). */
	lowBand: number = OWN_PULSE_LOW_BAND_BPM,
	/** Regions a window's line needs (OWN_PULSE_MIN_AGREEING; OWN_PULSE_ONE_REGION_MIN_AGREEING with rule oneRegion). */
	minAgreeing: number = OWN_PULSE_MIN_AGREEING,
	/** Rule quickerProof (OWN_PULSE_QUICK_DARK_*): the shorter dark entry, and a long streak judged on its newest windows too. */
	quickerProof = false,
): {
	verdict: OwnPulseVerdict;
	bpm: number | null;
	snrDb: number | null;
	streak: number;
	/** How a "measured" verdict was reached (OwnPulseVerdictPath); null otherwise. */
	path: OwnPulseVerdictPath | null;
	/** The current streak's mean fine rate and mean SNR, on every verdict (rule moreReadings). */
	streakBpm?: number | null;
	streakSnrDb?: number | null;
	/** The same streak over only its newest windows at CLEAR_MARGIN_DB or more (rule clearWindows), with their mean rate and SNR. */
	clearStreak?: number;
	clearBpm?: number | null;
	clearSnrDb?: number | null;
} {
	let streak = 0;
	const rates: number[] = [];
	const fines: number[] = [];
	const snrs: number[] = [];
	for (let i = history.length - 1; i >= 0; i--) {
		const e = history[i];
		if (!counts(e, lowBand, minAgreeing)) break;
		if (rates.length && Math.abs(e.bpm - rates[0]) > OWN_PULSE_AGREE_BPM) break;
		rates.push(e.bpm);
		fines.push(e.bpmFine ?? e.bpm);
		snrs.push(e.snrDb);
		streak += 1;
	}
	const avg = (xs: number[]) => xs.reduce((s, v) => s + v, 0) / xs.length;
	// The current streak, carried on every verdict (rule moreReadings falls back to it when no proven rate is shown).
	// Rule clearWindows: the same streak over only its newest windows whose line clears its runner-up by CLEAR_MARGIN_DB.
	const clearFines: number[] = [];
	const clearSnrs: number[] = [];
	for (let k = 0; k < streak; k++) {
		const e = history[history.length - 1 - k];
		if (!(e && e.lineMarginDb != null && e.lineMarginDb >= CLEAR_MARGIN_DB)) break;
		clearFines.push(e.bpmFine ?? (e.bpm as number));
		clearSnrs.push(e.snrDb as number);
	}
	const streakStats = {
		streakBpm: fines.length ? Math.round(avg(fines) * 10) / 10 : null,
		streakSnrDb: snrs.length ? avg(snrs) : null,
		clearStreak: clearFines.length,
		clearBpm: clearFines.length ? Math.round(avg(clearFines) * 10) / 10 : null,
		clearSnrDb: clearSnrs.length ? avg(clearSnrs) : null,
	};
	const excess = snrs.reduce((sum, v) => sum + (v - OWN_PULSE_MIN_SNR_DB), 0);
	if (
		(streak >= OWN_PULSE_STREAK &&
			(avg(snrs) >= OWN_PULSE_MIN_SNR_DB ||
				(quickerProof &&
					avg(snrs.slice(0, OWN_PULSE_STREAK)) >= OWN_PULSE_MIN_SNR_DB))) ||
		(streak >= OWN_PULSE_STRONG_STREAK &&
			excess >= OWN_PULSE_STRONG_EXCESS_DB &&
			avg(rates) >= OWN_PULSE_LOW_BAND_BPM)
	) {
		return {
			verdict: "measured",
			// The windows' fine rate, not the bins they agreed on (fineBpm).
			bpm: Math.round(avg(fines) * 10) / 10,
			snrDb: Math.round(avg(snrs) * 10) / 10,
			streak,
			path: "proof",
			...streakStats,
		};
	}
	// The dark entry: the same shape of streak, longer, at a lower bar, only from
	// a camera slowed for light (OWN_PULSE_DARK_STREAK above).
	{
		const darkRates: number[] = [];
		const darkFines: number[] = [];
		const darkSnrs: number[] = [];
		const darkAgreeing: number[] = [];
		for (let i = history.length - 1; i >= 0; i--) {
			const e = history[i];
			if (!countsInDark(e, lowBand)) break;
			if (
				darkRates.length &&
				Math.abs(e.bpm - darkRates[0]) > OWN_PULSE_AGREE_BPM
			)
				break;
			darkRates.push(e.bpm);
			darkFines.push(e.bpmFine ?? e.bpm);
			darkSnrs.push(e.snrDb);
			darkAgreeing.push(e.agreeing.length);
		}
		if (
			darkRates.length >=
				(quickerProof ? OWN_PULSE_QUICK_DARK_STREAK : OWN_PULSE_DARK_STREAK) &&
			avg(darkSnrs) >=
				(quickerProof
					? OWN_PULSE_QUICK_DARK_MIN_SNR_DB
					: OWN_PULSE_DARK_MIN_SNR_DB) &&
			avg(darkAgreeing) >= OWN_PULSE_DARK_MEAN_AGREEING
		) {
			return {
				verdict: "measured",
				bpm: Math.round(avg(darkFines) * 10) / 10,
				snrDb: Math.round(avg(darkSnrs) * 10) / 10,
				streak: darkRates.length,
				path: "dark",
				...streakStats,
			};
		}
	}
	if (held != null) {
		const recent = history.slice(-OWN_PULSE_STREAK);
		// A rate the dark entry measured is held by the windows that measured it.
		const agreeing = recent.filter(
			(e): e is OwnPulseEstimate =>
				(counts(e, lowBand, minAgreeing) || countsInDark(e, lowBand)) &&
				Math.abs((e.bpm as number) - held) <= OWN_PULSE_AGREE_BPM,
		);
		if (agreeing.length >= OWN_PULSE_HOLD_MIN) {
			const heldRates = agreeing.map((e) => (e.bpmFine ?? e.bpm) as number);
			const heldSnrs = agreeing.map((e) => e.snrDb as number);
			const bar = agreeing.every(slowedForLight)
				? OWN_PULSE_DARK_HOLD_SNR_DB
				: OWN_PULSE_MIN_SNR_DB;
			const bpm = Math.round(avg(heldRates) * 10) / 10;
			if (avg(heldSnrs) >= bar) {
				return {
					verdict: "measured",
					bpm,
					snrDb: Math.round(avg(heldSnrs) * 10) / 10,
					streak,
					path: "hold",
					...streakStats,
				};
			}
		}
	}
	const seen = history.filter((e) => e != null).length;
	return {
		verdict: seen >= OWN_PULSE_STREAK ? "not-measured" : "unknown",
		bpm: null,
		snrDb: null,
		streak,
		path: null,
		...streakStats,
	};
}
