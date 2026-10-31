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
import type { FacePatches } from "./facePatches.js";
import { type Frame } from "./frameSource.js";
export type PulseCheckState = {
    /** "measured" while a pulse is proven; otherwise "not-measured" or "unknown". */
    verdict: "measured" | "not-measured" | "unknown";
    /** The proven rate, or null. */
    bpm: number | null;
    snrDb: number | null;
    /** Consecutive windows agreeing on the current rate. */
    streak: number;
    /**
     * The run of windows the early number counts (countingStreak): under rule clearWindows only the clear ones, so a
     * progress display driven by `streak` ran ahead of the number. Compare with streakNeeded.
     */
    countingStreak?: number;
    /** True while the wall beside the face carries the proven rate, so the rate is withheld. */
    wallMatch: boolean;
    /** Rule roomLight: true while the room (roomFromFrame) carries the proven rate, so it is withheld. */
    roomMatch?: boolean;
    /** The room's strongest brightness line in the latest window (as wallLine), when the room was handed over. */
    roomLine?: {
        bpm: number;
        snrDb: number;
    } | null;
    /**
     * The latest one-second window as it is, proven or not: its rate and how far its line
     * stands above the noise. For diagnosis only; nothing decides on these two.
     */
    windowBpm?: number | null;
    windowSnrDb?: number | null;
    /** True until a full window (OWN_PULSE_WINDOW_S) has come in since the check started or last reset. */
    collecting?: boolean;
    /** How full that first window is, 0 to 1 (pulseProgress reads it). */
    windowFill?: number;
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
    /** That window's wall against the face (OwnPulseEstimate.wallToFace), which rule darkWall judges; null when the wall was not seen throughout. */
    windowWallToFace?: number | null;
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
    /** How the shown rate was reached: the check's own streak, or null. */
    via?: "check" | null;
    /**
     * Rule moreReadings: while no proven rate is shown, the current streak's mean fine rate when the streak is at least
     * OWN_PULSE_STRONG_STREAK windows long at a mean SNR of at least OWN_PULSE_MIN_SNR_DB; else null.
     */
    buildingBpm?: number | null;
    /** Rule followRecent: a window rate close to a number shown moments ago, shown while nothing else is; else null. */
    followBpm?: number | null;
    /** Rule blinkGate: true while a rate would show but no blink has been seen since the face appeared. */
    waitingForBlink?: boolean;
    /** Rule moreReadings: true while a rate proven in the last RELOCK_MS can be returned to (re-lock is open). */
    relockOpen?: boolean;
    /**
     * The newest OWN_PULSE_SUPPORT_S line while a rate is proven and that line sits within OWN_PULSE_TRACK_BPM of
     * it (the value the shown rate follows), else null. For diagnosis.
     */
    followerBpm?: number | null;
    /** For diagnosis: the rate the check holds as proven (before the follower), or null. */
    heldBpm?: number | null;
    /** For diagnosis: equal light steps (equalLightStep) in the latest window, counted with rule screenLight on, else null. */
    windowScreenSteps?: number | null;
    /** True while rule screenLight holds the latest window's rate out of the evidence (SCREEN_STEPS_PER_WINDOW or more equal steps). */
    screenLight?: boolean;
};
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
    /**
     * A window in which one light steps on all three face regions alike at least SCREEN_STEPS_PER_WINDOW
     * times (equalLightStep: a screen showing video, the wall dark) is not evidence of a pulse: it is not
     * counted toward the proof. It only withholds. Off: such windows count, as before.
     */
    screenLight?: boolean;
    /**
     * The low band, where a line counts only when all three regions carry it, starts at
     * OWN_PULSE_EDGE_BPM (52) instead of OWN_PULSE_LOW_BAND_BPM (58), so a resting rate of 52 to 57
     * seen by two regions counts like any other, if it also reaches OWN_PULSE_REST_BAND_MIN_SNR_DB
     * (-2 dB). Under 52 nothing changes (all three regions and the edge bar). Why: a tester at rest,
     * 58 bpm by a reference, the camera's line at 56 in two regions, was refused for most of 2 minutes.
     * On since 0.15.0-test.32: a pre-registered test on people and no-pulse captures it was not tuned on
     * added no invented and no wrong second; on one tester's resting captures it showed a rate 26 s
     * longer, every second within 5 bpm of a reference. Off: the 58 edge, as in 0.15.0-test.31.
     */
    restBand?: boolean;
    /**
 * OFF unless true, being measured (lane/wallroom): a rate the room carries is withheld, judged on the room
 * (roomFromFrame: the frame's upper corners clear of the face) exactly as the wall check judges the wall
 * beside the face (same window, same line test, same bar), as a taint on the window and over the last
 * windows. Only withholds. Needs the room handed to push (a recording's frame source computes it).
 */
    /**
     * More readings. OFF unless true, being measured (lane/confidence, lane/sessionbar). Two halves, always together
     * (merged from showBuilding and relock, 0.15.0-test.51: the page turned them on together and they were measured
     * together). Building: while no pulse is proven, a streak of at least OWN_PULSE_STRONG_STREAK counting windows
     * (the shortest streak the check ever accepts) whose mean SNR is at least OWN_PULSE_MIN_SNR_DB is shown as
     * `buildingBpm` (the streak's mean fine rate), and `shownPulseBpm` shows it. Re-lock: a streak of at least
     * RELOCK_STREAK counting windows at a mean SNR of at least RELOCK_MIN_SNR_DB (a dB under the proof's), within
     * OWN_PULSE_AGREE_BPM of a rate proven in the last RELOCK_MS,
     * is that rate again (verdict path "relock") instead of a new proof from nothing. Every taint still breaks the
     * streak, and the HRV gate still needs a proven pulse. On real photo steps it shows more numbers than the check
     * without it, so it is not to be turned on without a liveness check.
     */
    moreReadings?: boolean;
    /**
     * OFF unless true, being measured (lane/liveness): no rate at any level (proven, building, re-lock) until the eyes
     * have blinked once since the face appeared (BLINK_RISE), and again after the check resets. A photo does not
     * blink. Per session, not per window, because people at a screen blink about 4 times a minute (Patel 1991). Needs
     * the blink score in `push`'s head (HeadPosition.blink); with no blink scores handed over it withholds every rate.
     * Does not catch a video of a face on a screen, which blinks.
     */
    blinkGate?: boolean;
    /**
     * OFF unless true. Set by the session with its `foreheadPool` switch (the forehead the check is fed is the patch
     * pool, foreheadPool.ts), never on its own: with rule moreReadings, the building number then needs
     * POOL_BUILDING_STREAK agreeing windows instead of OWN_PULSE_STRONG_STREAK. Proof and re-lock are unchanged.
     */
    foreheadPool?: boolean;
    /**
     * OFF unless true, being measured (lane fp52): the line is read from the regions' pulses added in time
     * (coherentSpectrum) instead of their spectra added, and with rule moreReadings the building number needs
     * COHERENT_BUILDING_STREAK agreeing windows. Reads a light that steps the whole face more often too.
     */
    coherentFusion?: boolean;
    /**
     * With rule moreReadings, the building number counts only windows whose line stands CLEAR_MARGIN_DB above its
     * runner-up 15 bpm or more away (pulseCheckCore.ts lineMargin): a window that cannot tell two rates apart is evidence
     * for neither. Proof and re-lock unchanged; without moreReadings nothing changes. Unless false.
     */
    clearWindows?: boolean;
    /**
     * With rule moreReadings the building number needs SHORT_BUILDING_STREAK agreeing windows, fewer than any other
     * rule asks. Proof and re-lock unchanged. Unless false (on by default from 2026-10-30: on every received session
     * with references, off cost phones a quarter of their referenced numbers and both devices seconds with a number,
     * at the same error; evidence repo tools/decide.mjs).
     */
    shortStreak?: boolean;
    /**
     * With rule moreReadings, the building number waits while the light on the face stepped STEADY_LIGHT_MAX_STEPS or
     * more times in its window (`windowScreenSteps`, rule screenLight's count): a screen light switching on, a lamp or
     * an exposure change inside the window reads as a slow pulse, and two agreeing windows are too few to tell. Proof
     * and re-lock unchanged; without moreReadings or screenLight nothing changes. Unless false.
     */
    steadyLight?: boolean;
    /**
     * OFF unless true, being measured (evidence repo tools/follow.mjs). A resting heart changes a few bpm over seconds,
     * so when nothing shows, a window rate within FOLLOW_BPM of a number shown in the last FOLLOW_MS, at a window SNR
     * of at least FOLLOW_MIN_SNR_DB, is shown as `followBpm`: the same heart, not a new proof. It follows only a number
     * the check proved (never a building one, never one it followed), so it cannot walk away from the proof. Every
     * taint, the blink gate and steadyLight still withhold it.
     */
    followRecent?: boolean;
    /**
     * A rate the room carries is withheld: the room is read from the frame's two upper corners clear of the face
     * (roomFromFrame) and judged exactly as the wall beside the face, on its own bar (ROOM_MIN_SNR_DB). On recorded lab
     * sessions under a lamp flickering at a heart-like rate it is the one rule that keeps the lamp's rate off the screen:
     * with it a real pulse under the lamps showed 0 wrong seconds and a no-pulse face 36 made-up seconds, without it 283
     * and 414 (it was deleted for a day on 2026-10-30 and added back on this evidence). Unless false.
     */
    roomLight?: boolean;
};
export type ResolvedPulseCheckRules = Required<PulseCheckRules>;
export declare const PULSE_CHECK_RULE_NAMES: readonly ["screenLight", "restBand", "moreReadings", "blinkGate", "foreheadPool", "coherentFusion", "clearWindows", "shortStreak", "steadyLight", "roomLight", "followRecent"];
/**
 * Rule moreReadings (re-lock): how long a proven rate stays the one a new streak may return to. Measured on recorded webcam sessions
 * (lane/sessionbar): 15, 30 and 60 s gave the same shown seconds and wrong rate, so the middle one; about two of the
 * check's 16 s windows.
 */
