/**
 * The pulse check's inputs, recorded (`createRppgSession({ recordPulseCheckInputs: true })`), and
 * their replay (`replayPulseCheck`).
 *
 * Why: a rule of the check (such as the four dim-light candidates in PulseCheckRules) can only be
 * judged against a reference sensor on the seconds it ran. An app that saves only the number it
 * showed cannot say what a rule that was off would have shown. This keeps exactly what the check
 * was handed, in order, and the session's own reads of it, so any rule setting can be replayed
 * offline on the same seconds, through the same PulseCheck code.
 *
 * What it keeps, as events in the order they happened (PulseCheckInputEvent):
 * - every `push`: the frame's time, the colour of each face region handed over (forehead, left
 *   cheek, right cheek), the wall beside the face (on the tracker's continuous scale) and the same
 *   wall as the camera read it, why no wall was found, and the head's position (or that the face
 *   mesh found none, or that none was handed over);
 * - every `faceLost` (a frame with no forehead and cheeks);
 * - every `getMetrics()` read of the session: the rate it showed, and the session's own reason for
 *   showing none whatever the check held ("no_face", "processor_failed").
 *
 * It changes nothing: it reads the arguments and then calls the check exactly as before. With the
 * option off the session builds a plain PulseCheck and none of this code runs.
 *
 * Memory is bounded: the newest `seconds` (PULSE_CHECK_RECORDING_SECONDS by default) are kept, and
 * at most PULSE_CHECK_RECORDING_EVENTS_PER_SECOND events per second of that, in a ring buffer.
 * Measured (Node 22, frames with wall, raw wall and head, one read per frame, 30 a second): 5 minutes
 * is 18,000 events, about 7 MB held and 3.6 MB as JSON; a longer session stays at that. `dropped`
 * counts events let go from the start.
 *
 * Exactness: a replay with the recording's own rules gives back every state and every shown number
 * of the live session, provided nothing was dropped (`dropped: 0`). A recording that let its start
 * go replays as a check that began at its first kept event; its first numbers can then differ from
 * what was shown, until the check's memory of the earlier frames would have run out.
 */
import { RPPG_WEB_BUILD_VERSION } from "./buildInfo";
import {
	type HeadPosition,
	PulseCheck,
	type PulseCheckRules,
	type PulseCheckState,
	type ResolvedPulseCheckRules,
	type WallMiss,
} from "./pulseCheck";

type Rgb = { r: number; g: number; b: number };

/** The `format` field of every recording. */
export const PULSE_CHECK_RECORDING_FORMAT = "rppg-web/pulse-check-inputs";
/** The `version` field: raised whenever the meaning of a field changes. A replay refuses other versions. */
export const PULSE_CHECK_RECORDING_VERSION = 1;
/** How many seconds a recording keeps by default: the newest 5 minutes. */
export const PULSE_CHECK_RECORDING_SECONDS = 300;
/**
 * The most events kept per second of `seconds`: a 60 frames a second camera with one session read
 * per frame. A faster stream keeps fewer seconds rather than more memory.
 */
export const PULSE_CHECK_RECORDING_EVENTS_PER_SECOND = 120;

/** [r, g, b] as handed to the check. */
export type PulseCheckRgb = [number, number, number];

/** Why a session read showed no rate whatever the check held; null when the read is the check's. */
export type PulseCheckReadReason = "no_face" | "processor_failed" | null;

/**
 * One event. Field `[1]` is always a time in ms on the frames' clock (for "o" and "r", the newest
 * frame's time seen before it, or null before any).
 *
 * - `["f", t, regions, wall, wallRaw, wallMiss, head]`: a `push`. `regions`: every region handed
 *   over, normally three. `wall`: the wall beside the face, or null when none was handed over.
 *   `wallRaw`: the wall as the camera read it, or null when not handed over. `wallMiss`: why no
 *   wall was found ("no-room", "skin"), or null. `head`: `[x, y, faceWidth]` (pixels), `null` when
 *   the face mesh found no head that frame, or `false` when no head was handed over at all.
 * - `["l", t]`: a `faceLost`.
 * - `["o", t, bpm]`: written only by builds before 0.15.0-test.25 (the removed agreement path); replay skips it.
 * - `["r", t, bpm, reason]`: a session `getMetrics()` read: the rate it showed (or null) and the
 *   session's own reason for showing none (PulseCheckReadReason).
 */
export type PulseCheckInputEvent =
	| [
			"f",
			number,
			PulseCheckRgb[],
			PulseCheckRgb | null,
			PulseCheckRgb | null,
			WallMiss | null,
			[number, number, number] | null | false,
	  ]
	| ["l", number]
	| ["o", number | null, number | null]
	| ["r", number | null, number | null, PulseCheckReadReason];

