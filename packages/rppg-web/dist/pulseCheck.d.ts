/**
 * Real-pulse check (`createRppgSession({ pulseCheck })`, ON by default in this test build;
 * `pulseCheck: false` turns it off).
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
 * Wall check (used when the frames carry face landmarks): a heartbeat is only in skin, a light
 * that pulses changes the wall as well. If the wall's brightness pulses at the proven rate, far
 * above its noise, in each of the last 4 one-second windows, the rate is withheld. Only wall
 * pixels that do not look like skin are used: a face edge or an ear in the patch carries the
 * person's own pulse.
 */
import { type Frame } from "./frameSource.js";
import { type RawRoiSample } from "./pulseCheckCore.js";
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
    /** The head's own movement carried the rate in each of the last OWN_PULSE_STRONG_STREAK windows (rule headMotion). */
    headMatch?: boolean;
    /** Diagnostic: the wall's strongest brightness line in this window (wallLine), or null. */
    wallLine?: {
        bpm: number;
        snrDb: number;
    } | null;
    /**
     * Frames in the last one-second step: with the wall seen, and without it because the face
     * left no room beside it or because every patch beside it looked like skin (wallMissReason).
     */
    wallFrames?: {
        seen: number;
        noRoom: number;
        skin: number;
    };
    /** True while the face's own rhythm at the proven rate is brightness, not colour (FACE_FLICKER_RATIO). */
    faceFlicker?: boolean;
    /** How the shown rate was reached: the check's own streak, or agreement with the SDK's rate (agreementRate). */
    via?: "check" | "agreement" | null;
};
/**
 * Flicker on the face itself, for when no wall can be seen. A heartbeat changes the skin's
 * COLOUR (green dips most); a lamp changes its BRIGHTNESS, scaling red, green and blue alike.
 * So at the proven rate, each region's relative colour is split into brightness (the part
 * common to all three channels) and colour (the rest), and the pooled brightness / colour
 * amplitude ratio is judged. A blood-volume pulse keeps it near 3 (de Haan & van Leest 2014,
 * the PBV signature), as in the achromatic lighting test of Elata's perception lab. Withheld when the ratio exceeds this in each of the last
 * OWN_PULSE_STRONG_STREAK one-second windows, judged at once like the wall check.
 *
 * Value chosen by measurement on recorded captures against a reference pulse.
 */
export declare const FACE_FLICKER_RATIO = 10;
/**
 * Following a proven rate. The windows that prove a rate span 16 s, so while the heart rate
 * moves the proven rate trails it. Once proven, the shown rate is the line in the newest 12 s
 * if it is within 4 bpm of the proven rate.
 *
 * Value chosen by measurement on recorded captures against a reference pulse.
 */
export declare const OWN_PULSE_TRACK_S = 12;
/**
 * A number on screen must be backed by fresh evidence. The proven rate is an average over 8+ windows
 * of 16 s, so it describes the last ~20 s; when the heart rate moves fast (after exercise, 72 -> 90 in
 * 10 s) the pulse drops out of every short window while the 16 s window, mostly old data, still reports
 * the old rate. So the rate shown follows the newest OWN_PULSE_SUPPORT_S seconds (replacing the 12 s
 * OWN_PULSE_TRACK_S window), and after OWN_PULSE_SUPPORT_MISS evaluations without it nothing is shown.
 *
 * Value chosen by measurement on recorded captures against a reference pulse.
 */
export declare const OWN_PULSE_SUPPORT_S = 8;
export declare const OWN_PULSE_SUPPORT_MISS = 3;
export declare const OWN_PULSE_TRACK_BPM = 4;
/** Brightness / colour amplitude ratio of the face regions within 0.1 Hz of `bpm`. */
export declare function faceFlickerRatio(samples: readonly RawRoiSample[], atMs: number, bpm: number): number | null;
/** Why no wall was found beside the face this frame (see wallBesideFace). */
export type WallMiss = "no-room" | "skin";
type Rgb = {
    r: number;
    g: number;
    b: number;
};
/**
 * The pulse check's light rules, each behind its own switch so each can be tested alone (on unless
 * set to false). A switch turned off restores the behaviour from before that rule, nothing more.
 */
