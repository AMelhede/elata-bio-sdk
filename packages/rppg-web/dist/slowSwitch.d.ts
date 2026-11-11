/**
 * Session option slowSwitch (off unless set): a device too slow to analyse enough of its frames moves, once and for the
 * rest of the session, to the face finder in its Web Worker (session option faceFinderWorker, faceFinderWorker.ts) and
 * the check's tracker on the face patches (SLOW_SWITCH_RULES). The slowed bench analysed 6.9 frames a second with the
 * finder on the page's thread and 11.8 with it in the worker; the tracker reads evidence over time, which a slow frame
 * rate starves the streak rules of.
 *
 * The trigger is the measured rate, never a device name, so it acts the same on every camera and device: the frames
 * that reached pulse analysis in each whole second, counted only while the face is tracked in every frame of that
 * second and the page is visible, never in the first SLOW_SWITCH_WARMUP_MS after the first analysed frame. Under
 * SLOW_SWITCH_FPS in each of SLOW_SWITCH_SECONDS consecutive such seconds, it switches. A second with no frame at all,
 * a lost face or a hidden page breaks the run. There is no way back within the session.
 *
 * The app keeps the outcome per camera (as the testbed keeps "HD too heavy") and passes `{ remembered: true }` at the
 * next start, which then starts switched. What it did is in `record()`, in the field names a saved file uses.
 */
/** Analysed frames a second under which a second counts as slow. */
export declare const SLOW_SWITCH_FPS = 9;
/** Slow seconds in a row that switch. */
export declare const SLOW_SWITCH_SECONDS = 5;
/** After the first analysed frame, how long no second is counted (the camera and the finder settle). */
export declare const SLOW_SWITCH_WARMUP_MS = 3000;
/** The analysed rate after the switch is the mean over this many whole seconds after it (record fps_after_10s). */
export declare const SLOW_SWITCH_AFTER_S = 10;
/** The check's rules a switched session runs: the tracker on the face patches, the tested slow-device setting. */
export declare const SLOW_SWITCH_RULES: Readonly<{
    readonly tracker: true;
    readonly allPatches: true;
}>;
/** What the switch did this session, null fields where nothing was measured. Times are from the first analysed frame. */
export type SlowSwitchRecord = {
    /** When it switched, in s (0 when it started switched from memory). */
    at_s: number;
    /** Mean analysed frames a second over the slow seconds that switched it; null when it started switched. */
    fps_before: number | null;
    /** Mean analysed frames a second over the counted seconds of the SLOW_SWITCH_AFTER_S after it; null until known. */
    fps_after_10s: number | null;
    /** It started switched because the app remembered this camera as slow. */
    remembered: boolean;
};
export declare class SlowSwitch {
    private readonly remembered;
    private readonly visible;
    /** The first analysed frame's time, the zero of every second. */
    private t0;
    private sec;
    private count;
    /** The current second still counts: every frame in it tracked and visible. */
    private counted;
    private run;
    private atSec;
    private rec;
    private after;
    /** Called once when the measured rate switches it (not when it starts switched). */
    onSwitch: ((record: SlowSwitchRecord) => void) | null;
    constructor(opts?: {
        remembered?: boolean;
        visible?: () => boolean;
    });
    /** Switched, by the measured rate or from memory. */
    get switched(): boolean;
    /** A copy of what it did, or null while it has not switched. */
    record(): SlowSwitchRecord | null;
    /**
     * One frame on the frames' clock: `tracked` when it reached pulse analysis (the face's regions went to the check),
     * false for a frame with no face. Returns true for the frame that switches it.
     */
    frame(tMs: number, tracked: boolean): boolean;
    /** The second `this.sec` is over: a frame of second `next` arrived at `tMs`. Empty seconds between break the run. */
    private close;
}
//# sourceMappingURL=slowSwitch.d.ts.map