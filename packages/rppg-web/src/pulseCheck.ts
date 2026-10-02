/**
 * Optional real-pulse check (`createRppgSession({ pulseCheck: true })`, off by default).
 *
 * Why: the heart rate is the strongest rhythm in the colour signal, and there is always a
 * strongest rhythm, including when no pulse is visible (noise, light, motion). Nothing in
 * the pipeline asks whether the rhythm is a pulse, so a number is reported either way.
 *
 * What this does: it keeps the mean skin colour of the three face regions the SDK already
 * samples (forehead, left cheek, right cheek) and, once a second, runs the checker in
 * pulseCheckCore.ts. A pulse counts as proven only when the regions agree on the same rate
 * across 8 consecutive windows with the line clearly above the noise. Noise does not agree
 * across separate patches of skin for that long; a heartbeat does. While proven, the
 * session reports the rate the check measured; otherwise it reports no rate.
 *
 * Measured in AMelhede/rppg-demo-sandbox (fix 01): 12 people, 720 s, right 163 of 164
 * seconds shown, against 153 of 580 for the unchecked rate.
 *
 * Wall check (optional, used when the caller passes a patch of wall beside the face): a
 * heartbeat is only in skin, a light that pulses changes the wall as well. If the wall's
 * brightness pulses at the proven rate, far above its noise, in each of the last 4
 * one-second windows, the rate is withheld. The caller passes only wall pixels that do not
 * look like skin: a face edge or an ear in the patch carries the person's own pulse.
 * Measured (sandbox fix 07): a no-pulse video with a light swinging 3% at 72/min showed 72
 * for 27 s; the wall check withheld all 27. On 240 real recordings it withheld none of
 * 4,965 right seconds and delayed no first reading.
 */
import {
	OWN_PULSE_AGREE_BPM,
	OWN_PULSE_DETREND_S,
	OWN_PULSE_STRONG_STREAK,
	OWN_PULSE_WINDOW_S,
	type OwnPulseEstimate,
	type RawRoiSample,
	detrend,
	estimateOwnPulse,
	ownPulseVerdict,
	peakOfSpectrum,
	resample,
	spectrum,
} from "./pulseCheckCore";

export type PulseCheckState = {
	/** "measured" while a pulse is proven; otherwise "not-measured" or "unknown". */
	verdict: "measured" | "not-measured" | "unknown";
	/** The proven rate, or null. */
	bpm: number | null;
	snrDb: number | null;
	/** Consecutive windows agreeing on the current rate. */
	streak: number;
	/** True while the wall beside the face carries the proven rate, so the rate is withheld. */
	wallMatch: boolean;
};

type Rgb = { r: number; g: number; b: number };

/** Minimum wall frames in a window before it is judged (3 s at 20 fps). */
const WALL_MIN_SAMPLES = 60;

/**
 * How loud the wall's line must be, in dB over its noise, to count as a light. Measured
 * (sandbox fix 07): on 240 real recordings the wall's brightness reached at most +7.9 dB at
 * the person's proven rate by chance (99 in 100 windows under +6.1); a light swinging 3% put
 * the wall at +26 to +32 dB. +12 clears every real window with 4 dB to spare and sits about
 * 5 dB under where a 1% light lands (scaled from the 3% figure).
 */
const WALL_MIN_SNR_DB = 12;

/**
 * Whether the wall carries `bpm` the way a light would: the strongest in-band line of its
 * BRIGHTNESS (R + G + B), within OWN_PULSE_AGREE_BPM of the rate and WALL_MIN_SNR_DB above its
 * noise. Brightness, not colour: a lamp scales a grey wall's R, G and B alike, which is exactly
 * the change the colour method cancels; and a heartbeat never changes a wall's brightness.
 */
function wallCarries(
	wall: [number, number, number, number][],
	atMs: number,
	bpm: number,
): boolean {
	const win = wall.filter(
		(w) => w[0] > atMs - OWN_PULSE_WINDOW_S * 1000 && w[0] <= atMs,
	);
	if (win.length < WALL_MIN_SAMPLES) return false;
	const t = win.map((w) => w[0] / 1000);
	const brightness = resample(
		t,
		win.map((w) => w[1] + w[2] + w[3]),
		t[0],
		t[t.length - 1],
	);
	const pk = peakOfSpectrum(spectrum(detrend(brightness, OWN_PULSE_DETREND_S)));
	return (
		Number.isFinite(pk.bpm) &&
		Math.abs(pk.bpm - bpm) <= OWN_PULSE_AGREE_BPM &&
		pk.snrDb >= WALL_MIN_SNR_DB
	);
}

const EVAL_EVERY_MS = 1000;
const KEEP_MS = (OWN_PULSE_WINDOW_S + 2) * 1000;
/** The wall check looks back over OWN_PULSE_STRONG_STREAK windows, so it keeps that much more. */
const WALL_KEEP_MS = KEEP_MS + OWN_PULSE_STRONG_STREAK * EVAL_EVERY_MS;
const HISTORY_MAX = 120;
/**
 * A proven rate belongs to the face it was measured on. Once no face has reached the check
 * for this long, the rate is dropped and the proof starts over: the face that comes back may
 * be someone else, or in other light. One evaluation interval, so a rate is never shown for
 * longer than the check takes to re-judge it, while a one-frame face-finder dropout (a few
 * tens of ms) keeps it. Found on a real laptop 2026-10-02: a proven 67 stayed on screen with
 * the camera turned to a wall, because nothing reached the check to change its mind.
 */
const FACE_GONE_MS = EVAL_EVERY_MS;

