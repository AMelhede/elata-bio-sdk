/**
 * HD (1280x720, analysed at full size) on every device, with a way back: if the camera and library cannot keep up, the
 * app drops to 640x480 for the rest of the page load. On recorded laptop sessions HD doubled the seconds with a number;
 * on one phone an HD run analysed a handful of frames and then the library refused every sample, a failure a desktop
 * browser slowed fourfold did not reproduce. So the rule is judged on what the device does, not on what it is.
 */
/** Frames a second the check needs: it resamples to 20 a second (OWN_PULSE_FS); under 8 it starves. */
export declare const HD_MIN_FPS = 8;
/** How long HD gets to show its frame rate: a camera starting settles its exposure in about 2 s; 8 s clears that. */
export declare const HD_GRACE_MS = 8000;
/** HD asks for at most this frame rate: the check uses 20 a second, so more only adds work (the phone gave 60). */
export declare const HD_MAX_FPS = 30;
export type HdFallback = "slow" | "backend_error";
export interface HdWatchInput {
    /** HD chosen by the page itself (no `?hd=` in the address), so it may also give it up. */
    readonly auto: boolean;
    /** HD is on for the running camera. */
    readonly on: boolean;
    /** Since this session started (ms). */
    readonly elapsedMs: number;
    /** Frames the library has analysed in this session. */
    readonly framesSeen: number;
    /** The library's latest error message, if any. */
    readonly errorMessage?: string | null;
}
/** Why HD should be given up now, or null. */
export declare function hdFallback(s: HdWatchInput): HdFallback | null;
//# sourceMappingURL=hdWatch.d.ts.map