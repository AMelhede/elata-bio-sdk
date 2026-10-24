import { type HeadPosition, PulseCheck, type PulseCheckRules, type PulseCheckState, type ResolvedPulseCheckRules, type WallMiss } from "./pulseCheck.js";
type Rgb = {
    r: number;
    g: number;
    b: number;
};
/** The `format` field of every recording. */
export declare const PULSE_CHECK_RECORDING_FORMAT = "rppg-web/pulse-check-inputs";
/** The `version` field: raised whenever the meaning of a field changes. A replay refuses other versions. */
export declare const PULSE_CHECK_RECORDING_VERSION = 1;
/** How many seconds a recording keeps by default: the newest 5 minutes. */
export declare const PULSE_CHECK_RECORDING_SECONDS = 300;
/**
 * The most events kept per second of `seconds`: a 60 frames a second camera with one session read
 * per frame. A faster stream keeps fewer seconds rather than more memory.
 */
export declare const PULSE_CHECK_RECORDING_EVENTS_PER_SECOND = 120;
/** [r, g, b] as handed to the check. */
export type PulseCheckRgb = [number, number, number];
/** Why a session read showed no rate whatever the check held; null when the read is the check's. */
export type PulseCheckReadReason = "no_face" | "no_frames" | "processor_failed" | null;
/**
 * One event. Field `[1]` is always a time in ms on the frames' clock (for "o" and "r", the highest
 * frame time seen before it, which after a clock that stepped back is not the newest frame's; null
 * before any).
 *
 * - `["f", t, regions, wall, wallRaw, wallMiss, head]`: a `push`. `regions`: every region handed
 *   over, normally three. `wall`: the wall beside the face, or null when none was handed over.
 *   `wallRaw`: the wall as the camera read it, or null when not handed over. `wallMiss`: why no
 *   wall was found ("no-room", "skin"), or null. `head`: `[x, y, faceWidth]` (pixels), plus a fourth number,
 *   mouthOpen (share of face width), when the mesh gave the lips (from test.28), and from test.41 three more,
 *   yaw, pitch and roll in degrees (mouthOpen then written as null when absent), `null` when
 *   the face mesh found no head that frame, or `false` when no head was handed over at all.
 * - `["l", t]`: a `faceLost`.
 * - `["o", t, bpm]`: written only by builds before 0.15.0-test.25 (the removed agreement path); replay skips it.
 * - `["r", t, bpm, reason]`: a session `getMetrics()` read: the rate it showed (or null) and the
 *   session's own reason for showing none (PulseCheckReadReason).
 */
export type PulseCheckInputEvent = [
    "f",
    number,
    PulseCheckRgb[],
    PulseCheckRgb | null,
    PulseCheckRgb | null,
    WallMiss | null,
    [
        number,
        number,
        number
    ] | [number, number, number, number] | [number, number, number, number | null, number, number | null, number | null] | null | false
] | ["l", number] | ["o", number | null, number | null] | ["r", number | null, number | null, PulseCheckReadReason];
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
/**
 * A PulseCheck that also keeps what it is fed (see the file comment). createRppgSession builds one
 * when `recordPulseCheckInputs` is set; an app that builds its own DemoRunner and RppgSession can
 * pass one as their check.
 */
export declare class RecordingPulseCheck extends PulseCheck {
    private readonly recSeconds;
    private readonly recCap;
    /** A fixed-size circular buffer: `recCount` events from index `recHead`, oldest first. */
    private recRing;
    /** The clock each kept event is filed under: the newest frame time seen when it arrived (or the first one, for events before it). */
    private recFiled;
    private recHead;
    private recCount;
    private recDropped;
    /** The newest finite frame time seen, the clock that events without their own time are filed under. */
    private recLastT;
    constructor(opts?: {
        rules?: PulseCheckRules;
        seconds?: number;
    });
    push(timestampMs: number, regions: readonly Rgb[], wall?: Rgb, wallMiss?: WallMiss, head?: HeadPosition | null, wallRaw?: Rgb): void;
    faceLost(timestampMs: number): void;
    /** A session read: the rate it showed, and its own reason for showing none (RppgSession.getMetrics calls this). */
    noteRead(bpm: number | null, reason: PulseCheckReadReason): void;
    /** A copy of what is kept now, oldest event first. */
    getRecording(): PulseCheckRecording;
    private keep;
    private dropOldest;
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
/**
 * Replays a recording through a fresh PulseCheck, the same code the session runs.
 *
 * `rules`: as the session option `pulseCheckRules` (each rule left out takes its default); left out,
 * the rules the recording was made with, and a rule the recording does not name is off: it did not
 * exist in the build that made it, so its check ran without it. With the recording's own rules and
 * `dropped: 0`, every read's `bpm` equals its `live`.
 */
export declare function replayPulseCheck(recording: PulseCheckRecording, options?: {
    rules?: PulseCheckRules;
}): PulseCheckReplay;
/** A recording as JSON text, every number kept exactly (see parsePulseCheckRecording). */
export declare function serializePulseCheckRecording(recording: PulseCheckRecording): string;
/** Reads a recording written by serializePulseCheckRecording; throws on another format or version. */
export declare function parsePulseCheckRecording(text: string): PulseCheckRecording;
export {};
//# sourceMappingURL=pulseCheckRecording.d.ts.map