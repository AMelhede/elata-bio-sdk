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
	/** How the pulse was read from the colours this window (see OWN_PULSE_COLOUR_DAMAGE). */
	method?: "pos" | "greenMinusWall";
	/** The colour-damage measure this window (see OWN_PULSE_COLOUR_DAMAGE), or null. */
	colourDamage?: number | null;
	/** Whether the wall beside the face was seen through the whole window. */
	wallSeen?: boolean;
	/**
	 * The wall's mean level over the window as the camera saw it: R + G + B of the patch or patches
	 * read, each on 0..1, before any rescaling between patches (OWN_PULSE_SWAP_MIN_WALL). Null when
	 * the wall was not seen through the whole window.
	 */
	wallLevel?: number | null;
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
 * Green minus the wall replaces POS only over a wall bright enough to show the room's light: its
 * mean level over the window as the camera saw it (R + G + B of the patch or patches read, each on
 * 0..1; wallLevelSeen) at least this. The swap assumes the light that falls on the face falls on
 * the wall too. A dark wall shows almost none of it, so a light that falls on the face and not on
 * the wall (a screen) stays in green minus the wall and is read as the pulse. A generated video
 * with no person (a chromatic pulse at 70 a minute under a screen light at 90 on the face, the
 * wall at a level of about 0.06) showed 88 to 91 with the swap and reads 67 to 73 by colour (POS).
 * The level is judged on each patch as read, not on the wall the runner carries on across patches
 * (WallTracker): a darker patch carried on at a brighter one's level still shows almost none of
 * the light.
 *
 * Value chosen by measurement on recorded captures against a reference pulse. The wall levels of
 * real windows where the swap fired leave no clean gap below it, so the bar is set where the
 * outcome on real people does not change and the known failure is excluded. Rule darkWall.
 */
export const OWN_PULSE_SWAP_MIN_WALL = 0.15;

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
	/** The least wall level at which it does (OWN_PULSE_SWAP_MIN_WALL); 0 swaps over any wall seen. */
	swapMinWall: number = OWN_PULSE_SWAP_MIN_WALL,
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
	// The level as the camera saw it (wallLevelSeen); `wall` is carried on across patches.
	const seen = wallSeen ? resample(t, win.map(wallLevelSeen), from, to) : null;
	const wallLevel = seen ? seen.reduce((a, v) => a + v, 0) / seen.length : null;
	// Rule darkWall: a wall too dark to show the room's light cannot take it out of green.
	const wallLit = swapMinWall <= 0 || (wallLevel != null && wallLevel >= swapMinWall);
	const method =
		wall && wallLit && colourDamage >= colourSwitch ? "greenMinusWall" : "pos";
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
		wallLevel: wallLevel == null ? null : Math.round(wallLevel * 1000) / 1000,
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
 * Value chosen by measurement on recorded captures against a reference pulse.
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
	if (e.bpm < OWN_PULSE_EDGE_BPM && e.snrDb < OWN_PULSE_EDGE_MIN_SNR_DB)
		return false;
	return e.bpm >= OWN_PULSE_LOW_BAND_BPM || e.agreeing.length >= REGIONS.length;
}
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
 * Value chosen by measurement on recorded captures against a reference pulse.
 */
export const OWN_PULSE_EARLY_FROM_S = 12;
/** Spectrum and beat rate within this many bpm. */
export const OWN_PULSE_EARLY_AGREE_BPM = 3;
/**
 * Beat-interval coefficient of variation below this: steady beats, not noise
 * peaks.
 *
 * Value chosen by measurement on recorded captures against a reference pulse.
 */
export const OWN_PULSE_EARLY_MAX_CV = 0.18;
/**
 * How long an early confirmation stands in for the ordinary verdict, from the
 * moment it fired.
 *
 * Value chosen by measurement on recorded captures against a reference pulse.
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

/**
 * A second way to a number, for when the check's own streak falls short: the SDK's own rate (a
 * different estimator on the same face) and the check's window rate agree for AGREE_SECONDS
 * running, within AGREE_BPM, with the window line at AGREE_MIN_SNR_DB or stronger and the rate
 * at OWN_PULSE_LOW_BAND_BPM or above. Opt-in (`pulseCheckAgreement`).
 *
 * Value chosen by measurement on recorded captures against a reference pulse.
 */
export const AGREE_SECONDS = 8;
export const AGREE_BPM = 3;
export const AGREE_MIN_SNR_DB = -4;

export type AgreementSecond = { sdk: number | null; win: number | null; winSnr: number | null };

/** The SDK's rate when the last AGREE_SECONDS seconds all agree (see AGREE_SECONDS), else null. */
export function agreementRate(seconds: readonly AgreementSecond[]): number | null {
	if (seconds.length < AGREE_SECONDS) return null;
	const recent = seconds.slice(-AGREE_SECONDS);
	const ok = recent.every(
		(s) =>
			s.sdk != null &&
			s.win != null &&
			s.winSnr != null &&
			Math.abs(s.sdk - s.win) <= AGREE_BPM &&
			s.winSnr >= AGREE_MIN_SNR_DB &&
			s.sdk >= OWN_PULSE_LOW_BAND_BPM,
	);
	return ok ? (recent[recent.length - 1]!.sdk as number) : null;
}
