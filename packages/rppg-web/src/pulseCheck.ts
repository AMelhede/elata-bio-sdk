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
import { type Frame, averageRgbInROINonSkin } from "./frameSource";
import {
	OWN_PULSE_AGREE_BPM,
	OWN_PULSE_DETREND_S,
	OWN_PULSE_FS,
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
	/**
	 * The latest one-second window as it is, proven or not: its rate and how far its line
	 * stands above the noise. For diagnosis only; nothing decides on these two.
	 */
	windowBpm?: number | null;
	windowSnrDb?: number | null;
	/** How that window's pulse was read: "pos", or "greenMinusWall" for damaged colour. */
	windowMethod?: "pos" | "greenMinusWall" | null;
	/** That window's colour-damage measure, and whether the wall was seen through the whole window. */
	windowColourDamage?: number | null;
	windowWallSeen?: boolean;
	/**
	 * Frames in the last one-second step: with the wall seen, and without it because the face
	 * left no room beside it or because every patch beside it looked like skin (wallMissReason).
	 */
	wallFrames?: { seen: number; noRoom: number; skin: number };
	/** True while the face's own rhythm at the proven rate is brightness, not colour (FACE_FLICKER_RATIO). */
	faceFlicker?: boolean;
};

/**
 * Flicker on the face itself, for when no wall can be seen. A heartbeat changes the skin's
 * COLOUR (green dips most); a lamp changes its BRIGHTNESS, scaling red, green and blue alike.
 * So at the proven rate, each region's relative colour is split into brightness (the part
 * common to all three channels) and colour (the rest), and the pooled brightness / colour
 * amplitude ratio is judged. A blood-volume pulse keeps it near 3 (de Haan & van Leest 2014,
 * the PBV signature); the method is the perception lab's achromatic test (Elata perception-lab
 * lighting.ts, MIT). Withheld when the ratio exceeds this in each of the last
 * OWN_PULSE_STRONG_STREAK one-second windows, judged at once like the wall check.
 *
 * Measured 2026-10-02 on what the live check receives, the wall left out: a no-pulse video
 * under a lamp swinging 3% at 72/min showed a made-up 72 for 26 s, all 26 withheld at any
 * limit from 3.3 to 20; on 255 MCD-rPPG recordings the limit withheld 46 of 1,269 right
 * seconds at 3.3, 2 at 4 and none from 6 to 20, and none of the 23 wrong ones (those are not
 * flicker). 10 sits inside the clean range, over three times a pulse's own ratio.
 */
export const FACE_FLICKER_RATIO = 10;

/** Brightness / colour amplitude ratio of the face regions within 0.1 Hz of `bpm`. */
export function faceFlickerRatio(
	samples: readonly RawRoiSample[],
	atMs: number,
	bpm: number,
): number | null {
	const win = samples.filter(
		(s) => s[0] > atMs - OWN_PULSE_WINDOW_S * 1000 && s[0] <= atMs,
	);
	if (win.length < WALL_MIN_SAMPLES) return null;
	const t = win.map((s) => s[0] / 1000);
	const f0 = bpm / 60;
	let bright = 0;
	let colour = 0;
	for (let ri = 0; ri < 3; ri++) {
		const ch = [1, 2, 3].map((c) => {
			const x = resample(
				t,
				win.map((s) => s[c + ri * 3]),
				t[0],
				t[t.length - 1],
			);
			const m = x.reduce((a, v) => a + v, 0) / x.length || 1;
			const d = detrend(
				x.map((v) => v / m - 1),
				OWN_PULSE_DETREND_S,
			);
			const n = d.length;
			return d.map((v, k) => v * (0.5 - 0.5 * Math.cos((2 * Math.PI * k) / (n - 1))));
		});
		const n = ch[0].length;
		for (let f = f0 - 0.1; f <= f0 + 0.1 + 1e-9; f += 0.05) {
			const re = [0, 0, 0];
			const im = [0, 0, 0];
			for (let k = 0; k < n; k++) {
				const a = (2 * Math.PI * f * k) / OWN_PULSE_FS;
				const c = Math.cos(a);
				const sn = Math.sin(a);
				for (let j = 0; j < 3; j++) {
					re[j] += ch[j][k] * c;
					im[j] += ch[j][k] * sn;
				}
			}
			const sr = re[0] + re[1] + re[2];
			const si = im[0] + im[1] + im[2];
			const iPow = (sr * sr + si * si) / 3;
			const total = re.reduce((a, v, j) => a + v * v + im[j] * im[j], 0);
			bright += iPow;
			colour += Math.max(0, total - iPow);
		}
	}
	return colour > 0 ? Math.sqrt(bright / colour) : Number.POSITIVE_INFINITY;
}

