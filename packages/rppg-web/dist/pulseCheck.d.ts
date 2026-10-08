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
    /**
     * That window's wall level as the camera saw it (R + G + B of the patch or patches read, each on
     * 0..1, before WallTracker's rescaling), which rule darkWall judges; null when the wall was not
     * seen throughout.
     */
    windowWallLevel?: number | null;
    /** The head's own movement carried the rate in each of the last OWN_PULSE_STRONG_STREAK windows (rule headMotion). */
    headMatch?: boolean;
    /**
     * How rule headMotion judged the latest window at its rate (headJudge): 'blind' when the head's
     * rows do not cover it, which counts as no evidence. Null when the rule is off, the window has no
     * rate, or no head has been handed to the check since it was last reset.
     */
    windowHead?: HeadJudgement | null;
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
    /**
     * A rate the head's own movement keeps time with (a nod, a rock) is the movement's: not evidence,
     * and withheld once it holds for 4 windows. Needs the head (`push`'s `head`, headCentre); once a
     * head has been handed over, a window the head's rows do not cover is not evidence either. Off,
     * or with `head` always left out: movement is not checked.
     */
    headMotion?: boolean;
    /**
     * Damaged colour is read as green minus the wall only over a wall bright enough to show the
     * room's light (OWN_PULSE_SWAP_MIN_WALL), judged on the wall as the camera reads it (push's
     * `wallRaw`); over a darker wall it is read by colour (POS), so a light on the face that the
     * wall does not show is not read as the pulse. Off: green minus the wall over any wall seen,
     * as in 0.15.0-test.6.
     */
    darkWall?: boolean;
};
export type ResolvedPulseCheckRules = Required<PulseCheckRules>;
export declare const PULSE_CHECK_RULE_NAMES: readonly ["wallBandEdge", "lightFamily", "faceFlicker", "lightTaint", "headMotion", "darkWall"];
/** Every rule resolved to true or false; left out means on. */
export declare function resolvePulseCheckRules(rules?: PulseCheckRules | null): ResolvedPulseCheckRules;
/**
 * Face-mesh landmarks on bone, not on skin that moves with expression: nose bridge and tip, forehead,
 * chin, outer eye corners, cheekbones (MediaPipe face mesh indices).
 */
export declare const HEAD_LANDMARKS: readonly number[];
/** The head this frame, as the headMotion rule reads it (headCentre). */
export type HeadPosition = {
    /** The centre of HEAD_LANDMARKS, in pixels. */
    x: number;
    y: number;
    /** The face's width in pixels, cheekbone to cheekbone: a movement is judged by its size against it. */
    faceWidth: number;
};
/**
 * The head's position this frame: the centre of HEAD_LANDMARKS in pixels, and the face's width
 * (cheekbone to cheekbone, in pixels), or null if the mesh lacks a landmark or the frame has no size.
 */
export declare function headCentre(points: readonly {
    x: number;
    y: number;
}[], width: number, height: number): HeadPosition | null;
/** One frame of the head as the check keeps it: [time ms, x, y, face width], pixels (headCentre). */
export type HeadRow = [number, number, number, number];
/**
 * How far the head's movement AT THE RATE must stand above the rest of its movement (dB), with the
 * strongest other rhythm taken out of the rest, for the rate to count as the movement's. Set
 * together with HEAD_MIN_SIZE, between still heads with a pulse and generated faces with no pulse
 * nodding, with and without a second sway. The 5 dB it replaced was set on the statistic before
 * (the strongest line against every other rhythm, which a second sway could hide a nod under).
 * Pinned in pulseCheckHead.test.ts.
 *
 * Value chosen by measurement on recorded captures against a reference pulse.
 */
export declare const HEAD_MIN_SNR_DB = 3.9;
/**
 * The smallest movement at the rate that can be a nod: the line's amplitude over the face's width.
 * A heartbeat shakes the head too, and in a still person that shake can be the head's strongest
 * rhythm, but it is tiny next to a nod. A clean 3 px nod on a 190 px face is 1.6% of its width.
 *
 * Value chosen by measurement on recorded captures against a reference pulse.
 */