export declare const RELOCK_MS = 30000;
/**
 * Rule followRecent: how recent the proven number must be, how close the window's rate, how strong the window. Chosen
 * on the received sessions, one score per typed reference (evidence repo tools/decide.mjs, 2026-10-30), anchored on
 * proven numbers only: 3 bpm added seconds at the same error and share over 10 off; 6 bpm added more again (windows 3 to
 * 6 bpm from a proven number within 30 s read 2 bpm from the reference, tools/notagree.mjs) at the same error, and on
 * the lab finger set and its no-pulse copies moved the share over 10 off and the no-pulse numbers by a few tenths.
 * Anchoring on building numbers too failed the lab. 30 s is RELOCK_MS, -5 dB is BUILDING_MIN_SNR_DB; 6 bpm is
 * OWN_PULSE_AGREE_BPM, the re-lock's own agreement.
 */
export declare const FOLLOW_MS = 30000;
export declare const FOLLOW_BPM = 6;
export declare const FOLLOW_MIN_SNR_DB = -5;
/**
 * Rule followRecent across a break: the page left (the watch app read on the same phone) resets the check, and the first
 * window then refills for 16 s with nothing shown (106 of about 190 open seconds of one recorded phone run, 2026-10-31,
 * five trips of 26 to 28 s). While it refills, once FOLLOW_RESUME_MIN_S of new data are in, the estimate over the data
 * so far is the same heart when it lands within FOLLOW_BPM of the number proven before the break, that number at most
 * FOLLOW_RESUME_MS old (a 26 to 28 s trip plus the data), at FOLLOW_MIN_SNR_DB with at least FOLLOW_RESUME_REGIONS
 * regions agreeing, and the blink gate open again. Recorded sessions: that phone run 62 to 105 seconds with a number,
 * laptop 48.5 to 49.5 and phone 46.4 to 48.0 per 100 over all files, every reference unchanged; each added second sat a
 * median 1.2 bpm (max 6.5) from the full check's next number; lab unchanged (no breaks).
 */
