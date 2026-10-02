/**
 * Real-pulse check: copied unchanged from peak-app src/pulse/ownPulse.ts (commit 59c66d1),
 * the checker Peak ships. Only the import of its sample type was replaced by the
 * local alias below, and the file formatted to this repo's style (logic unchanged).
 * See pulseCheck.ts for how the SDK uses it.
 */
/**
 * The app's own pulse estimate, from the raw skin-region colours.
 *
 * Why this exists (2026-09-22): the owner's real recordings, replayed through
 * the SDK pipeline, found no heartbeat (fused signal: strongest line 42 to
 * 44 bpm at or below 0 dB, more power below the band than in it). The same
 * frames' raw region colours, run through POS (Wang et al., IEEE TBME 2017)
 * and CHROM (de Haan and Jeanne, IEEE TBME 2013), put a line at 63 to 71 bpm
 * on BOTH cheeks in every 16 s sub-window of a 40 s stretch, and the two
 * cheeks agreed with each other within 4 bpm each time. Three regions, two
 * methods, one rate: the pulse is in the camera signal and the fusion stage
 * loses it. This is Part 5 of the accuracy plan (our own signal stage), built
 * in the app first per the blast-radius rule, and judged against the corpus
 * (e2e/fixtures/recordings) and the pulse and pulseless fixtures.
 *
 * Pure: takes the raw samples the recorder already keeps
 * (pulse/rawRoiRecorder.ts), returns per-region estimates and a verdict. No
 * DOM, no SDK, so it runs identically in the app, in unit tests and in the
 * offline analyser (scripts/analyzeRecording.mjs).
 */
/**
 * [timestampMs, foreheadR, G, B, leftCheekR, G, B, rightCheekR, G, B], optionally followed by
 * the wall beside the face [wallR, G, B] (NaN when it was not visible in that frame).
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
	/** How the pulse was read from the colours this window (see OWN_PULSE_COLOUR_DAMAGE). */
	method?: "pos" | "greenMinusWall";
	/** The colour-damage measure this window (see OWN_PULSE_COLOUR_DAMAGE), or null. */
	colourDamage?: number | null;
	/** Whether the wall beside the face was seen through the whole window. */
	wallSeen?: boolean;
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
 * It was a single 2 s moving mean until 2026-09-22, and that is why readings
 * came out near 45 bpm. A boxcar's response is sinc(fT), whose first sidelobe
 * is NEGATIVE, so subtracting it AMPLIFIED the band floor. Measured on pure
 * sines through this function: 42 bpm x1.218, 45 x1.206, against 66 x0.898
 * and 72 x0.871, a 2.8 dB tilt toward 45 over the owner's real 66 to 72. The
 * owner's 16.3.5 capture committed 45.7 on exactly that tilt. A triangle's
 * response is sinc^2, never negative, so the subtraction can only attenuate:
 * measured 0.953 at 42 bpm, 0.983 to 0.999 from 60 to 180, flat within 0.4 dB
 * across the band. Same 2 s constant; only the kernel shape changed.
 */
/**
 * The high-pass before the pulse is read: a double moving mean this many
 * seconds wide.
 *
 * It was 2 s, which removes only below about 0.5 Hz. Breathing at ~15/min is
 * 0.25 Hz and its third harmonic, 0.75 Hz, is 45 bpm: those lines passed into
 * the band beside a resting pulse, and the owner's dim capture on 2026-09-26
 * (106 s, read 62 against Oura 63) spent 70 s with windows at 45 and 53 to 56.
 * App model over every recording (fresh captures every 6 s against Oura, and
 * his 95 real presses): 2.0 s reads 656 with 19 wrong; 1.7 s 652 and 18;
 * 1.5 s 680 and 5 (the five are the two open Oura-62 sessions), mean error
 * 1.82 bpm; 1.3 s 599 and 4, losing reads as it starts to cut a resting pulse.
 * A notch at the measured breathing rate's harmonics scored 686 and 4 but was
 * not shipped: heart rate often sits near 4 to 5x the breathing rate, where a
 * notch would delete the pulse itself. The beat detector already used 1.5.
 */
export const OWN_PULSE_DETREND_S = 1.5;

export function detrend(x: number[], seconds = 2): number[] {
	const w = Math.max(1, Math.round(OWN_PULSE_FS * seconds));
	const trend = movingMean(movingMean(x, w), w);
	return x.map((v, k) => v - trend[k]);
}