/** Why no wall was found beside the face this frame (see wallBesideFace). */
export type WallMiss = "no-room" | "skin";

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
	private wallTally = { seen: 0, noRoom: 0, skin: 0 };
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
	push(timestampMs: number, regions: readonly Rgb[], wall?: Rgb, wallMiss?: WallMiss): void {
		if (regions.length < 3 || !Number.isFinite(timestampMs)) return;
		if (wall) this.wallTally.seen++;
		else if (wallMiss === "no-room") this.wallTally.noRoom++;
		else if (wallMiss === "skin") this.wallTally.skin++;
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
			// The wall beside the face, for the colour-damage switch (OWN_PULSE_COLOUR_DAMAGE).
			wall?.r ?? Number.NaN,
			wall?.g ?? Number.NaN,
			wall?.b ?? Number.NaN,
		]);
		while (this.samples.length && this.samples[0][0] < timestampMs - KEEP_MS)
			this.samples.shift();
		if (wall) this.wall.push([timestampMs, wall.r, wall.g, wall.b]);
		while (this.wall.length && this.wall[0][0] < timestampMs - WALL_KEEP_MS)
			this.wall.shift();
		if (this.lastEvalMs == null) this.lastEvalMs = timestampMs;
		if (timestampMs - this.lastEvalMs < EVAL_EVERY_MS) return;
		this.lastEvalMs = timestampMs;
		const wallFrames = this.wallTally;
		this.wallTally = { seen: 0, noRoom: 0, skin: 0 };
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
		const faceFlicker =
			held != null &&
			Array.from({ length: OWN_PULSE_STRONG_STREAK }, (_, k) => k).every((k) => {
				const q = faceFlickerRatio(this.samples, timestampMs - k * EVAL_EVERY_MS, held);
				return q != null && q > FACE_FLICKER_RATIO;
			});
		this.state = wallMatch || faceFlicker
			? {
					verdict: "not-measured",
					bpm: null,
					snrDb: v.snrDb,
					streak: v.streak,
					wallMatch,
					windowBpm: est?.bpm ?? null,
					windowSnrDb: est?.snrDb ?? null,
					windowMethod: est?.method ?? null,
					windowColourDamage: est?.colourDamage ?? null,
					windowWallSeen: est?.wallSeen ?? false,
					wallFrames,
					faceFlicker,
				}
			: {
					verdict: v.verdict,
					bpm: this.held,
					snrDb: v.snrDb,
					streak: v.streak,
					wallMatch,
					windowBpm: est?.bpm ?? null,
					windowSnrDb: est?.snrDb ?? null,
					windowMethod: est?.method ?? null,
					windowColourDamage: est?.colourDamage ?? null,
					windowWallSeen: est?.wallSeen ?? false,
					wallFrames,
					faceFlicker,
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
		this.wallTally = { seen: 0, noRoom: 0, skin: 0 };
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
 * How far the wall patch sits from the face's points, as a share of the face's width, tried in
 * this order. 0.15 clears hair on a face seen from the front. A side camera sees a turned head,
 * whose cheek, ear and neck reach well past the points, so at 0.15 the patch is all skin and the
 * wall check never runs: on the MCD-rPPG phone camera (IriunWebcam, 3 recordings, 171 frames)
 * the patch was skin in 165 of 171 frames. Trying 0.4, 0.7 and 1.0 next found wall in 170 of
 * 171 across those plus 2 side-webcam and 1 front recordings, and no single distance did
 * (0.4 failed one side webcam entirely, 0.7 and 1.0 another). Measured 2026-10-02.
 */
export const WALL_GAPS = [0.15, 0.4, 0.7, 1.0] as const;

/**
 * The wall beside the face: the first of WALL_GAPS whose patch is mostly not skin, starting from
 * `preferIndex` (the distance that worked last frame), so the wall stays one patch while it can
 * and its brightness does not step between patches. Null when every distance shows skin.
 */
export function wallBesideFace(
	points: readonly { x: number; y: number }[],
	frame: Frame,
	preferIndex: number,
): { rgb: Rgb; gapIndex: number } | null {
	const order = [preferIndex, ...WALL_GAPS.map((_, i) => i).filter((i) => i !== preferIndex)];
	for (const i of order) {
		const gap = WALL_GAPS[i];
		if (gap == null) continue;
		const patch = wallPatchFromLandmarks(points, frame.width, frame.height, gap);
		if (!patch) continue;
		const x = Math.max(0, Math.min(frame.width - 1, patch.x));
		const y = Math.max(0, Math.min(frame.height - 1, patch.y));
		const w = Math.max(1, Math.min(frame.width - x, patch.w));
		const h = Math.max(1, Math.min(frame.height - y, patch.h));
		const rgb = averageRgbInROINonSkin(frame, x, y, w, h);
		if (rgb) return { rgb, gapIndex: i };
	}
	return null;
}

/**
 * The wall beside the face as ONE signal, although the patch it is read from may move between
 * the distances in WALL_GAPS from frame to frame. Two patches of wall differ in brightness (one
 * nearer a window, one in shadow), so a raw switch between them is a step in the wall's
 * brightness, and a step puts power at every rate: it hides a lamp's rhythm from the wall check
 * and corrupts green minus the wall. So when the patch changes, the new patch is scaled to start
 * exactly where the old one left off, and that scale is kept while it stays: a lamp's swing,
 * shared by every patch, passes through unchanged. Both users of the wall are blind to its
 * absolute level (the wall check judges a signal-to-noise ratio, green minus the wall a least-
 * squares share of normalised signals).
 */
export class WallTracker {
	private gapIndex = 0;
	private current: number | null = null;
	private gain: Rgb = { r: 1, g: 1, b: 1 };
	private last: Rgb | null = null;

	/** The wall this frame on one continuous scale, or null when none was found. */
	next(
		points: readonly { x: number; y: number }[],
		frame: Frame,
	): { rgb: Rgb; gapIndex: number } | null {
		const w = wallBesideFace(points, frame, this.gapIndex);
		if (!w) return null;
		this.gapIndex = w.gapIndex;
		return { rgb: this.continuous(w.gapIndex, w.rgb), gapIndex: w.gapIndex };
	}

	/** `rgb` from patch `gapIndex`, rescaled at a change of patch so the signal does not step. */
	continuous(gapIndex: number, rgb: Rgb): Rgb {
		if (gapIndex !== this.current) {
			const to = this.last ?? rgb;
			this.gain = {
				r: to.r / (rgb.r || 1e-6),
				g: to.g / (rgb.g || 1e-6),
				b: to.b / (rgb.b || 1e-6),
			};
			this.current = gapIndex;
		}
		this.last = { r: rgb.r * this.gain.r, g: rgb.g * this.gain.g, b: rgb.b * this.gain.b };
		return this.last;
	}
}

/**
 * Why wallBesideFace found nothing: "no-room" when no distance leaves a patch inside the frame
 * (the face fills it), otherwise "skin" (every patch looked like skin: an ear or neck, or a
 * beige or wooden wall, or warm light making the wall skin-coloured).
 */
export function wallMissReason(
	points: readonly { x: number; y: number }[],
	width: number,
	height: number,
): WallMiss {
	return WALL_GAPS.some((g) => wallPatchFromLandmarks(points, width, height, g))
		? "skin"
		: "no-room";
}

/**
 * A patch of wall beside the face for the wall check, in pixels, or null when there is no
 * room for one (a face that fills the frame). Same rule as Peak's capture: at cheek height
 * (the middle third of the face), a quarter of the face wide, `gap` of the face's width clear of its
 * edge (WALL_GAPS), on whichever side has more room. The face's edges are taken
 * at the 5th and 95th percentile of the points across and the 3rd and 97th down, so a single
 * stray point cannot move the patch.
 */
export function wallPatchFromLandmarks(
	points: readonly { x: number; y: number }[],
	width: number,
	height: number,
	gap: number = WALL_GAPS[0],
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
	const clear = fw * gap;
	const y = y0 + fh / 3;
	const h = fh / 3;
	if (y < 0 || y + h > height) return null;
	const roomLeft = x0 - clear;
	const roomRight = width - (x0 + fw + clear);
	let x: number | null = null;
	if (roomLeft >= roomRight && roomLeft >= w) x = roomLeft - w;
	else if (roomRight > roomLeft && roomRight >= w) x = x0 + fw + clear;
	if (x == null) return null;
	return {
		x: Math.round(x),
		y: Math.round(y),
		w: Math.max(1, Math.round(w)),
		h: Math.max(1, Math.round(h)),
	};
}