export declare const FOLLOW_RESUME_MS = 45000;
export declare const FOLLOW_RESUME_MIN_S = 6;
export declare const FOLLOW_RESUME_REGIONS = 2;
/**
 * Rule followRecent: the window's rate when it is the same heart as the number shown last (within FOLLOW_BPM, that
 * number at most FOLLOW_MS old, the window at FOLLOW_MIN_SNR_DB or more), else null. `blocked`: a taint, the blink
 * gate or steadyLight withholds it.
 */
export declare function followRate(lastShown: {
    bpm: number;
    t: number;
} | null, timestampMs: number, windowBpm: number | null | undefined, windowSnrDb: number | null | undefined, blocked: boolean): number | null;
/**
 * Rule moreReadings (re-lock): the shortest streak that returns to a proven rate. Two is the fewest windows that can agree with each
 * other; one and two measured alike, three lost most of the shorter gaps on the side webcams (lane/sessionbar).
 */
export declare const RELOCK_STREAK = 2;
/**
 * Rule moreReadings (re-lock): the mean SNR a returning streak needs, a dB under the first proof's bar
 * (OWN_PULSE_MIN_SNR_DB, -3). The gaps after a number are mostly windows just under -3 dB, and a rate proven seconds
 * ago is evidence of its own. Chosen on one set of recorded webcam sessions against a finger reference (-4, -5 and -6
 * tied; the highest taken) and scored once on others: right seconds per 100 rose from 43.1 to 45.8 on a good webcam
 * and 9.8 to 10.5 on weaker ones, within 5 bpm unchanged (95.8%) and made-up seconds on no-pulse copies 5.4 to 6.0 per
 * 100 s.
 */
