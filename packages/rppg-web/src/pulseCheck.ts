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
	estimateOwnPulse,
	OWN_PULSE_WINDOW_S,
	type OwnPulseEstimate,
	ownPulseVerdict,
	type RawRoiSample,
} from "./pulseCheckCore";

export type PulseCheckState = {
	/** "measured" while a pulse is proven; otherwise "not-measured" or "unknown". */
	verdict: "measured" | "not-measured" | "unknown";
	/** The proven rate, or null. */
	bpm: number | null;
	snrDb: number | null;
	/** Consecutive windows agreeing on the current rate. */
	streak: number;
};

const EVAL_EVERY_MS = 1000;
const KEEP_MS = (OWN_PULSE_WINDOW_S + 2) * 1000;
const HISTORY_MAX = 120;

export class PulseCheck {
	private samples: RawRoiSample[] = [];
	private history: (OwnPulseEstimate | null)[] = [];
	private held: number | null = null;
	private lastEvalMs: number | null = null;
	private state: PulseCheckState = { verdict: "unknown", bpm: null, snrDb: null, streak: 0 };

	/** One frame: mean RGB of forehead, left cheek and right cheek, at the frame's timestamp. */
	push(timestampMs: number, regions: readonly { r: number; g: number; b: number }[]): void {
		if (regions.length < 3 || !Number.isFinite(timestampMs)) return;
		const [f, l, r] = regions;
		this.samples.push([timestampMs, f.r, f.g, f.b, l.r, l.g, l.b, r.r, r.g, r.b]);
		while (this.samples.length && this.samples[0][0] < timestampMs - KEEP_MS) this.samples.shift();
		if (this.lastEvalMs == null) this.lastEvalMs = timestampMs;
		if (timestampMs - this.lastEvalMs < EVAL_EVERY_MS) return;
		this.lastEvalMs = timestampMs;
		const est = estimateOwnPulse(this.samples, OWN_PULSE_WINDOW_S, timestampMs);
		if (est && (est as { skip?: boolean }).skip) return;
		this.history.push(est);
		if (this.history.length > HISTORY_MAX) this.history.shift();
		const v = ownPulseVerdict(this.history, this.held);
		this.held = v.verdict === "measured" ? v.bpm : null;
		this.state = { verdict: v.verdict, bpm: this.held, snrDb: v.snrDb, streak: v.streak };
	}

	getState(): PulseCheckState {
		return this.state;
	}

	reset(): void {
		this.samples = [];
		this.history = [];
		this.held = null;
		this.lastEvalMs = null;
		this.state = { verdict: "unknown", bpm: null, snrDb: null, streak: 0 };
	}
}