export type PulseCheckRules = {
    /** The wall's line is searched past the band's edge (a light folded to 180 a minute). Off: the strongest in-band local maximum, as in 0.15.0-test.2. */
    wallBandEdge?: boolean;
    /** A light's whole and half multiples are the light's too (LIGHT_FAMILY). Off: only the light's own rate. */
    lightFamily?: boolean;
    /** A rate the face flickers at in brightness far more than in colour is withheld (faceFlickerRatio). */
    faceFlicker?: boolean;
    /** A window whose rate the wall carries is not evidence of a pulse: it is not counted toward the proof. Off: it counts, and the rate shows the moment the wall line dips. */
    lightTaint?: boolean;
    /** A rate the head's own movement keeps time with (a nod, a rock) is the movement's: not evidence, and withheld once it holds for 4 windows. Needs the head position (`push`'s `head`); off or without it: movement is not checked. */
    headMotion?: boolean;
};
export type ResolvedPulseCheckRules = Required<PulseCheckRules>;
export declare const PULSE_CHECK_RULE_NAMES: readonly ["wallBandEdge", "lightFamily", "faceFlicker", "lightTaint", "headMotion"];
/** Every rule resolved to true or false; left out means on. */
export declare function resolvePulseCheckRules(rules?: PulseCheckRules | null): ResolvedPulseCheckRules;
/**
 * Face-mesh landmarks on bone, not on skin that moves with expression: nose bridge and tip, forehead,
 * chin, outer eye corners, cheekbones (MediaPipe face mesh indices).
 */
export declare const HEAD_LANDMARKS: readonly number[];
/** The head's position this frame: the centre of HEAD_LANDMARKS in pixels, or null if the mesh lacks one. */
export declare function headCentre(points: readonly {
    x: number;
    y: number;
}[], width: number, height: number): {
    x: number;
    y: number;
} | null;
/** The head's movement lines (x and y) in the window ending at `atMs`, found like the wall's line. */
export declare function headLines(head: readonly [number, number, number][], atMs: number): Array<{
    bpm: number;
    snrDb: number;
}> | null;
/** Whether the head's movement carries `bpm`: a movement line at the rate, HEAD_MIN_SNR_DB above the rest. */
export declare function headCarries(head: readonly [number, number, number][], atMs: number, bpm: number): boolean;
/**
 * Whether the head's movement carried `bpm` in each of the last OWN_PULSE_STRONG_STREAK one-second
 * windows ending at `atMs` (headCarries in each): rule headMotion's withhold, the state's headMatch.
 * Judged over the windows at once, like the wall check, so one window's coincidence withholds nothing.
 */
export declare function headMatches(head: readonly [number, number, number][], atMs: number, bpm: number): boolean;
export declare function wallLine(wall: [number, number, number, number][], atMs: number, bandEdge?: boolean): {
    bpm: number;
    snrDb: number;
} | null;
/**
 * Whether the wall carries `bpm` the way a light would: the strongest line (band floor up) of its
 * BRIGHTNESS (R + G + B), within OWN_PULSE_AGREE_BPM of the rate or of a LIGHT_FAMILY multiple of it,
 * and WALL_MIN_SNR_DB above its
 * noise. Brightness, not colour: a lamp scales a grey wall's R, G and B alike, which is exactly
 * the change the colour method cancels; and a heartbeat never changes a wall's brightness.
 */