export declare const RELOCK_MIN_SNR_DB = -4;
/**
 * Rule moreReadings (building): the mean SNR a streak needs before a first proof to show as the building number, two
 * dB under the proof's bar (OWN_PULSE_MIN_SNR_DB, -3). Wearables trade some accuracy for a number nearly always on
 * screen; seated against ECG their mean error runs from about 3.6 bpm (best wrist devices) to 8.0 (a ring), median
 * about 5 (Gielen 2026). Chosen on one set of recorded webcam sessions against a finger reference as the most numbers
 * on screen at a mean error no worse than the ring's, and scored once on others: seconds with a number rose by about
 * a third over three cameras (by half on the two weaker ones) at a mean error of 3.8 bpm against 3.3, while a number
 * showed on about three times as many seconds of block-shuffled no-pulse copies, which the blink gate is for.
 */
export declare const BUILDING_MIN_SNR_DB = -5;
/** Rule moreReadings (re-lock): a not-measured verdict whose streak agrees with a rate proven in the last RELOCK_MS becomes that rate. */
export declare function relockVerdict<V extends {
    verdict: string;
    bpm: number | null;
    snrDb: number | null;
    streak: number;
    path: unknown;
    streakBpm?: number | null;
    streakSnrDb?: number | null;
}>(v: V, lastProven: {
    bpm: number;
    t: number;
} | null, timestampMs: number): V;
/**
 * Rule foreheadPool: the building number's streak while the forehead is the patch pool. The pool reads the forehead
 * far cleaner, so the combined line agrees more often, on no pulse as well. Measured on block-shuffled no-pulse copies
 * of recorded webcam captures (three cameras): at streak 4 the pool showed about a sixth more made-up seconds than the
 * box, most of them the building number, while its gain on real pulses was mostly proven numbers. At streak 5 it showed
 * fewer made-up seconds than the box at streak 4, and against a finger reference still nearly doubled the right numbers
 * on the two weaker cameras and raised the good camera's by a fifth.
 */
export declare const POOL_BUILDING_STREAK: number;
/**
 * Rule coherentFusion: the building number's streak (whatever the forehead). With the coherent line, on recorded
 * webcam sessions of two sets of people against a finger reference, three windows gave about a fifth more seconds with a
 * number than today's building streak at a mean error around the wearables' median, and somewhat more numbers on
 * no-pulse copies and under a lamp flickering at a heart-like rate (lane fp52).
 */
export declare const COHERENT_BUILDING_STREAK: number;
/**
 * Rule shortStreak: the building number from 2 agreeing windows. On recorded lab webcam sessions (with
 * coherentFusion, the forehead pool and clearWindows) about a tenth more seconds with a number at an error still inside
 * the wearables' range at rest, and about a third more numbers on no-pulse copies; on real-device recordings more
 * seconds with a number on every device with the error against a typed watch unchanged.
 */
export declare const SHORT_BUILDING_STREAK = 2;
/**
 * Rule steadyLight: the building number waits while its window holds this many light steps or more. On a recorded
 * Android phone session a building number of 51 against a ring's 68 came from 2 windows holding 6 to 8 steps, right after the
 * screen light switched on. Replayed on every received recording and on recorded lab sessions, 3 removed it and the
 * phone's error against typed references fell from 6.6 to 4.0 bpm, at no cost in seconds with a number on the laptop,
 * half a point on the phone and 0.2 on lab webcams, and slightly fewer numbers on no-pulse copies (2.3 to 2.1 per 100);
 * 1 cut numbers on no-pulse copies further (1.7) but cost about 0.7 points of seconds everywhere.
 */
