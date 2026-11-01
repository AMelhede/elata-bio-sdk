/**
 * Passive reading: a heart rate for a person who is not waiting for one. Opt-in (the session's `passive`
 * option); off, nothing here runs and no other output changes.
 *
 * The live check (pulseCheck.ts) answers a person looking at the screen, so it reads short windows and
 * proves a rate over consecutive seconds. A person working at a desk is not waiting, so this reader can
 * afford a long window: every `everyS` it reads the newest `windowS` of the same face-region rows the
 * check is fed, with the same estimator (estimateOwnPulse, coherent fusion and the drift-line rule on),
 * and keeps the window's rate only when three things hold:
 *
 * 1. the window's line stands at least `minSnrDb` above the rest of the band;
 * 2. the window's two halves, each read on its own, find the same rate within `halfAgreeBpm` (a rate that
 *    held the whole window, not one stretch that dominated it);
 * 3. the newest `recentS`, read on its own, finds the window's rate within `recentAgreeBpm` (the rate is
 *    still the rate now, not only a minute ago).
 *
 * Each condition asks the evidence to repeat itself in data the others did not use, so a noise line,
 * which does not repeat, rarely passes all three. A reading carries its window, its time on the frame
 * clock and its SNR; HRV is never read here. The defaults were fixed before a held-out test and passed
 * it; they are measured, not tuned to taste, and each gate is an option only so it can be re-scored.
 */
import {
	estimateOwnPulse,
	OWN_PULSE_COLOUR_SWITCH,
	OWN_PULSE_SWAP_MIN_WALL_TO_FACE,
	type RawRoiSample,
} from "./pulseCheckCore";

export interface PassiveOptions {
	/** The window read, seconds. Spectral resolution is 60/window bpm, so 48 s resolves 1.25 bpm. */
	windowS?: number;
	/** How often a window is read, seconds: the cadence of an all-day wrist reading at its fastest. */
	everyS?: number;
	/** The least SNR of the window's line, dB (estimateOwnPulse's snrDb). */
	minSnrDb?: number;
	/** The most the two halves' rates may differ, bpm. */
	halfAgreeBpm?: number;
	/** The newest stretch read on its own, seconds: the live check's own window (OWN_PULSE_WINDOW_S). */
	recentS?: number;
	/** The most the newest stretch's rate may differ from the window's, bpm. */
	recentAgreeBpm?: number;
	/**
	 * Frames further apart than this, ms, start the buffer again: no window spans a break that long. The
	 * window estimate interpolates across a missing stretch, and a stretch longer than one read interval
	 * is no longer a dropped frame but a face or a camera that went away.
	 */
	resetGapMs?: number;
	/**
	 * The least wall against the face at which green minus the wall replaces POS (estimateOwnPulse's
	 * swapMinWallToFace). The defaults were scored with OWN_PULSE_SWAP_MIN_WALL_TO_FACE.
	 */
	swapMinWallToFace?: number;
}

export type ResolvedPassiveOptions = Required<PassiveOptions>;

export const PASSIVE_WINDOW_S = 48;
export const PASSIVE_EVERY_S = 5;
export const PASSIVE_MIN_SNR_DB = -6;
export const PASSIVE_HALF_AGREE_BPM = 3;
export const PASSIVE_RECENT_S = 16;
export const PASSIVE_RECENT_AGREE_BPM = 3;
export const PASSIVE_RESET_GAP_MS = PASSIVE_EVERY_S * 1000;

export const PASSIVE_DEFAULTS: ResolvedPassiveOptions = {
	windowS: PASSIVE_WINDOW_S,
	everyS: PASSIVE_EVERY_S,
	minSnrDb: PASSIVE_MIN_SNR_DB,
	halfAgreeBpm: PASSIVE_HALF_AGREE_BPM,
	recentS: PASSIVE_RECENT_S,
	recentAgreeBpm: PASSIVE_RECENT_AGREE_BPM,
	resetGapMs: PASSIVE_RESET_GAP_MS,
	swapMinWallToFace: OWN_PULSE_SWAP_MIN_WALL_TO_FACE,
};