/** A recording: what one session's pulse check was fed, with what it needs to be replayed. */
export type PulseCheckRecording = {
	format: typeof PULSE_CHECK_RECORDING_FORMAT;
	version: typeof PULSE_CHECK_RECORDING_VERSION;
	/** The build that made it (RPPG_WEB_BUILD_VERSION). */
	build: string;
	/** The rules the live check ran (every rule named). */
	rules: ResolvedPulseCheckRules;
	/** Written only by builds before 0.15.0-test.25 (the removed agreement path); ignored. */
	agreement?: boolean;
	/** The most seconds this recording keeps. */
	seconds: number;
	/** Events let go from the start to stay within the bound; 0 means everything since the check was made. */
	dropped: number;
	events: PulseCheckInputEvent[];
};

const rgb3 = (c: Rgb): PulseCheckRgb => [c.r, c.g, c.b];

/**
 * A PulseCheck that also keeps what it is fed (see the file comment). createRppgSession builds one
 * when `recordPulseCheckInputs` is set; an app that builds its own DemoRunner and RppgSession can
 * pass one as their check.
 */
export class RecordingPulseCheck extends PulseCheck {
	private readonly recSeconds: number;
	private readonly recCap: number;
	/** A fixed-size circular buffer: `recCount` events from index `recHead`, oldest first. */
	private recRing: PulseCheckInputEvent[] = [];
	/** The clock each kept event is filed under: the newest frame time seen when it arrived (or the first one, for events before it). */
	private recFiled: number[] = [];
	private recHead = 0;
	private recCount = 0;
	private recDropped = 0;
	/** The newest finite frame time seen, the clock that events without their own time are filed under. */
	private recLastT: number | null = null;

	constructor(opts: { rules?: PulseCheckRules; seconds?: number } = {}) {
		super({ rules: opts.rules });
		const seconds = opts.seconds ?? PULSE_CHECK_RECORDING_SECONDS;
		if (!(seconds > 0) || !Number.isFinite(seconds))
			throw new RangeError(`recordPulseCheckInputs seconds must be a positive number, not ${seconds}`);
		this.recSeconds = seconds;
		this.recCap = Math.max(1, Math.ceil(seconds * PULSE_CHECK_RECORDING_EVENTS_PER_SECOND));
	}

	override push(
		timestampMs: number,
		regions: readonly Rgb[],
		wall?: Rgb,
		wallMiss?: WallMiss,
		head?: HeadPosition | null,
		wallRaw?: Rgb,
	): void {
		this.keep(
			[
				"f",
				timestampMs,
				regions.map(rgb3),
				wall ? rgb3(wall) : null,
				wallRaw ? rgb3(wallRaw) : null,
				wallMiss ?? null,
				head === undefined ? false : head === null ? null : [head.x, head.y, head.faceWidth],
			],
			timestampMs,
		);
		super.push(timestampMs, regions, wall, wallMiss, head, wallRaw);
	}

	override faceLost(timestampMs: number): void {
		this.keep(["l", timestampMs], timestampMs);
		super.faceLost(timestampMs);
	}

	/** A session read: the rate it showed, and its own reason for showing none (RppgSession.getMetrics calls this). */
	noteRead(bpm: number | null, reason: PulseCheckReadReason): void {
		this.keep(["r", this.recLastT, bpm, reason], null);
	}

	/** A copy of what is kept now, oldest event first. */
	getRecording(): PulseCheckRecording {
		const events: PulseCheckInputEvent[] = [];
		for (let i = 0; i < this.recCount; i++) events.push(this.recRing[(this.recHead + i) % this.recCap]);
		return {
			format: PULSE_CHECK_RECORDING_FORMAT,
			version: PULSE_CHECK_RECORDING_VERSION,
			build: RPPG_WEB_BUILD_VERSION,
			rules: { ...this.rules },
			seconds: this.recSeconds,
			dropped: this.recDropped,
			events,
		};
	}

	private keep(event: PulseCheckInputEvent, t: number | null): void {
		if (t != null && Number.isFinite(t)) {
			// Events kept before the first frame time are filed under it.
			if (this.recLastT == null) for (let i = 0; i < this.recCount; i++) this.recFiled[(this.recHead + i) % this.recCap] = t;
			this.recLastT = this.recLastT == null ? t : Math.max(this.recLastT, t);
		}
		if (this.recCount === this.recCap) this.dropOldest();
		const at = (this.recHead + this.recCount) % this.recCap;
		this.recRing[at] = event;
		this.recFiled[at] = this.recLastT ?? Number.NEGATIVE_INFINITY;
		this.recCount += 1;
		// Let go of events filed before the window, oldest first; the newest event always stays.
		if (this.recLastT == null) return;
		const oldest = this.recLastT - this.recSeconds * 1000;
		while (this.recCount > 1 && this.recFiled[this.recHead] < oldest) this.dropOldest();
	}