export declare const HEAD_MIN_SIZE = 0.003;
/** Why a window's head movement cannot be judged (headAtRate). */
export type HeadBlind = "rows" | "start" | "end" | "gap" | "rate";
/** The head's movement at a rate on one axis (headAtRate). */
export type HeadAtRate = {
    /** The movement at the rate (its line and second harmonic) over the rest, the strongest other rhythm left out (dB). */
    snrDb: number;
    /** The line's amplitude over the face's width. */
    size: number;
};
/**
 * The head's movement at `bpm` in the 16 s window ending at `atMs`, one entry per axis that has a
 * line there (side to side, then up and down), or why the window cannot be judged ('blind'): fewer
 * than HEAD_MIN_ROWS rows, rows starting or ending more than 1 s from the window's edges, a gap over
 * 1 s, or fewer than HEAD_MIN_ROWS_PER_CYCLE rows per cycle of the rate. Judged at the rate claimed,
 * on a fixed grid (bins of 0.0625 Hz whatever span the rows have).
 */
export declare function headAtRate(head: readonly HeadRow[], atMs: number, bpm: number): {
    axes: HeadAtRate[];
} | {
    blind: HeadBlind;
};
/** Whether the head's movement carries a rate in a window ('carried'), does not ('clear'), or cannot be judged ('blind'). */
export type HeadJudgement = "carried" | "clear" | "blind";
/**
 * Whether the head's movement carries `bpm` in the window ending at `atMs`: on either axis, both
 * HEAD_MIN_SNR_DB above the rest of its movement and HEAD_MIN_SIZE of the face's width. A window the
 * head's rows do not cover is 'blind', never 'clear'.
 */
export declare function headJudge(head: readonly HeadRow[], atMs: number, bpm: number): HeadJudgement;
/** Whether the head's movement carries `bpm` in the window ending at `atMs` (headJudge is 'carried'). */
export declare function headCarries(head: readonly HeadRow[], atMs: number, bpm: number): boolean;
/**
 * Whether the head's movement carried `bpm` in each of the last OWN_PULSE_STRONG_STREAK one-second
 * windows ending at `atMs` (headCarries in each): rule headMotion's withhold, the state's headMatch.
 * Judged over the windows at once, like the wall check, so one window's coincidence withholds nothing.
 */
export declare function headMatches(head: readonly HeadRow[], atMs: number, bpm: number): boolean;
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
    /** The least wall level for green minus the wall: the bar with rule darkWall on, any wall seen with it off. */
    private get swapMinWall();
    /** Whether the opt-in agreement path is on (the runner reads the SDK's rate only then). */
    get agreementOn(): boolean;
    /** The SDK's own current rate, given once a second; used only with `agreement` on. */
    secondOpinion(bpm: number | null): void;
    private samples;
    private wall;
    private head;
    /** A head argument (a position or null) has reached push since the last reset: the movement is judged. */
    private headHandedOver;
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
     * and optionally the mean RGB of a patch of wall beside the face (see the wall check), on one
     * continuous scale across patches (WallTracker).
     */
    push(timestampMs: number, regions: readonly Rgb[], wall?: Rgb, wallMiss?: WallMiss, 
    /**
     * The head this frame (headCentre), for the headMotion rule; null when the face mesh found no
     * head this frame (a window it leaves uncovered is then not evidence). Leave it out on every
     * frame when the frames carry no face mesh: the movement is then not checked.
     */
    head?: HeadPosition | null, 
    /**
     * The same wall as the camera read it this frame, before WallTracker's rescaling (its `raw`):
     * rule darkWall judges the wall's brightness on it. Leave it out when `wall` is read from one
     * patch and never rescaled; `wall` is then taken as read.
     */
    wallRaw?: Rgb): void;
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
 * shared by every patch, passes through unchanged. The wall's rhythm checks are blind to its
 * absolute level (the wall check judges a signal-to-noise ratio, green minus the wall a least-
 * squares share of normalised signals), so the rescaled wall serves them. Its brightness is not
 * kept: after a switch the carried-on level is the old patch's, not what the camera sees, so the
 * tracker also hands back each patch as read (`raw`), which rule darkWall judges.
 */
export declare class WallTracker {
    private gapIndex;
    private current;
    private gain;
    private last;
    /** The wall this frame on one continuous scale, and as read (see track), or null when none was found. */
    next(points: readonly {
        x: number;
        y: number;
    }[], frame: Frame): {
        rgb: Rgb;
        raw: Rgb;
        gapIndex: number;
    } | null;
    /**
     * Patch `gapIndex` read as `rgb`: `rgb` on one continuous scale (continuous), for the wall's
     * rhythm, and `raw`, the patch as read, for its brightness. PulseCheck.push takes both.
     */
    track(gapIndex: number, rgb: Rgb): {
        rgb: Rgb;
        raw: Rgb;
        gapIndex: number;
    };
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