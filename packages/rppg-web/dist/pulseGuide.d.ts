import type { PulseCheckCause } from "./pulseCheck.js";
/** Rec.709 luma of an RGB pixel, 0..1 (channel inputs 0..255). */
export declare function lumaOf(r: number, g: number, b: number): number;
/** Face brightness a camera aims for (a face is darker than the frame mean); under it, more screen light helps. */
export declare const LUMA_TARGET = 0.38;
/** The lowest face brightness at which a pulse was seen to track in a graded light sweep; under it, light first. */
export declare const LUMA_FLOOR = 0.23;
/** How much brighter the room must read than the face before "turn to face the light" is the advice. */
export declare const BACKLIT_MIN_GAP = 0.05;
/** Centre weighting for metering a frame with no face box. */
export declare function centerWeight(u: number, v: number): number;
/** Where a centred face sits in the picture: the middle 30% of the width and 50% of the height. */
export declare const FACE_BOX: {
    readonly x0: 0.35;
    readonly x1: 0.65;
    readonly y0: 0.25;
    readonly y1: 0.75;
};
/** Face, centre-weighted and whole-frame brightness of a small square frame (RGBA bytes), or null without pixels. */
export declare function meter(data: ArrayLike<number>, size: number): {
    face: number;
    centre: number;
    room: number;
} | null;
/** One instruction per state. */
export type Advice = "no_camera" | "no_face" | "backlit" | "night_light" | "more_light" | "brighter_screen" | "flicker" | "moving" | "still" | "almost";
/** The words for each instruction: what to do, in a few plain words. */
export declare const ADVICE_TEXT: Record<Advice, string>;
/** True when the instruction asks the person to do something; only these are shown (progress is carried by the display). */
export declare function needsYou(a: Advice): boolean;
/** True when the advice asks the person to change something before a pulse can be read. */
export declare function isBlocking(a: Advice): boolean;
/** What one moment of guidance is decided from. */
export interface CoachInput {
    readonly light: {
        face: number;
        centre: number;
        room: number;
    } | null;
    readonly faceFound: boolean;
    readonly lampOn: boolean;
    readonly hasNumber: boolean;
    readonly searchingMs?: number;
    readonly movement?: number | null;
    /** Head movement over the last MOVE_NOW_WINDOW_MS (movementOf with that window), or null when too few rows. */
    readonly movementNow?: number | null;
    readonly warmth?: number | null;
    readonly blueWarmth?: number | null;
    readonly cause?: GuideCause | null;
    readonly colourDamaged?: boolean;
    readonly starved?: boolean;
    readonly exposureKnown?: boolean;
    /** Red clipped on LIGHT_CLIP_MAX or more of the face (lightLevel.ts faceRedClip): more light can only make it worse. */
    readonly burnt?: boolean;
}
/** A camera starved of light: its exposure (Chrome exposureTime, 100 microsecond units) is a frame long at 30 fps or more. */
export declare const EXPOSURE_STARVED = 333;
export declare const cameraStarved: (exposureTime: number | null | undefined) => boolean;
/** The check's own first blocking cause (pulseCheckCause), or headMotion from an app's own movement check. */
export type GuideCause = PulseCheckCause | "headMotion";
/** Below this green over red on the face, the light on it is too orange to read a pulse (a warm screen filter or lamp). */
export declare const WARM_MAX = 0.33;
/** Green over red of the check's own face regions over the last WARMTH_WINDOW_MS. */
export declare function warmthOf(events: readonly (readonly unknown[])[]): number | null;
/** Blue over red of the face regions: a warm filter cuts blue more than green, a dark picture does not. */
export declare function blueWarmthOf(events: readonly (readonly unknown[])[]): number | null;
/** Head movement is judged over the last 8 s, as the pulse check asks its newest 8 s to carry the rate. */
export declare const MOVE_WINDOW_MS = 8000;
/** Head movement (median frame-to-frame centre shift over face width) above which "hold still" is the fix. */
export declare const MOVE_MAX = 0.07;
/**
 * Whether the head is still moving now: the last 2 s (movementOf with MOVE_NOW_WINDOW_MS). "Hold still" shows only while
 * this is over MOVE_STILL_MAX and clears the moment it is not: the 8 s spread keeps a stopped move for up to 8 s, and the
 * line stayed up while the person held still (a phone recording, 2026-11-01). 0.02 is where still heads end: over 2 s,
 * 99 in 100 seconds of heads still over 8 s (8 s spread under 0.02) read under 0.021 on laptops, phones and a Mac
 * alike (test-page recordings, 4,448 seconds).
 */
export declare const MOVE_NOW_WINDOW_MS = 2000;
export declare const MOVE_STILL_MAX = 0.02;
/** Head movement over `windowMs` (MOVE_WINDOW_MS unless given) from head rows, or null when there are too few to judge. */
export declare function movementOf(rows: readonly {
    t_ms: number;
    x: number;
    y: number;
    w: number;
}[], endMs: number, windowMs?: number): number | null;
/**
 * How long a face may be in view with no number before the stall line replaces silence: 30 s. On every received
 * test-page recording replayed on test.57, a first number came within 26 s on 9 in 10 phone readings, while 35% of
 * computer readings ran past 30 s, 16 of those 19 with a fixable cause (head movement, a dim room, a warm filter), so the
 * fix belongs at 30 s, not at the 42 s an earlier lab-webcam count gave (test.44). An app's "taking longer than usual"
 * line uses the same moment, so the line and its fix appear together.
 */
export declare const STALL_MS = 30000;
/**
 * The one instruction for this moment, in the order a person must fix things: a picture, a face, then light. Never a
 * light instruction on a burnt-out face: a laptop webcam on 2026-11-01 (camera brightness and exposure boost raised
 * outside the page) had red clipped on 71 to 84% of the face in 7 of 8 sessions, and "Add some light in front of you"
 * showed for 91 of 128 s in one of them, in place of "Hold still" while the head moved 24% of the time.
 */
export declare function adviceFor(s: CoachInput): Advice;
/** A new instruction shows once it has held this long, but "hold still", which follows the head at once; a number on screen clears it. */
export declare const ADVICE_HOLD_MS = 4000;
export interface Shown {
    readonly advice: Advice;
    readonly pending: Advice | null;
    readonly since: number;
}
/** The instruction shown after the hold, given the raw one and whether a number is on screen. */
export declare function shownAfter(prev: Shown, raw: Advice, now: number, numberOnScreen: boolean): Shown;
/**
 * The instruction an app shows, one call per read: the advice for this moment, held by shownAfter, and its text only
 * when the person must do something and no number is on screen. As PulseDisplay decides the number, this decides the line.
 */
export declare class PulseGuide {
    private shown;
    next(nowMs: number, input: Omit<CoachInput, "hasNumber">, numberOnScreen: boolean): {
        raw: Advice;
        advice: Advice;
        text: string | null;
    };
    reset(): void;
}
//# sourceMappingURL=pulseGuide.d.ts.map