export declare const STEADY_LIGHT_MAX_STEPS = 3;
/** Rule steadyLight: whether a building number may show with this many light steps in its window. */
export declare function steadyLightAllows(windowScreenSteps: number | null | undefined, rules: Pick<ResolvedPulseCheckRules, "steadyLight">): boolean;
/** The building streak under the rules running. */
/** The run of windows the early number counts: the clear windows under rule clearWindows, else every agreeing one. */
export declare function countingStreak(v: {
    streak: number;
    clearStreak?: number;
}, rules: Pick<ResolvedPulseCheckRules, "clearWindows">): number;
export declare function buildingStreak(rules: ResolvedPulseCheckRules): number;
/**
 * Rule moreReadings: the rate a streak may show while no proven rate is shown, or null. Only while nothing withholds
 * the window, and only for a streak at least `minStreak` windows long (OWN_PULSE_STRONG_STREAK, the shortest
 * streak the check ever accepts; POOL_BUILDING_STREAK under rule foreheadPool) whose mean SNR reaches
 * BUILDING_MIN_SNR_DB (two dB under the proof's bar).
 */
export declare function buildingRate(v: {
    verdict: string;
    streak: number;
    streakBpm?: number | null;
    streakSnrDb?: number | null;
    clearStreak?: number;
    clearBpm?: number | null;
    clearSnrDb?: number | null;
}, withheld: boolean, minStreak?: number, 
/** Rule clearWindows: count only the streak's clear windows (clearStreak, clearBpm, clearSnrDb). */
clear?: boolean): number | null;
/** The rate a check's state shows: the proven rate when one is shown, else (rule moreReadings) the building streak's
 * rate, else null. A proven rate whose newest windows no longer back it falls back to the building rate, so a proof
 * (or a re-lock) never shows less than the streak behind it would. */
/**
 * Rule blinkGate: how far the blink score must rise above its own median of the previous BLINK_BASE_MS to start a
 * blink. Set on one set of people at rest at the log midpoint between the largest rise any photo of them reached (a
 * frozen copy and a hand-held photo of each) and the 5th percentile of their real blink rises, then held out on
 * people it was not set on: no photo passed, and everyone blinked (evidence repo lane/liveness). A fixed bar failed:
 * a photo caught with half-shut eyes shakes across it.
 */
export declare const BLINK_RISE = 0.1574;
/** Rule blinkGate: the window whose median is the eyes' own open level. */
export declare const BLINK_BASE_MS = 2000;
/** Rule blinkGate: a blink ends within this long (a real blink lasts about 100 to 400 ms, Caffier 2003). */
export declare const BLINK_MAX_MS = 500;
/**
 * Rule blinkGate: a blink detector over blink scores in time order. Feed every frame's score; `seen` turns true once a
 * score rises BLINK_RISE above the median of the previous BLINK_BASE_MS and falls back under that level plus
 * BLINK_RISE within BLINK_MAX_MS. Needs half of BLINK_BASE_MS covered before it judges (about 1 s at 30 frames a second).
 */
export declare class BlinkDetector {
    private scores;
    private start;
    seen: boolean;
    push(t: number, score: number): void;
    reset(): void;
}
/**
 * Why a state shows no rate, the check's first blocking cause in a fixed priority (spec SPEC-reading-state.md in the
 * testbed, section 4), so an app's one instruction comes from what the check itself saw: no face, a flickering light
 * (wall, room, screen or face-flicker rule), the head moving at the rate, no rate in the window (colour damaged and
 * the wall too dim for the backup method), a window under the SNR bar, a signal over the bar whose regions do not yet
 * agree, the blink gate waiting, or shown. `faceInView`: the app's own face tracking this second.
 */
export type PulseCheckCause = "noFace" | "lightFlicker" | "collecting" | "noRate" | "weakSignal" | "agreeing" | "waitingForBlink" | "shown";
export declare function pulseCheckCause(state: PulseCheckState, faceInView: boolean): PulseCheckCause;
/**
 * Whether the check's latest window found the camera's colour damaged, by its own measure: read by the
 * damaged-colour method, or colour damage at its switch (OWN_PULSE_COLOUR_SWITCH). An app names light (white light,
 * a night-light filter) as the fix for a weak signal only then, or when the face is measurably dark.
 */