export class PulseCheck {
	private samples: RawRoiSample[] = [];
	private wall: [number, number, number, number][] = [];
	private history: (OwnPulseEstimate | null)[] = [];
	private held: number | null = null;
	private lastEvalMs: number | null = null;
	private lostSinceMs: number | null = null;
	private state: PulseCheckState = {
		verdict: "unknown",
		bpm: null,
		snrDb: null,
		streak: 0,
		wallMatch: false,
	};

	/**
	 * One frame: mean RGB of forehead, left cheek and right cheek, at the frame's timestamp,
	 * and optionally the mean RGB of a patch of wall beside the face (see the wall check).
	 */
	push(timestampMs: number, regions: readonly Rgb[], wall?: Rgb): void {
		if (regions.length < 3 || !Number.isFinite(timestampMs)) return;
		// Frames that stopped arriving unannounced count as a lost face too.
		const last = this.samples[this.samples.length - 1];
		if (last && timestampMs - last[0] > FACE_GONE_MS) this.reset();
		this.lostSinceMs = null;
		const [f, l, r] = regions;
		this.samples.push([
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
		]);
		while (this.samples.length && this.samples[0][0] < timestampMs - KEEP_MS)
			this.samples.shift();
		if (wall) this.wall.push([timestampMs, wall.r, wall.g, wall.b]);
		while (this.wall.length && this.wall[0][0] < timestampMs - WALL_KEEP_MS)
			this.wall.shift();
		if (this.lastEvalMs == null) this.lastEvalMs = timestampMs;
		if (timestampMs - this.lastEvalMs < EVAL_EVERY_MS) return;
		this.lastEvalMs = timestampMs;
		const est = estimateOwnPulse(this.samples, OWN_PULSE_WINDOW_S, timestampMs);
		if (est && (est as { skip?: boolean }).skip) return;
		this.history.push(est);
		if (this.history.length > HISTORY_MAX) this.history.shift();
		const v = ownPulseVerdict(this.history, this.held);
		this.held = v.verdict === "measured" ? v.bpm : null;
		// The wall check only withholds; it never changes what the check itself has proven.
		// Judged over the last 4 one-second windows at once, not counted forward from the
		// moment of proof, so a lamp's rate is withheld from its first second.
		const held = this.held;
		const wallMatch =
			held != null &&
			Array.from({ length: OWN_PULSE_STRONG_STREAK }, (_, k) => k).every((k) =>
				wallCarries(this.wall, timestampMs - k * EVAL_EVERY_MS, held),
			);
		this.state = wallMatch
			? {
					verdict: "not-measured",
					bpm: null,
					snrDb: v.snrDb,
					streak: v.streak,
					wallMatch,
				}
			: {
					verdict: v.verdict,
					bpm: this.held,
					snrDb: v.snrDb,
					streak: v.streak,
					wallMatch,
				};
	}

	/** A frame in which no face (no forehead and cheeks) was found. */
	faceLost(timestampMs: number): void {
		if (!Number.isFinite(timestampMs)) return;
		if (this.lostSinceMs == null) this.lostSinceMs = timestampMs;
		else if (timestampMs - this.lostSinceMs >= FACE_GONE_MS) this.reset();
	}

	getState(): PulseCheckState {
		return this.state;
	}

	reset(): void {
		this.samples = [];
		this.wall = [];
		this.history = [];
		this.held = null;
		this.lastEvalMs = null;
		this.lostSinceMs = null;
		this.state = {
			verdict: "unknown",
			bpm: null,
			snrDb: null,
			streak: 0,
			wallMatch: false,
		};
	}
}

/**
 * A patch of wall beside the face for the wall check, in pixels, or null when there is no
 * room for one (a face that fills the frame). Same rule as Peak's capture: at cheek height
 * (the middle third of the face), a quarter of the face wide, 0.15 of the face clear of its
 * edge so hair is not counted, on whichever side has more room. The face's edges are taken
 * at the 5th and 95th percentile of the points across and the 3rd and 97th down, so a single
 * stray point cannot move the patch.
 */
export function wallPatchFromLandmarks(
	points: readonly { x: number; y: number }[],
	width: number,
	height: number,
): { x: number; y: number; w: number; h: number } | null {
	if (!points.length || width <= 0 || height <= 0) return null;
	const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
	const xs = points.map((p) => clamp01(p.x) * width).sort((a, b) => a - b);
	const ys = points.map((p) => clamp01(p.y) * height).sort((a, b) => a - b);
	const pick = (v: number[], q: number) =>
		v[Math.min(v.length - 1, Math.max(0, Math.floor((v.length - 1) * q)))];
	const x0 = pick(xs, 0.05);
	const y0 = pick(ys, 0.03);
	const fw = Math.max(1, pick(xs, 0.95) - x0);
	const fh = Math.max(1, pick(ys, 0.97) - y0);
	const w = fw * 0.25;
	const gap = fw * 0.15;
	const y = y0 + fh / 3;
	const h = fh / 3;
	if (y < 0 || y + h > height) return null;
	const roomLeft = x0 - gap;
	const roomRight = width - (x0 + fw + gap);
	let x: number | null = null;
	if (roomLeft >= roomRight && roomLeft >= w) x = roomLeft - w;
	else if (roomRight > roomLeft && roomRight >= w) x = x0 + fw + gap;
	if (x == null) return null;
	return {
		x: Math.round(x),
		y: Math.round(y),
		w: Math.max(1, Math.round(w)),
		h: Math.max(1, Math.round(h)),
	};
}