	private dropOldest(): void {
		this.recRing[this.recHead] = undefined as unknown as PulseCheckInputEvent;
		this.recHead = (this.recHead + 1) % this.recCap;
		this.recCount -= 1;
		this.recDropped += 1;
	}
}

/** One session read, replayed. */
export type PulseCheckReplayRead = {
	/** The newest frame time before the read (ms), or null. */
	t: number | null;
	/** The rate the session would have shown with the replay's rules, or null. */
	bpm: number | null;
	/** The rate the live session showed. */
	live: number | null;
	/** The session's own reason for showing none, as recorded. */
	reason: PulseCheckReadReason;
	/** The replayed check's state at the read. */
	state: PulseCheckState;
};

/** One evaluation of the replayed check (about one a second while frames arrive). */
export type PulseCheckReplayEvaluation = {
	/** The time of the frame that brought it (ms). */
	t: number;
	/** The rate the check shows: its `bpm` while the verdict is "measured", else null. */
	bpm: number | null;
	state: PulseCheckState;
};

export type PulseCheckReplay = {
	/** One per recorded session read, in order: what the session would have shown. */
	reads: PulseCheckReplayRead[];
	/** One per evaluation of the check, in order. */
	evaluations: PulseCheckReplayEvaluation[];
};

function checkHeader(r: { format?: unknown; version?: unknown }): void {
	if (r.format !== PULSE_CHECK_RECORDING_FORMAT)
		throw new Error(`not a pulse-check recording: format is ${JSON.stringify(r.format)}, expected "${PULSE_CHECK_RECORDING_FORMAT}"`);
	if (r.version !== PULSE_CHECK_RECORDING_VERSION)
		throw new Error(`pulse-check recording version ${JSON.stringify(r.version)} is not version ${PULSE_CHECK_RECORDING_VERSION}, which this build reads`);
}

const toRgb = (c: PulseCheckRgb): Rgb => ({ r: c[0], g: c[1], b: c[2] });

/**
 * Replays a recording through a fresh PulseCheck, the same code the session runs.
 *
 * `rules`: as the session option `pulseCheckRules` (each rule left out takes its default); left out,
 * the rules the recording was made with. With the recording's own rules and `dropped: 0`, every read's `bpm` equals its `live`.
 */
export function replayPulseCheck(
	recording: PulseCheckRecording,
	options: { rules?: PulseCheckRules } = {},
): PulseCheckReplay {
	checkHeader(recording);
	const check = new PulseCheck({ rules: options.rules ?? recording.rules });
	const reads: PulseCheckReplayRead[] = [];
	const evaluations: PulseCheckReplayEvaluation[] = [];
	for (const e of recording.events) {
		if (e[0] === "f") {
			const [, t, regions, wall, wallRaw, wallMiss, head] = e;
			const before = check.evaluations;
			check.push(
				t,
				regions.map(toRgb),
				wall ? toRgb(wall) : undefined,
				wallMiss ?? undefined,
				head === false ? undefined : head === null ? null : { x: head[0], y: head[1], faceWidth: head[2] },
				wallRaw ? toRgb(wallRaw) : undefined,
			);
			if (check.evaluations !== before) {
				const state = check.getState();
				evaluations.push({ t, bpm: state.verdict === "measured" ? state.bpm : null, state });
			}
		} else if (e[0] === "l") check.faceLost(e[1]);
		else if (e[0] === "r") {
			const state = check.getState();
			const reason = e[3];
			reads.push({
				t: e[1],
				bpm: reason != null ? null : state.verdict === "measured" ? state.bpm : null,
				live: e[2],
				reason,
				state,
			});
		}
	}
	return { reads, evaluations };
}

// JSON has no NaN, no infinities and no negative zero. The check is handed whatever the frame gave,
// so these are written as strings and read back as numbers; no other string field takes these values.
const SPECIAL: Record<string, number> = { NaN: Number.NaN, Infinity: Number.POSITIVE_INFINITY, "-Infinity": Number.NEGATIVE_INFINITY, "-0": -0 };

/** A recording as JSON text, every number kept exactly (see parsePulseCheckRecording). */
export function serializePulseCheckRecording(recording: PulseCheckRecording): string {
	return JSON.stringify(recording, (_key, v) =>
		typeof v === "number" && (!Number.isFinite(v) || Object.is(v, -0)) ? (Object.is(v, -0) ? "-0" : String(v)) : v,
	);
}

/** Reads a recording written by serializePulseCheckRecording; throws on another format or version. */
export function parsePulseCheckRecording(text: string): PulseCheckRecording {
	const r = JSON.parse(text, (_key, v) => (typeof v === "string" && v in SPECIAL ? SPECIAL[v] : v)) as PulseCheckRecording;
	checkHeader(r);
	return r;
}
