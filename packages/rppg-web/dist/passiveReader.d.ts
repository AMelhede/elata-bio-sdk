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
import { type RawRoiSample } from "./pulseCheckCore.js";
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
export declare const PASSIVE_WINDOW_S = 48;
export declare const PASSIVE_EVERY_S = 5;
export declare const PASSIVE_MIN_SNR_DB = -6;
export declare const PASSIVE_HALF_AGREE_BPM = 3;
export declare const PASSIVE_RECENT_S = 16;
export declare const PASSIVE_RECENT_AGREE_BPM = 3;
export declare const PASSIVE_RESET_GAP_MS: number;
export declare const PASSIVE_DEFAULTS: ResolvedPassiveOptions;
export declare function resolvePassiveOptions(options: boolean | PassiveOptions | undefined): ResolvedPassiveOptions | null;
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
/**
 * The reader. Pure: push the rows the live check keeps (RawRoiSample, rawRoiSampleOf), in time order; it
 * reads a window at each `everyS` mark once a frame past the mark arrives, so a window holds exactly the
 * frames up to its mark. The marks run from the first frame pushed (or the first after reset()).
 */
export declare class PassiveReader {
    readonly options: ResolvedPassiveOptions;
    private samples;
    private nextTickMs;
    private newestMs;
    private last;
    constructor(options?: PassiveOptions);
    /**
     * One frame's row. Returns the reading this frame completed, or null. With `show` false the frame still fills the
     * window but a reading it completes is dropped, never kept as the newest (a caller's liveness gate is shut).
     */
    push(sample: RawRoiSample, show?: boolean): PassiveReading | null;
    /** The newest reading, with its age against the newest frame pushed; null before the first. */
    reading(): PassiveReading | null;
    /** Forget every frame and reading; the next frame pushed starts the marks again. */
    reset(): void;
    /** The older half is the half-window read at the mark at least half a window back: a mark already read. */
    private olderHalfAgoMs;
    /** How far back a reading looks: the older half's start. */
    private spanMs;
    private line;
    /** The window ending at `atMs`, if it passes every gate. Cheapest refusal first. */
    private readAt;
}
type Rgb = {
    r: number;
    g: number;
    b: number;
};
/**
 * The row the live check keeps for one frame (PulseCheck.push): the three regions, then the wall on one
 * continuous scale and the wall as the camera read it (NaN when no wall was seen). Null when the frame
 * has no three regions or no finite time, the frames the check ignores.
 */
export declare function rawRoiSampleOf(timestampMs: number, regions: readonly Rgb[], wall?: Rgb, wallRaw?: Rgb): RawRoiSample | null;
/** What feedPassiveReader needs of a pulse check: its push, called with the check's own arguments. */
export interface PassiveFeedable {
    /** The check's rule blinkGate is satisfied (PulseCheck.blinkGateOpen); false withholds passive readings too. */
    readonly blinkGateOpen?: boolean;
    push(timestampMs: number, regions: readonly Rgb[], wall?: Rgb, wallMiss?: unknown, head?: unknown, wallRaw?: Rgb, ...rest: unknown[]): void;
}
/**
 * Hand the reader every frame the check is handed: the check's push runs first, unchanged and with the
 * same arguments, then the same row goes to the reader. The check's own state and outputs are untouched. While the
 * check's blink gate is shut no passive reading is made either: a photo does not blink, and on recorded sessions
 * people blinked before the first passive window was full, so the gate withheld no reading of a real face.
 */
export declare function feedPassiveReader(check: PassiveFeedable, reader: PassiveReader, onReading?: (reading: PassiveReading) => void): void;
/**
 * The reader a session runs (its `passive` option), fed from the session's pulse check: none when the option
 * is off or there is no check (`pulseCheck: false`), since only the check is handed the face regions.
 */
export declare function passiveReaderFor(options: {
    passive?: boolean | PassiveOptions;
    onPassiveReading?: (reading: PassiveReading) => void;
}, check: PassiveFeedable | null): PassiveReader | null;
export {};
//# sourceMappingURL=passiveReader.d.ts.map