export declare function wallCarries(wall: [number, number, number, number][], atMs: number, bpm: number, rules?: ResolvedPulseCheckRules): boolean;
export declare class PulseCheck {
    constructor(opts?: {
        agreement?: boolean;
        rules?: PulseCheckRules;
    });
    /** Which light rules this check runs (see PulseCheckRules). */
    readonly rules: ResolvedPulseCheckRules;
    /** Whether the opt-in agreement path is on (the runner reads the SDK's rate only then). */
    get agreementOn(): boolean;
    /** The SDK's own current rate, given once a second; used only with `agreement` on. */
    secondOpinion(bpm: number | null): void;
    private samples;
    private wall;
    private head;
    private history;
    private held;
    /** Opt-in: also show the SDK's rate when it agrees with this check's window rate (agreementRate). */
    private readonly agreement;
    private second;
    private seconds;
    private lastEvalMs;
    private lostSinceMs;
    private wallTally;
    private state;
    /**
     * One frame: mean RGB of forehead, left cheek and right cheek, at the frame's timestamp,
     * and optionally the mean RGB of a patch of wall beside the face (see the wall check).
     */
    push(timestampMs: number, regions: readonly Rgb[], wall?: Rgb, wallMiss?: WallMiss, 
    /** The head's position this frame in pixels (headCentre), for the headMotion rule. */
    head?: {
        x: number;
        y: number;
    } | null): void;
    /** Consecutive evaluations in which the newest OWN_PULSE_SUPPORT_S seconds did not carry the proven rate. */
    private unsupported;
    /**
     * The rate to show once one is proven: the line in the newest OWN_PULSE_SUPPORT_S seconds when it sits
     * within OWN_PULSE_TRACK_BPM of the proven rate, else the proven rate, and nothing once the newest
     * window has not carried it for OWN_PULSE_SUPPORT_MISS evaluations in a row. The proof itself
     * (this.held, the verdict, the hold) is unchanged.
     */
    private shownRate;
    /** A frame in which no face (no forehead and cheeks) was found. */
    faceLost(timestampMs: number): void;
    getState(): PulseCheckState;
    reset(): void;
}
/**
 * How far the wall patch sits from the face's points, as a share of the face's width, tried in
 * this order. 0.15 clears hair on a face seen from the front. A side camera sees a turned head,
 * whose cheek, ear and neck reach well past the points, so the farther distances find wall
 * where the nearest patch is all skin.
 *
 * Value chosen by measurement on recorded captures against a reference pulse.
 */
export declare const WALL_GAPS: readonly [0.15, 0.4, 0.7, 1];
/**
 * The wall beside the face: the first of WALL_GAPS whose patch is mostly not skin, starting from
 * `preferIndex` (the distance that worked last frame), so the wall stays one patch while it can
 * and its brightness does not step between patches. Null when every distance shows skin.
 */
export declare function wallBesideFace(points: readonly {
    x: number;
    y: number;
}[], frame: Frame, preferIndex: number): {
    rgb: Rgb;
    gapIndex: number;
} | null;
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
export declare class WallTracker {
    private gapIndex;
    private current;
    private gain;
    private last;
    /** The wall this frame on one continuous scale, or null when none was found. */
    next(points: readonly {
        x: number;
        y: number;
    }[], frame: Frame): {
        rgb: Rgb;
        gapIndex: number;
    } | null;
    /** `rgb` from patch `gapIndex`, rescaled at a change of patch so the signal does not step. */
    continuous(gapIndex: number, rgb: Rgb): Rgb;
}
/**
 * Why wallBesideFace found nothing: "no-room" when no distance leaves a patch inside the frame
 * (the face fills it), otherwise "skin" (every patch looked like skin: an ear or neck, or a
 * beige or wooden wall, or warm light making the wall skin-coloured).
 */
export declare function wallMissReason(points: readonly {
    x: number;
    y: number;
}[], width: number, height: number): WallMiss;
/**
 * A patch of wall beside the face for the wall check, in pixels, or null when there is no
 * room for one (a face that fills the frame). At cheek height (the middle third of the face),
 * a quarter of the face wide, `gap` of the face's width clear of its edge (WALL_GAPS), on
 * whichever side has more room. The face's edges are taken at the 5th and 95th percentile of
 * the points across and the 3rd and 97th down, so a single stray point cannot move the patch.
 */
export declare function wallPatchFromLandmarks(points: readonly {
    x: number;
    y: number;
}[], width: number, height: number, gap?: number): {
    x: number;
    y: number;
    w: number;
    h: number;
} | null;
export {};
//# sourceMappingURL=pulseCheck.d.ts.map