export declare function pulseCheckColourDamaged(state: PulseCheckState): boolean;
/**
 * The streak the running rules need before a rate shows: the proof's OWN_PULSE_STREAK, or with moreReadings its
 * building bar OWN_PULSE_STRONG_STREAK, and RELOCK_STREAK while re-lock is open (`state.relockOpen`). An app's
 * progress toward a number counts toward this, never toward a fixed 8.
 */
export declare function streakNeeded(rules: ResolvedPulseCheckRules, relockOpen: boolean): number;
/**
 * How close the check is to a number, 0 to 1, for a progress ring every app draws the same way: the first window filling
 * (0 to 0.5), then the counting streak toward the windows the rules need (0.5 to 1); 0.95 when the count is complete but
 * a rule still holds the number, 1 with a number shown. It follows the check both ways: held at its best it read as nearly
 * there while the check had slipped (a tester saw it stuck short of full for about 10 s).
 */
export declare function pulseProgress(state: PulseCheckState, rules: ResolvedPulseCheckRules): number;
export declare function shownPulseBpm(state: {
    verdict: string;
    bpm: number | null;
    buildingBpm?: number | null;
    followBpm?: number | null;
}): number | null;
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
    /**
     * The inner-lip gap (face mesh 13 to 14) as a share of faceWidth: how open the mouth is. Recorded only, for an
     * app's talking step (a guided test confirms the tester talked); no rule of this check reads it.
     */
    mouthOpen?: number;
    /**
     * Head angles in degrees from the mesh's own depth (z), recorded only, for an app's pose steps (a guided test
     * confirms the tester turned or looked down); no rule of this check reads them. Yaw: the cheekbone line's angle in
     * the x-z plane; pitch: the forehead-to-chin line's angle in the y-z plane; roll: the cheekbone line's angle in the
     * image. Absolute values carry the mesh's own bias, so an app compares them against the same person's straight-on
     * step, never against a fixed number. Absent when the mesh gives no depth.
     */
    yawDeg?: number;
    pitchDeg?: number;
    rollDeg?: number;
    /**
     * How closed the eyes are, 0 open to 1 shut: the mean of the face landmarker's eyeBlinkLeft and eyeBlinkRight
     * scores (eyeBlink). Recorded only, so a liveness test (a photo does not blink) can be built and scored offline on
     * real recordings; no rule of this check reads it. Absent when the landmarker gave no blink scores.
     */
    blink?: number;
};
/** The mean of the eyeBlinkLeft and eyeBlinkRight scores, or null when either is missing (HeadPosition.blink). */
export declare function eyeBlink(blendshapes: readonly {
    categoryName: string;
    score: number;
}[] | null | undefined): number | null;
/**
 * Yaw, pitch and roll in degrees from three mesh lines (headCentre). MediaPipe gives z on roughly the scale of x
 * (normalised by the image width), so z is scaled by the width. Null when any point lacks a finite z.
 */
export declare function headAngles(points: readonly {
    x: number;
    y: number;
    z?: number;
}[], width: number, height: number): {
    yawDeg: number;
    pitchDeg: number;
    rollDeg: number;
} | null;
/**
 * The head's position this frame: the centre of HEAD_LANDMARKS in pixels, and the face's width
 * (cheekbone to cheekbone, in pixels), or null if the mesh lacks a landmark or the frame has no size.
 */
export declare function headCentre(points: readonly {
    x: number;
    y: number;
    z?: number;
}[], width: number, height: number): HeadPosition | null;
/** One frame of the head as the check keeps it: [time ms, x, y, face width], pixels (headCentre). */
export type HeadRow = [number, number, number, number];
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
/**
 * The room's own bar for rule roomLight. A room has no pulse, so its line only has to clear the room's own noise, not
 * the wall's bar: the bar sits at the room line's noise level on recorded captures without a lamp, so the room vetoes
 * a face rate only when it plainly carries a light at that rate.
 *
 * Value chosen by measurement on recorded captures without a lamp, checked on captures with one.
 */