/** Hann-windowed power spectrum over the band and a little either side. */
export function spectrum(x: number[]): Array<[number, number]> {
	const N = x.length;
	const han = x.map(
		(v, k) => v * (0.5 - 0.5 * Math.cos((2 * Math.PI * k) / (N - 1))),
	);
	const out: Array<[number, number]> = [];
	for (let fi = 1; fi < N / 2; fi++) {
		const f = (fi * OWN_PULSE_FS) / N;
		if (f > 4) break;
		let re = 0;
		let im = 0;
		for (let k = 0; k < N; k++) {
			const ang = (-2 * Math.PI * fi * k) / N;
			re += han[k] * Math.cos(ang);
			im += han[k] * Math.sin(ang);
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
 * Measured 2026-09-24 (fresh captures every 3 s through all 49 recordings,
 * real verdict): 0 (off) reads 605 of 1,297; 0.5 reads 623; 1 reads 607; 2
 * reads 565. Wrong readings on the six captures with a known truth: 0 at
 * every weight, while truth readings rise from 142 to 149 (dim-1 from 35 of
 * 41 captures to 41 of 41). The one rate that moved by more than 2 bpm
 * anywhere is a capture that read nothing and now reads 60.5, beside three
 * captures from the same session at 60 to 61.6. The two dark captures stay
 * unread: their pulse is too far under the noise for a harmonic to lift.
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
		// biome-ignore lint/style/noParameterAssign: kept as in the Peak source this was measured as
		P = P.map(
			([f, p]) => [f, p + harmonicWeight * at(2 * f)] as [number, number],
		);
	}
	const band = P.filter(([f]) => f >= lo && f <= hi);
	if (!band.length) return { bpm: NaN, snrDb: -Infinity };
	const peak = band.reduce((a, b) => (b[1] > a[1] ? b : a));
	// A line is a local maximum. The largest in-band bin with a larger bin just
	// below the band is the skirt of below-band drift (breathing, slow motion)
	// running into the band floor, not a pulse. Measured on the corpus: this
	// alone removed the last 45.9 bpm excursion from a capture otherwise held at
	// 69 to 72, and moved no correct capture's measured rate.
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
 * The rate of the line at `bpm` estimated between bins: a Gaussian (log-
 * parabolic) fit through the line's bin and its two neighbours. A 16 s window
 * has 3.75 bpm bins, so the bin centre alone can be up to 1.9 bpm from the
 * line, against a mean error of 1.81 bpm on the corpus. The log-parabola is
 * the standard fit for a Hann-windowed line (the window's main lobe is close
 * to Gaussian); the plain parabola on power was measured beside it.
 *
 * Measured 2026-09-26 on the full-pipeline replay (fresh captures every 6 s
 * over every recording, real presses, and the truth-corpus rule): used for
 * the reported rate only, it moves mean error from 1.81 to 1.74 bpm and wrong
 * first confirmations from 14 to 12, with reads (745), wrong readings (2) and
 * timing unchanged; the plain parabola gives 1.76. Used for the decisions as
 * well, it reads 801 but with 18 wrong: continuous rates let noise windows
 * "agree" within the band more easily, so the decisions stay on the bins.
 * Used for the early path's rate it did worse (1.84), so that stays as it was.
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
 * Why (2026-09-22, 16.3.6 on Brave): every region on its own sat at -1 to
 * -5 dB, so single-region peaks wandered, a noise line on one cheek at 45 to
 * 49 bpm sometimes found a partner, and eight windows in a row of two single
 * peaks agreeing almost never happened: one capture committed 47.2, the next
 * dead-ended at 60 s while its regions read the true 66 to 71 in most
 * windows. The pulse is common to all three regions; their noise is not.
 * Summing unit-power spectra keeps a shared line and averages the rest down,
 * the standard multi-region combination (e.g. Wang et al. 2017, the POS
 * paper's own multi-patch setup) done in the frequency domain so a region
 * brighter than the others cannot dominate. Measured on the corpus
 * (17 recordings, 1 s walk, verdict constants unchanged): both Brave captures
 * go from never measured to 66.5 (from 38 s) and 70.6 (from 23 s), every
 * previously correct capture stays within 66 to 72, the capture the SDK
 * committed at 120 reads 69.6, and the pulseless fixture never measures.
 */
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
 * The noise that hides the pulse is not white. Measured 2026-09-28 on the
 * owner's 48 recordings with a truth: after POS the in-band noise falls about
 * 6 dB per Hz from 1 to 3 Hz, sits 10 dB above the white floor above 4 Hz,
 * and is mostly independent per region. Against a flat band, a bump of low-
 * frequency noise outranks a real line that stands well clear of its own
 * quieter neighbourhood; that is the low-band false line the low-band rule
 * patches. Dividing each bin by the median of its neighbours (the line itself
 * and its two neighbours left out, a Hann main lobe) judges a line against
 * the noise actually around it, the standard pre-whitening of detection in
 * coloured noise (Kay, Fundamentals of Statistical Signal Processing II).
 *
 * It chooses the line and fits its rate; the line's SNR is still judged on
 * the spectrum as measured, so every bar keeps the meaning it was set with.
 * Judging the SNR on the whitened spectrum instead moved the bars under the
 * lines and lost real pulses (the capture the SDK committed at 120 measured
 * nothing).
 *
 * Only part of the way (OWN_PULSE_WHITEN_POWER), from a floor
 * OWN_PULSE_WHITEN_HALF_HZ either side. Full-app replay, 98 recordings (fresh
 * captures every 6 s, the owner's 103 real presses, the truth-corpus rule),
 * pile at 6 (OWN_LOCK_SAMPLES), against the shipped 937 reads, 1 wrong, MAE
 * 1.70, presses 57 read at p50 39.8 s, truth corpus 9 of 291:
 *  - floor +-0.5 to +-0.8 Hz at 0.4: 952 to 971 reads, 0 wrong, truth corpus
 *    1, presses 58 to 59 at p50 38.6 s. Outside it both edges fail: +-0.4 Hz
 *    (the floor catches the line's own skirt) 16 wrong, +-1.0 Hz (the floor
 *    reaches past the band) 17 wrong;
 *  - +-0.65 Hz, the middle: 971 reads, 0 wrong, MAE 1.64, truth corpus 1 of
 *    288; paired on the 437 captures both read, mean error -0.11 bpm (95% CI
 *    -0.17 to -0.05) and a median 2 s sooner;
 *  - power 0.6 reads 955, 0 wrong; power 1 at +-0.6 Hz raises paired error
 *    +0.18. The rate fitted on the raw spectrum instead: -0.06 against -0.11.
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
	const sd = (a: number[]) => {
		const m = a.reduce((s, v) => s + v, 0) / a.length;
		return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / a.length) || 1;
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
		const s1: number[] = [];
		const s2: number[] = [];
		for (let k = m; k < n; k++) {
			const r = R[k] / mr;
			const g = G[k] / mg;
			const b = B[k] / mb;
			s1.push(g - b);
			s2.push(g + b - 2 * r);
		}
		const alpha = sd(s1) / sd(s2);
		let mean = 0;
		const seg = s1.map((v, i) => {
			const y = v + alpha * s2[i];
			mean += y;
			return y;
		});
		mean /= win;
		for (let k = 0; k < win; k++) h[m + k] += seg[k] - mean;
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
 * Damage is measured per window: the frame-to-frame (fast) noise of the POS signal relative to
 * green's, median over the regions. On the MCD-rPPG dataset (560 recordings) it reads a median
 * 14 on the front webcam and 40 to 51 on the two side cameras. Swept as the live switch
 * (2026-10-02, sandbox fix 11), against POS everywhere (206 recordings with a number, 2.97%
 * of judged seconds wrong, median first 45 s): at 50, 251 recordings, 2.72% wrong, 43 s; at
 * 45, 275, 3.04%, 42 s; at 40, 281, 3.13%. 50 is the setting that is no worse on any count.
 * Green minus the wall alone does not replace POS: at any bar it stays ~6% wrong, because
 * head movement changes the face's shading and not the wall's, which POS cancels.
 */
export const OWN_PULSE_COLOUR_DAMAGE = 50;
/**
 * The switch as the live check uses it: OFF. The sweep above was run on full-box region means,
 * which the live check never sees (it gets skin-masked means). Re-measured 2026-10-02 on what the
 * live check actually receives (per-frame inputs recorded in the browser, wall found past a turned
 * head): at 50 it never changes a reading (60 + 50 MCD-rPPG recordings); at 20 it read 17 of 59
 * (today 14) with 0 wrong seconds of 266 (today 5 of 230), but on 50 people it was not tuned on
 * the front camera dropped from 10 of 18 to 7 of 18. Off until a front-camera set (UBFC-rPPG)
 * shows it costs the front camera nothing.
 */
export const OWN_PULSE_COLOUR_SWITCH = Number.POSITIVE_INFINITY;

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
	const damages = channels
		.map(([R, G, B]) => fastNoise(pos(R, G, B)) / fastNoise(zeroMeanNorm(G)))
		.sort((a, b) => a - b);
	const colourDamage = Math.round(damages[1] * 10) / 10;
	const method =
		wall && colourDamage >= colourSwitch ? "greenMinusWall" : "pos";
	const regions: RegionEstimate[] = REGIONS.map((region, ri) => {
		const [R, G, B] = channels[ri];
		const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
		const pulse =
			method === "greenMinusWall" && wall
				? greenMinusWall(G, wall)
				: pos(R, G, B);
		const P = spectrum(detrend(pulse, OWN_PULSE_DETREND_S));
		spectra.push(P);
		const { bpm, snrDb } = peakOfSpectrum(P);
		return { region, bpm, snrDb, meanRgb: [mean(R), mean(G), mean(B)] };
	});
	// The rate is the line in the COMBINED spectrum (combinedSpectrum); the
	// per-region peaks stay for diagnostics and for the low-band agreement rule.
	// The line is chosen, and its rate fitted, against its local noise floor
	// (whitenedSpectrum); its SNR is judged on the spectrum as measured.
	const measured = combinedSpectrum(spectra);
	const comb = whitenedSpectrum(measured);
	const combined = peakOfSpectrum(comb, OWN_PULSE_HARMONIC_WEIGHT, measured);
	const found = Number.isFinite(combined.bpm);
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
		method,
		colourDamage,
		wallSeen,
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
 * Measured 2026-09-22 on three sources (scripts/ownPulseOnRecording.ts):
 * the pulse fixture agrees in 4 of 4 windows at 12 to 14 dB; the owner's real
 * capture agrees in 26 of 34 consecutive windows at 63 to 69 bpm, SNR -3.7 to
 * +0.4 dB; the pulseless fixture agrees in 1 window of 4, at -4.5 dB, on a
 * different pair of regions, then never again. Four more pulseless runs
 * (about 30 s each, 1 s steps) agreed in short bursts only, the longest three
 * windows at 128 bpm on both cheeks at -3.7 to -4.8 dB; under the rule below
 * none of the four reached `measured` at any streak from 6 to 12 or floor
 * from -4 to -2 dB, while the owner's capture reached it in 15 of 67 steps at
 * 65 to 67 bpm with streak 8 (19 of 67 with streak 6, but including a 73).
 * Eight and -3 dB is the pair that kept every one of his measured windows on
 * one rate. Four half-minute nulls are not a large sample; a longer pulseless
 * recording belongs in the corpus before this is called settled.
 *
 * Re-measured 2026-09-23 for speed (scripts/ownPulseSpeedSweep.ts), against
 * a harder null than the fixture: every real recording with its pulse band
 * replaced by noise of the same power over the same drift (125 surrogates).
 * Window 16 s, streak 8, floor -3 dB: median first verdict 34 s on the 25
 * real captures (floor 23 s), 2 of 125 surrogates falsely measured. Every
 * faster setting paid in invented pulses: 12 s / 6 steps reached 23 s and
 * measured 42 of 125 surrogates; 14 s / 6 steps, 24 s and 18 of 125.
 * Raising the floor to cut those cost more time than it saved (16/8 at
 * -2 dB: median 48 s). So the verdict does not get faster by loosening it.
 * So the rule is persistence:
 * `OWN_PULSE_STREAK` consecutive estimates that all agree, whose rates stay
 * within OWN_PULSE_AGREE_BPM of each other, and whose mean SNR clears the
 * floor below the owner's weakest agreeing window. A single agreeing window,
 * which is what noise produces, cannot reach it.
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
 * Swept 2026-09-25 with the app's own pile and lock, fresh captures every 3 s
 * over 41 recordings (2,504 captures). Today's rule: 540 locks, 0 wrong, 10th
 * percentile 29 s, median 37 s. This rule: 586 locks, 0 wrong, median 36 s,
 * the fastest captures from 25 s. At an excess of 8 dB, 648 and 0 wrong; at 4
 * dB, 724 and 13 wrong (dim-oura89 read 48 against 89, 12 times), so 12 keeps
 * three times the margin to the first wrong reading. Streaks of 3 to 6
 * measured the same at each excess.
 *
 * Above the low band only. The corpus test, which judges the verdict itself
 * and not only the committed reading, found a strong 48.8 line held by all
 * three regions on desk-a-oura69, desk-b-oura69 and desk-oura63: the slow
 * drift OWN_PULSE_LOW_BAND_BPM describes. The full streak outlasts it; four
 * windows did not, and the live rate would have shown 49.
 */
export const OWN_PULSE_STRONG_STREAK = 4;
export const OWN_PULSE_STRONG_EXCESS_DB = 12;

/**
 * Below this rate a line counts only when all three regions see it.
 *
 * The noise in a camera signal (drift, small movement, breathing) rises toward
 * the bottom of the band: averaged over the owner's dim and dark captures, the
 * bins from 37 to 52 bpm each hold 10 to 16% of the band's power against about
 * 3% above 120. In poor light that slope's loudest point, somewhere in the 50s,
 * outshouts a weak pulse and gets confirmed as one. A heartbeat reaches all
 * perfused skin at once; the slope's noise is local to a region.
 *
 * Measured 2026-09-24 as the app runs it: a fresh capture started every 3 s
 * through each recording, read at its first measured verdict.
 *   no rule: 43 of 171 readings wrong on the six captures with a known truth
 *     (every wrong one at 51 to 56; desk-67 read 51 in 14 of 50 captures).
 *   below 55: 4 wrong (dim-1 at 56).   below 58 or 60: 0 wrong, 142 read.
 *   below 62: 0 wrong, and three captures reading 60 to 62 stop reading.
 *   All three regions required everywhere: 0 wrong, but the whole corpus
 *     reads 331 of 1,297 captures against 702 today.
 * At 58 the corpus reads 605 of 1,297; every capture that stops reading had
 * a suspect rate (the dark ones at 53 against Oura 65 and 61, committed-46,
 * passive-91, lit-completed, two stuck captures). 58 and 60 measured the
 * same; 58 asks the extra evidence of fewer people with a genuinely low
 * resting rate, who get a slower reading or none, never a wrong one.
 */
export const OWN_PULSE_LOW_BAND_BPM = 58;

/**
 * Below this delivered frame rate the camera has slowed itself to lengthen
 * its exposure: it is telling us the light is low. The owner's cameras run in
 * two modes, 16.6 fps when exposure-limited and 20 to 29 when not; 18 sits in
 * the gap. A slowed window found the true rate 12% of the time (502 windows,
 * SNR at the truth -4.1 dB) against 42% at 18 to 25 fps (2026-09-24, every
 * recording with a known truth).
 */
export const OWN_PULSE_SLOW_CAMERA_FPS = 18;

/**
 * The bottom of that exposure-limited band. A camera slowed for light settles
 * near 16.6 fps (a 60 ms exposure; windows measured 15.1 to 17.8); a lower
 * rate is frames being dropped, not light, and the 2026-09-22 captures that
 * ran at 4 to 14 fps read their true 66 to 69 fine. Gating everything under
 * 18 made those unreadable (corpus 579 of 1,840 fresh captures reading);
 * gating 15 to 18 keeps the same zero wrong readings and 770 reading. 16
 * measured the same accuracy at 799; 15 keeps the 15.1 fps windows in.
 */
export const OWN_PULSE_SLOW_CAMERA_MIN_FPS = 15;

/**
 * The SNR a window from a slowed camera needs to count. Measured over fresh
 * captures on all 18 truth recordings: no bar, 43 wrong readings; -2, -1 and
 * 0 dB each leave 23, every one on a capture whose own rate climbed from 79
 * to 90 against one Oura snapshot of 81, and take the dim and dark 89s (68 to
 * 71, no window at the truth) to zero. -2 is the loosest of those.
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
 * Measured 2026-09-25, fresh captures every 3 s over all 34 recordings with the
 * real verdict and the 5 s post-confirmation hold. owner-2026-09-25k (dark,
 * Oura 73; the truth was the band's strongest line in 9 of 22 windows, decoys
 * 0) went from 0 readings to 21, every one 71. No recording gained a wrong
 * reading at a streak of 12 or 16 and a bar from -4.5 to -5.5 dB; at a streak
 * of 8, dim-oura89 read 69 against 89, 19 times. 16 is twice the streak that
 * failed, and it still confirms the owner's capture at about 57 s, inside the
 * no-pulse minute. The dark recordings with no pulse in them (dim-oura89,
 * dark-lamp-oura89, lamp-oura79) gained no reading.
 */
export const OWN_PULSE_DARK_STREAK = 16;
export const OWN_PULSE_DARK_MIN_SNR_DB = -4.5;
/** No single dark window below this counts (the sweep's floor). */
export const OWN_PULSE_DARK_FLOOR_DB = -7;
/**
 * The regions themselves must see a dark line: every window at least one
 * region on it alone, and on average OWN_PULSE_DARK_MEAN_AGREEING over the
 * streak. dim-oura89 (Oura 89) held a line at 68 in the combined spectrum while
 * its regions let go of it (agreement 2222222221110000 at confirmation), at a
 * mean SNR of -3.60, stronger than the owner's real dark pulse (-3.79,
 * agreement 1221222222122222): SNR cannot separate them, agreement does.
 * Swept on every recording without the hold: at least one region per window,
 * a mean of 1.5, or both, remove dim-oura89's 18 false confirmations and keep
 * the dark capture's 21 readings; two regions in every window loses them all.
 */
export const OWN_PULSE_DARK_MIN_AGREEING = 1;
export const OWN_PULSE_DARK_MEAN_AGREEING = 1.5;

/**
 * The bar a dark pulse is HELD at, once the dark entry has confirmed it.
 *
 * The hold asked every held pulse for the lit mean (OWN_PULSE_MIN_SNR_DB,
 * -3), including one the dark entry had just confirmed at -4.5. So a dark
 * confirmation could not survive: owner-2026-09-25n (Oura 70) confirmed 69.4
 * at 39 s and let go at 44 s with the held windows at a mean of -4.7, the
 * reading pile never filled, and the capture ran to the no-pulse minute. It
 * applies only when every held window came from a camera slowed for light.
 *
 * Swept 2026-09-25 on all 40 recordings, fresh captures every 3 s, the app's
 * own pile and lock (2,454 captures): the lit bar, 513 locks, 0 wrong; -4.5
 * does not rescue 25n; -5, 521 and 0 wrong (25n's real dark capture reads 70
 * at 43 to 46 s); -5.5, 529 and 0 wrong, adding owner-2026-09-25k's dark
 * capture (Oura 73) at 71; -6 identical to -5.5. -5.5 is the tighter end of
 * that plateau, a full dB above the dark floor.
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
	return e.bpm >= OWN_PULSE_LOW_BAND_BPM || e.agreeing.length >= REGIONS.length;
}

/**
 * Regions that must carry a window's line for it to count, outside the dark
 * (the dark path keeps its own rule, OWN_PULSE_DARK_MIN_AGREEING).
 *
 * A pulse is in every patch of skin at once; a line one region alone carries
 * is more often that region's motion or light. Measured 2026-09-27 on the
 * full-pipeline replay (every recording, fresh captures every 6 s, the
 * owner's 98 real presses, the corpus rule) of this rule as written: wrong
 * readings 9 to 3, wrong first confirmations 17 to 11, presses 1 wrong to 0
 * and p50 42.6 s to 41.8 s, mean error 1.86 to 1.84 bpm, and 776 reads to
 * 703. (A stricter experiment that also withheld the windows from every other
 * path read 616 with 2 wrong; those were the numbers first quoted.) The owner
 * chose this side of the reads-for-wrong curve: fewer readings, fewer wrong.
 */
export const OWN_PULSE_MIN_AGREEING = 2;

/** Whether a window counts toward the verdict: a line and an SNR, every region behind a low-band line, and stronger evidence from a camera slowed by low light. */
function counts(
	e: OwnPulseEstimate | null,
): e is OwnPulseEstimate & { bpm: number; snrDb: number } {
	if (e == null || e.bpm == null || e.snrDb == null) return false;
	if (slowedForLight(e) && e.snrDb < OWN_PULSE_SLOW_CAMERA_MIN_SNR_DB)
		return false;
	if (!slowedForLight(e) && e.agreeing.length < OWN_PULSE_MIN_AGREEING)
		return false;
	return e.bpm >= OWN_PULSE_LOW_BAND_BPM || e.agreeing.length >= REGIONS.length;
}
/**
 * Once measured, the verdict HOLDS while at least this many of the last
 * OWN_PULSE_STREAK windows still agree with the held rate.
 *
 * Without it the verdict was asymmetric: eight agreeing windows to say yes,
 * one disagreeing window to say no. On 2026-09-22 (r3_2 in the corpus) a
 * capture locked on the own estimate and was refused 1.4 s later because one
 * window disagreed during the landing hold. Measured across the corpus
 * (scripts/ownPulseOnRecording.ts, hold sweep): 6 of 8 removes the exits on
 * the two flickering real captures (3 to 1, 1 to 0), never admits the
 * pulseless fixture (it cannot: the hold only applies after entry, and entry
 * is unchanged), and no held rate moved outside the rate the entry rule had
 * found. 4 of 8 started to drift the held rate (median 71.5 to 68.2 on one
 * capture), so 6 is the loosest hold that stayed honest.
 */
export const OWN_PULSE_HOLD_MIN = 6;

export type OwnPulseVerdict = "measured" | "not-measured" | "unknown";

export function ownPulseVerdict(
	history: readonly (OwnPulseEstimate | null)[],
	/** The rate the previous verdict was measured at, if it was; enables the hold. */
	held: number | null = null,
): {
	verdict: OwnPulseVerdict;
	bpm: number | null;
	snrDb: number | null;
	streak: number;
} {
	let streak = 0;
	const rates: number[] = [];
	const fines: number[] = [];
	const snrs: number[] = [];
	for (let i = history.length - 1; i >= 0; i--) {
		const e = history[i];
		if (!counts(e)) break;
		if (rates.length && Math.abs(e.bpm - rates[0]) > OWN_PULSE_AGREE_BPM) break;
		rates.push(e.bpm);
		fines.push(e.bpmFine ?? e.bpm);
		snrs.push(e.snrDb);
		streak += 1;
	}
	const avg = (xs: number[]) => xs.reduce((s, v) => s + v, 0) / xs.length;
	const excess = snrs.reduce((sum, v) => sum + (v - OWN_PULSE_MIN_SNR_DB), 0);
	if (
		(streak >= OWN_PULSE_STREAK && avg(snrs) >= OWN_PULSE_MIN_SNR_DB) ||
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
			if (!countsInDark(e)) break;
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
			darkRates.length >= OWN_PULSE_DARK_STREAK &&
			avg(darkSnrs) >= OWN_PULSE_DARK_MIN_SNR_DB &&
			avg(darkAgreeing) >= OWN_PULSE_DARK_MEAN_AGREEING
		) {
			return {
				verdict: "measured",
				bpm: Math.round(avg(darkFines) * 10) / 10,
				snrDb: Math.round(avg(darkSnrs) * 10) / 10,
				streak: darkRates.length,
			};
		}
	}
	if (held != null) {
		const recent = history.slice(-OWN_PULSE_STREAK);
		// A rate the dark entry measured is held by the windows that measured it.
		const agreeing = recent.filter(
			(e): e is OwnPulseEstimate =>
				(counts(e) || countsInDark(e)) &&
				Math.abs((e.bpm as number) - held) <= OWN_PULSE_AGREE_BPM,
		);
		if (agreeing.length >= OWN_PULSE_HOLD_MIN) {
			const heldRates = agreeing.map((e) => (e.bpmFine ?? e.bpm) as number);
			const heldSnrs = agreeing.map((e) => e.snrDb as number);
			const bar = agreeing.every(slowedForLight)
				? OWN_PULSE_DARK_HOLD_SNR_DB
				: OWN_PULSE_MIN_SNR_DB;
			if (avg(heldSnrs) >= bar) {
				return {
					verdict: "measured",
					bpm: Math.round(avg(heldRates) * 10) / 10,
					snrDb: Math.round(avg(heldSnrs) * 10) / 10,
					streak,
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
	};
}

/**
 * A strong pulse in good light, confirmed from 12 s: the beat intervals and the
 * spectrum agree.
 *
 * The ordinary verdict needs a full 16 s window and then agreement over time,
 * which is why a capture took 25 s at the fastest. Two independent readings of
 * the same seconds are faster evidence than one reading repeated: the time
 * between beats (peaks of the POS signal, as a contact PPG counts) and the
 * spectrum's line. On a pulse they agree; on noise the peaks fall where the
 * noise puts them.
 *
 * Swept 2026-09-26 with the app's own pile and lock over 49 recordings (2,504
 * fresh captures). Early accuracy by window, gated on spectrum and beats
 * within 3 bpm, all three regions and steady intervals: 5 s 53% right, 8 s
 * 82%, 10 s 93%, 12 s 96% (lit 100%). As an entry from 12 to 16 s, lit only:
 * 72 captures lock by 20 s against 0 today, no new wrong reading. From 10 s it
 * added one (43 against Oura 87), so 12.
 */
export const OWN_PULSE_EARLY_FROM_S = 12;
/** Spectrum and beat rate within this many bpm. */
export const OWN_PULSE_EARLY_AGREE_BPM = 3;
/**
 * Beat-interval coefficient of variation below this: steady beats, not noise
 * peaks.
 *
 * A resting pulse varies beat to beat by about 4 to 8% (heart-rate
 * variability) plus about 5% from frame timing at 20 fps, so real beats read
 * roughly 0.08 to 0.12; noise peaks in the owner's recordings read 0.30 to
 * 0.50. The first bar, 0.12, sat on top of real pulses. Re-swept under the
 * 1.5 s drift filter with the full-pipeline harness (2026-09-26): 0.12 reads
 * 739 with 4 wrong, 1.84 bpm; 0.18 reads 745 with 2 wrong, 1.81 bpm; 0.22
 * reads 754 with 1, 1.74 bpm; 0.24 starts adding wrong readings in a new
 * recording (desk-b, 1.89 bpm); 0.28 reads 784 with 15. 0.18 keeps a third
 * of the way to the first degradation as margin.
 */
export const OWN_PULSE_EARLY_MAX_CV = 0.18;
/**
 * How long an early confirmation stands in for the ordinary verdict, from the
 * moment it fired.
 *
 * It used to be judged only 12 to 16 s after the press and held until 20 s.
 * At the owner's 94 real presses the first ~12 s are the person settling
 * (head speed 0.31 to 0.44 face widths/s against 0.027 settled; brightness
 * drift 9x the settled level), so it never fired live (0 of 4). It now judges
 * the trailing 12 s at any moment and holds 8 s from firing. App model
 * (2026-09-26): real presses read 49 of 94 against 46, 0 wrong; fresh
 * captures over every recording 686 of 1,540 against 643, 18 wrong against
 * 19 (mostly known-open).
 */
export const OWN_PULSE_EARLY_HOLD_S = 8;

/** Beat rate from the peaks of the three regions' POS signals, summed; null when too few beats. */
export function beatRate(
	samples: readonly RawRoiSample[],
	fromMs: number,
	toMs: number,
): { bpm: number; cv: number } | null {
	const win = samples.filter((r) => r[0] >= fromMs && r[0] <= toMs);
	if (win.length < 20) return null;
	const t = win.map((r) => r[0] / 1000);
	const a = t[0];
	const b = t[t.length - 1];
	let sum: number[] | null = null;
	for (let ri = 0; ri < REGIONS.length; ri++) {
		const h = detrend(
			pos(
				resample(
					t,
					win.map((s) => s[1 + ri * 3]),
					a,
					b,
				),
				resample(
					t,
					win.map((s) => s[2 + ri * 3]),
					a,
					b,
				),
				resample(
					t,
					win.map((s) => s[3 + ri * 3]),
					a,
					b,
				),
			),
			OWN_PULSE_DETREND_S,
		);
		const m = h.reduce((x, y) => x + y, 0) / h.length;
		const sd =
			Math.sqrt(h.reduce((x, y) => x + (y - m) ** 2, 0) / h.length) || 1;
		const z = h.map((v) => (v - m) / sd);
		sum = sum ? sum.map((v, i) => v + z[i]) : z;
	}
	// A light smoothing (0.35 s), then local maxima at least 0.33 s apart (180 bpm).
	const k = 3;
	const x = sum!.map((_, i) => {
		let s = 0;
		let n = 0;
		for (let j = i - k; j <= i + k; j++)
			if (j >= 0 && j < sum!.length) {
				s += sum![j];
				n++;
			}
		return s / n;
	});
	const minGap = Math.round(0.33 * OWN_PULSE_FS);
	const pk: number[] = [];
	for (let i = 1; i < x.length - 1; i++) {
		if (x[i] > x[i - 1] && x[i] >= x[i + 1] && x[i] > 0.3) {
			if (pk.length && i - pk[pk.length - 1] < minGap) {
				if (x[i] > x[pk[pk.length - 1]]) pk[pk.length - 1] = i;
			} else pk.push(i);
		}
	}
	if (pk.length < 4) return null;
	const ibi = pk
		.slice(1)
		.map((p, i) => (p - pk[i]) / OWN_PULSE_FS)
		.sort((p, q) => p - q);
	const med = ibi[ibi.length >> 1];
	const mean = ibi.reduce((p, q) => p + q, 0) / ibi.length;
	const cv =
		Math.sqrt(ibi.reduce((p, q) => p + (q - mean) ** 2, 0) / ibi.length) / mean;
	return { bpm: 60 / med, cv };
}

/**
 * The early confirmation over a capture's own samples (first sample = the
 * press), judged at `atMs` on the trailing OWN_PULSE_EARLY_FROM_S seconds: a
 * rate, or null. Never before that much signal exists, and never from a
 * camera slowed for light, where the sweep had no evidence it holds.
 */
export function earlyPulse(
	samples: readonly RawRoiSample[],
	atMs: number,
): number | null {
	if (!samples.length) return null;
	const elapsedS = Math.round((atMs - samples[0][0]) / 1000);
	if (elapsedS < OWN_PULSE_EARLY_FROM_S) return null;
	// The trailing 12 s, wherever they fall (see OWN_PULSE_EARLY_HOLD_S).
	const fromMs = atMs - OWN_PULSE_EARLY_FROM_S * 1000;
	const sp = estimateOwnPulse(samples, OWN_PULSE_EARLY_FROM_S, atMs);
	if (!sp || sp.bpm == null || sp.agreeing.length !== REGIONS.length)
		return null;
	if (sp.fps < OWN_PULSE_SLOW_CAMERA_FPS) return null;
	const bt = beatRate(samples, fromMs, atMs);
	if (
		!bt ||
		bt.cv >= OWN_PULSE_EARLY_MAX_CV ||
		Math.abs(bt.bpm - sp.bpm) > OWN_PULSE_EARLY_AGREE_BPM
	)
		return null;
	return Math.round(((sp.bpm + bt.bpm) / 2) * 10) / 10;
}