export function resolvePassiveOptions(
	options: boolean | PassiveOptions | undefined,
): ResolvedPassiveOptions | null {
	if (options == null || options === false) return null;
	return options === true ? { ...PASSIVE_DEFAULTS } : { ...PASSIVE_DEFAULTS, ...options };
}

export interface PassiveReading {
	/** The window's rate, bpm, between bins (estimateOwnPulse's bpmFine). */
	bpm: number;
	/** The window's line SNR, dB. */
	snrDb: number;
	/** The window read, seconds. */
	windowS: number;
	/** When the window ends, on the frame clock (the timestamps pushed), ms. */
	atMs: number;
	/** The window's two halves' rates, newer first, and the newest stretch's rate, bpm. */
	halvesBpm: [number, number];
	recentBpm: number;
	/** How long before the newest frame pushed this window ended, ms: a reading is shown with its age. */
	ageMs: number;
}

type Line = { bpm: number; snrDb: number };

/**
 * The reader. Pure: push the rows the live check keeps (RawRoiSample, rawRoiSampleOf), in time order; it
 * reads a window at each `everyS` mark once a frame past the mark arrives, so a window holds exactly the
 * frames up to its mark. The marks run from the first frame pushed (or the first after reset()).
 */
export class PassiveReader {
	readonly options: ResolvedPassiveOptions;
	private samples: RawRoiSample[] = [];
	private nextTickMs: number | null = null;
	private newestMs: number | null = null;
	private last: Omit<PassiveReading, "ageMs"> | null = null;

	constructor(options: PassiveOptions = {}) {
		this.options = { ...PASSIVE_DEFAULTS, ...options };
	}

	/** One frame's row. Returns the reading this frame completed, or null. */
	push(sample: RawRoiSample): PassiveReading | null {
		const t = sample[0];
		if (!Number.isFinite(t)) return null;
		if (this.newestMs != null && t < this.newestMs) return null;
		const o = this.options;
		const stepMs = o.everyS * 1000;
		if (this.nextTickMs == null) this.nextTickMs = t + stepMs;
		let made: Omit<PassiveReading, "ageMs"> | null = null;
		while (this.nextTickMs < t) {
			const r = this.readAt(this.nextTickMs);
			if (r) made = r;
			this.nextTickMs += stepMs;
		}
		// After the marks the frames before the break could still answer: none of them spans it.
		if (this.newestMs != null && t - this.newestMs > o.resetGapMs) this.samples = [];
		this.samples.push(sample);
		this.newestMs = t;
		const keepFrom = t - this.spanMs() - 1000;
		let drop = 0;
		while (drop < this.samples.length && this.samples[drop][0] < keepFrom) drop++;
		if (drop) this.samples.splice(0, drop);
		if (made) this.last = made;
		return made ? { ...made, ageMs: t - made.atMs } : null;
	}

	/** The newest reading, with its age against the newest frame pushed; null before the first. */
	reading(): PassiveReading | null {
		if (!this.last || this.newestMs == null) return null;
		return { ...this.last, ageMs: this.newestMs - this.last.atMs };
	}

	/** Forget every frame and reading; the next frame pushed starts the marks again. */
	reset(): void {
		this.samples = [];
		this.nextTickMs = null;
		this.newestMs = null;
		this.last = null;
	}

	/** The older half is the half-window read at the mark at least half a window back: a mark already read. */
	private olderHalfAgoMs(): number {
		const o = this.options;
		return Math.ceil(o.windowS / 2 / o.everyS) * o.everyS * 1000;
	}

	/** How far back a reading looks: the older half's start. */
	private spanMs(): number {
		const o = this.options;
		return Math.max(o.windowS * 1000, this.olderHalfAgoMs() + (o.windowS / 2) * 1000);
	}

