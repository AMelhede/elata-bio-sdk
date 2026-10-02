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
 */
import {
	OWN_PULSE_WINDOW_S,
	type OwnPulseEstimate,
	type RawRoiSample,
	estimateOwnPulse,
	ownPulseVerdict,
} from "./pulseCheckCore";

export type PulseCheckState = {
	/** "measured" while a pulse is proven; otherwise "not-measured" or "unknown". */
	verdict: "measured" | "not-measured" | "unknown";
	/** The proven rate, or null. */
	bpm: number | null;
	snrDb: number | null;
	/** Consecutive windows agreeing on the current rate. */
	streak: number;
	/**
	 * The latest one-second window as it is, proven or not: its rate and how far its line
	 * stands above the noise. For diagnosis only; nothing decides on these two.
	 */
	windowBpm?: number | null;
	windowSnrDb?: number | null;
};

const EVAL_EVERY_MS = 1000;
const KEEP_MS = (OWN_PULSE_WINDOW_S + 2) * 1000;
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
	private history: (OwnPulseEstimate | null)[] = [];
	private held: number | null = null;
	private lastEvalMs: number | null = null;
	private lostSinceMs: number | null = null;
	private state: PulseCheckState = {
		verdict: "unknown",
		bpm: null,
		snrDb: null,
		streak: 0,
	};

	/** One frame: mean RGB of forehead, left cheek and right cheek, at the frame's timestamp. */
	push(
		timestampMs: number,
		regions: readonly { r: number; g: number; b: number }[],
	): void {
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
		if (this.lastEvalMs == null) this.lastEvalMs = timestampMs;
		if (timestampMs - this.lastEvalMs < EVAL_EVERY_MS) return;
		this.lastEvalMs = timestampMs;
		const est = estimateOwnPulse(this.samples, OWN_PULSE_WINDOW_S, timestampMs);
		if (est && (est as { skip?: boolean }).skip) return;
		this.history.push(est);
		if (this.history.length > HISTORY_MAX) this.history.shift();
		const v = ownPulseVerdict(this.history, this.held);
		this.held = v.verdict === "measured" ? v.bpm : null;
		this.state = {
			verdict: v.verdict,
			bpm: this.held,
			snrDb: v.snrDb,
			streak: v.streak,
			windowBpm: est?.bpm ?? null,
			windowSnrDb: est?.snrDb ?? null,
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
		this.history = [];
		this.held = null;
		this.lastEvalMs = null;
		this.lostSinceMs = null;
		this.state = { verdict: "unknown", bpm: null, snrDb: null, streak: 0 };
	}
}