export declare const ROOM_MIN_SNR_DB = 2.458;
/** Whether the room's line carries the face's rate (rule roomLight): within OWN_PULSE_AGREE_BPM, at or over ROOM_MIN_SNR_DB. */
export declare function roomCarries(line: {
    bpm: number;
    snrDb: number;
} | null, bpm: number): boolean;
/** Equal steps in one window that make it not evidence: the most that left real captures' readings unchanged. */
export declare const SCREEN_STEPS_PER_WINDOW = 10;
/**
 * A step counts only if its new level holds: within SCREEN_LEVEL_HOLD_MS no region gives back
 * SCREEN_LEVEL_REVERSAL of it. A screen or a switched light moves the face to a new level that stays
 * (200 ms or more on the generated screens); mains flicker filmed with uneven frame drops moves every
 * region together too, but reverses on the next kept frame, so it is not a screen and a pulse under it
 * is still read.
 */
export declare const SCREEN_LEVEL_HOLD_MS = 100;
export declare const SCREEN_LEVEL_REVERSAL = 0.5;
export declare function levelHolds(samples: readonly (readonly number[])[], k: number): boolean;
/** Whether the change from sample `a` to sample `b` is one light stepping on all three regions alike. */
export declare function equalLightStep(a: readonly number[], b: readonly number[]): boolean;
/** Equal light steps in the OWN_PULSE_WINDOW_S window ending at `atMs`. */
export declare function screenSteps(samples: readonly (readonly number[])[], atMs: number): number;
/**
 * A proven rate handed from one check to the next across a camera restart (the camera ended while the page was hidden,
 * a lower resolution, a switch to another camera): the rate and the wall-clock time (Date.now) it was last proven. The
 * new camera's frames run on a new clock, so the time is on the wall clock. Read with resumePoint, given back with
 * createRppgSession's pulseCheckResume; the new check uses it as followRecent uses a break that kept the camera.
 */
export type PulseCheckResume = {
    bpm: number;
    atEpochMs: number;
};
export declare class PulseCheck {
    constructor(opts?: {
        rules?: PulseCheckRules;
        /** The rate proven by the check before a camera restart (resumePoint of that check). */
        resumeFrom?: PulseCheckResume | null;
        /** The wall clock, Date.now unless a test sets it. */
        now?: () => number;
        /** For replay only: a hand-over already placed on the recording's frame clock (PulseCheckRecording.resume). */
        resumeAt?: {
            bpm: number;
            t: number;
        } | null;
    });
    private readonly now;
    /** A hand-over not yet placed on this check's frame clock (placed at the first frame). */
    private resumeFrom;
    /** The wall-clock time of followKept, for resumePoint. */
    private keptEpochMs;
    /** The hand-over as placed on this check's frame clock, kept for the recording; null when none was given. */
    resumeSeed: {
        bpm: number;
        t: number;
    } | null;
    /** A hand-over was given and no frame has placed it yet. */
    get resumePending(): boolean;
    /** The rate to hand to the check after a camera restart: the last proven rate and when, or null before one. */
    resumePoint(): PulseCheckResume | null;
    /** Which light rules this check runs (see PulseCheckRules). */
    readonly rules: ResolvedPulseCheckRules;
    /** The least wall against the face for green minus the wall: any wall seen (rule darkWall deleted 2026-10-30). */
    private get swapMinWall();
    private samples;
    private wall;
    /** The room (roomFromFrame) as handed over, for rule roomLight, kept as long as the wall. */
    private room;
    private head;
    /** A head argument (a position or null) has reached push since the last reset: the movement is judged. */
    private headHandedOver;
    private history;
    private held;
    /** Rule blinkGate: the blinks seen since the face appeared. */
    private blinks;
    /** Rule moreReadings (re-lock): the latest proven rate and when it was proven, or null. */
    private lastProven;
    /** Rule followRecent across a break: the last proven number, kept through a reset (FOLLOW_RESUME_MS). */
    private followKept;
    /** Rule followRecent: the last number the check proved, with its time. */
    private lastShown;
    /** The newest in-band follower value, or null (the state's followerBpm). */
    private followerBpm;
    private lastEvalMs;
    private lostSinceMs;
    private wallTally;
    private state;
    /**
     * Whether a caller should compute push's diagnostics: when rule roomLight needs the room, and always in a
     * RecordingPulseCheck, which keeps them. Otherwise they are skipped, at no cost.
     */
    get wantsDiagnostics(): boolean;
    /**
     * Rule blinkGate is satisfied: a blink has been seen since the face appeared, or the rule is off. The face frame
     * source reuses a still face's landmarks for longer only then, so the gate is never starved of blink samples.
     */
    get blinkGateOpen(): boolean;
    /** Whether a caller should compute the 115 face patches for push's diagnostics: only a recording built to keep them. */
    get wantsFacePatches(): boolean;
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
    wallRaw?: Rgb, 
    /** Recorded (RecordingPulseCheck); the check reads only `room`, and only under rule roomLight. */
    diag?: PulseCheckFrameDiag): void;
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
    /**
     * How many times the check has judged a window (about once a second while frames arrive), counting
     * from its creation; a reset does not clear it. A replay reads it to know which pushes produced a new
     * state. Nothing in the check reads it.
     */
    get evaluations(): number;
    private evaluationCount;
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
    patch: WallPatchDiag;
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
        patch?: WallPatchDiag;
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
/** One upper corner of the room: mean RGB (0..1, to 7 decimals) of its non-skin pixels, and how many it averaged. */
export type RoomCorner = {
    rgb: Rgb;
    n: number;
};
/** The room, each upper corner on its own: a face reaching one corner changes only that corner's pixel set. */
export type RoomCorners = {
    left: RoomCorner | null;
    right: RoomCorner | null;
};
/**
 * What a recording keeps beside each frame's inputs (lane/wallroom). Rule roomLight (off by default) reads the room;
 * replay feeds the recorded room to it. The patch is recorded only.
 */