	private line(windowS: number, atMs: number): Line | null {
		const est = estimateOwnPulse(
			this.samples,
			windowS,
			atMs,
			OWN_PULSE_COLOUR_SWITCH,
			this.options.swapMinWallToFace,
			true,
			true,
		);
		const bpm = est?.bpmFine ?? est?.bpm;
		if (!est || bpm == null || est.snrDb == null) return null;
		return { bpm, snrDb: est.snrDb };
	}

	/** The window ending at `atMs`, if it passes every gate. Cheapest refusal first. */
	private readAt(atMs: number): Omit<PassiveReading, "ageMs"> | null {
		const o = this.options;
		const whole = this.line(o.windowS, atMs);
		if (!whole || whole.snrDb < o.minSnrDb) return null;
		const half = o.windowS / 2;
		const newer = this.line(half, atMs);
		const older = newer && this.line(half, atMs - this.olderHalfAgoMs());
		if (!newer || !older || Math.abs(newer.bpm - older.bpm) > o.halfAgreeBpm) return null;
		const recent = this.line(o.recentS, atMs);
		if (!recent || Math.abs(recent.bpm - whole.bpm) > o.recentAgreeBpm) return null;
		return {
			bpm: whole.bpm,
			snrDb: whole.snrDb,
			windowS: o.windowS,
			atMs,
			halvesBpm: [newer.bpm, older.bpm],
			recentBpm: recent.bpm,
		};
	}
}

type Rgb = { r: number; g: number; b: number };

/**
 * The row the live check keeps for one frame (PulseCheck.push): the three regions, then the wall on one
 * continuous scale and the wall as the camera read it (NaN when no wall was seen). Null when the frame
 * has no three regions or no finite time, the frames the check ignores.
 */
export function rawRoiSampleOf(
	timestampMs: number,
	regions: readonly Rgb[],
	wall?: Rgb,
	wallRaw?: Rgb,
): RawRoiSample | null {
	if (regions.length < 3 || !Number.isFinite(timestampMs)) return null;
	const [f, l, r] = regions;
	const seen = wall ? (wallRaw ?? wall) : null;
	return [
		timestampMs,
		f.r,
		f.g,
		f.b,
		l.r,
		l.g,
		l.b,
		r.r,
		r.g,
		r.b,
		wall?.r ?? Number.NaN,
		wall?.g ?? Number.NaN,
		wall?.b ?? Number.NaN,
		seen?.r ?? Number.NaN,
		seen?.g ?? Number.NaN,
		seen?.b ?? Number.NaN,
	];
}

/** What feedPassiveReader needs of a pulse check: its push, called with the check's own arguments. */
export interface PassiveFeedable {
	push(
		timestampMs: number,
		regions: readonly Rgb[],
		wall?: Rgb,
		wallMiss?: unknown,
		head?: unknown,
		wallRaw?: Rgb,
		...rest: unknown[]
	): void;
}

/**
 * Hand the reader every frame the check is handed: the check's push runs first, unchanged and with the
 * same arguments, then the same row goes to the reader. The check's own state and outputs are untouched.
 */
export function feedPassiveReader(
	check: PassiveFeedable,
	reader: PassiveReader,
	onReading?: (reading: PassiveReading) => void,
): void {
	const push = check.push;
	check.push = function (this: PassiveFeedable, ...args: Parameters<PassiveFeedable["push"]>) {
		push.apply(this, args);
		const row = rawRoiSampleOf(args[0], args[1], args[2], args[5]);
		const made = row ? reader.push(row) : null;
		if (made) onReading?.(made);
	};
}

/**
 * The reader a session runs (its `passive` option), fed from the session's pulse check: none when the option
 * is off or there is no check (`pulseCheck: false`), since only the check is handed the face regions.
 */
export function passiveReaderFor(
	options: { passive?: boolean | PassiveOptions; onPassiveReading?: (reading: PassiveReading) => void },
	check: PassiveFeedable | null,
): PassiveReader | null {
	const resolved = resolvePassiveOptions(options.passive);
	if (!resolved || !check) return null;
	const reader = new PassiveReader(resolved);
	feedPassiveReader(check, reader, options.onPassiveReading);
	return reader;
}