export type PulseCheckFrameDiag = {
    room?: RoomCorners | null;
    patch?: WallPatchDiag | null;
    /**
     * Switch foreheadPool: the forehead box the pool replaced this frame (the region the check would have read without
     * the pool), recorded only, so a recording can be replayed both ways on the same seconds. Absent without the pool.
     */
    foreheadBox?: Rgb | null;
    /**
     * Session switch light: the face's light (lightLevel.ts) this frame, the level asked for and the level the app said it
     * rendered, recorded only. Absent without the switch.
     */
    light?: {
        face: {
            luma: number;
            redClip: number;
        } | null;
        wanted: number;
        applied: number;
    } | null;
    /**
     * The 115 skin patches (facePatches.ts) this frame, only when the check keeps them (`wantsFacePatches`), recorded
     * only; null when the frame had no mesh.
     */
    facePatches?: FacePatches | null;
};
/** The wall patch as read this frame, for the recording only: x, y, w, h in pixels and how many non-skin pixels it averaged. */
export type WallPatchDiag = [number, number, number, number, number];
/** The room as one signal: the corners' pixel-weighted mean, or the one corner there is, or null. */
export declare function combineRoom(room: RoomCorners | null | undefined): Rgb | null;
/** Share of the frame's width and height each upper-corner patch of the room spans (roomFromFrame). */
export declare const ROOM_CORNER_SHARE = 0.2;
/** How far clear of the face box, as a share of the face's width, a room pixel must lie (roomFromFrame). */
export declare const ROOM_FACE_CLEAR = 0.5;
/**
 * roomFromFrame reads every ROOM_STRIDE-th pixel across and down. Measured (lane/wallroom, real frames with a 1% lamp,
 * dark, after VP9): the lamp's line against its noise was 95.6 reading every pixel, 77.6 at 2, 67.5 at 3, 62.6 at 4;
 * the room's noise is mostly shared between pixels, so a quarter of the pixels keeps 81% of it at a quarter of the
 * cost (an independent review measured the full read at about 1 to 3 ms a frame on a mid-range phone).
 */
export declare const ROOM_STRIDE = 2;
/**
 * The room: for each of the frame's two upper corners (each ROOM_CORNER_SHARE of the width and height), the mean RGB
 * (0..1, to 7 decimals) of its non-skin pixels, leaving out every pixel within ROOM_FACE_CLEAR face widths of the face
 * box, with how many pixels it averaged; a corner is null under 25 qualifying pixels or a tenth of those looked at, and
 * the whole is null when both are. Reads every ROOM_STRIDE-th pixel. The corners are kept apart because the face box
 * follows the mesh every frame: when a face reaches a corner, that corner's pixel set changes and its level can step,
 * while the other corner stays a constant set. Rule roomLight (off by default) reads it, combined (combineRoom).
 */
export declare function roomFromFrame(frame: Frame, points: readonly {
    x: number;
    y: number;
}[] | null | undefined): RoomCorners | null;
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