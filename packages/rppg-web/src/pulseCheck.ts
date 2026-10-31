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
import type { FacePatches } from "./facePatches";
import { type Frame, averageRgbInROINonSkinCounted } from "./frameSource";
import {
	OWN_PULSE_AGREE_BPM,
	OWN_PULSE_BAND_HZ,
	OWN_PULSE_DETREND_S,
	OWN_PULSE_FS,
	OWN_PULSE_COLOUR_SWITCH,
	OWN_PULSE_EDGE_BPM,
	OWN_PULSE_LOW_BAND_BPM,
	OWN_PULSE_STRONG_STREAK,
	OWN_PULSE_MIN_SNR_DB,
	OWN_PULSE_STREAK,
	OWN_PULSE_SWAP_MIN_WALL_TO_FACE,
	OWN_PULSE_WINDOW_S,
	type OwnPulseEstimate,
	type RawRoiSample,
	detrend,
	estimateOwnPulse,
	ownPulseVerdict,
	peakOfSpectrum,
	resample,
	spectrum,
} from "./pulseCheckCore";

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
	roomLine?: { bpm: number; snrDb: number } | null;
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
	wallLine?: { bpm: number; snrDb: number } | null;
	/**
	 * Frames in the last one-second step: with the wall seen, and without it because the face
	 * left no room beside it or because every patch beside it looked like skin (wallMissReason).
	 */
	wallFrames?: { seen: number; noRoom: number; skin: number };
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
export const OWN_PULSE_TRACK_S = 12;
/**
 * A number on screen must be backed by fresh evidence. The proven rate is an average over 8+ windows
 * of 16 s, so it describes the last ~20 s; when the heart rate moves fast (after exercise, 72 -> 90 in
 * 10 s) the pulse drops out of every short window while the 16 s window, mostly old data, still reports
 * the old rate. So the rate shown follows the newest OWN_PULSE_SUPPORT_S seconds (replacing the 12 s
 * OWN_PULSE_TRACK_S window), and after OWN_PULSE_SUPPORT_MISS evaluations without it nothing is shown.
 *
 * Value chosen by measurement on recorded captures against a reference pulse.
 */
export const OWN_PULSE_SUPPORT_S = 8;
export const OWN_PULSE_SUPPORT_MISS = 3;
export const OWN_PULSE_TRACK_BPM = 4;



/** Why no wall was found beside the face this frame (see wallBesideFace). */
export type WallMiss = "no-room" | "skin";

type Rgb = { r: number; g: number; b: number };

/** Minimum wall frames in a window before it is judged (3 s at 20 fps). */
const WALL_MIN_SAMPLES = 60;

/**
 * How far above its own noise (dB) the wall's brightness line must stand at the proven rate for
 * the rate to be withheld.
 *
 * Value chosen by measurement on recorded captures against a reference pulse.
 */
const WALL_MIN_SNR_DB = 12;


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

export const PULSE_CHECK_RULE_NAMES = [
	"screenLight",
	"restBand",
	"moreReadings",
	"blinkGate",
	"foreheadPool",
	"coherentFusion",
	"clearWindows",
	"shortStreak",
	"steadyLight",
	"roomLight",
	"followRecent",
] as const;

/**
 * Rule moreReadings (re-lock): how long a proven rate stays the one a new streak may return to. Measured on recorded webcam sessions
 * (lane/sessionbar): 15, 30 and 60 s gave the same shown seconds and wrong rate, so the middle one; about two of the
 * check's 16 s windows.
 */
export const RELOCK_MS = 30_000;
/**
 * Rule followRecent: how recent the proven number must be, how close the window's rate, how strong the window. Chosen
 * on the received sessions, one score per typed reference (evidence repo tools/decide.mjs, 2026-10-30), anchored on
 * proven numbers only: 3 bpm added seconds at the same error and share over 10 off; 6 bpm added more again (windows 3 to
 * 6 bpm from a proven number within 30 s read 2 bpm from the reference, tools/notagree.mjs) at the same error, and on
 * the lab finger set and its no-pulse copies moved the share over 10 off and the no-pulse numbers by a few tenths.
 * Anchoring on building numbers too failed the lab. 30 s is RELOCK_MS, -5 dB is BUILDING_MIN_SNR_DB; 6 bpm is
 * OWN_PULSE_AGREE_BPM, the re-lock's own agreement.
 */
export const FOLLOW_MS = 30_000;
export const FOLLOW_BPM = 6;
export const FOLLOW_MIN_SNR_DB = -5;
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
export const FOLLOW_RESUME_MS = 45_000;
export const FOLLOW_RESUME_MIN_S = 6;
export const FOLLOW_RESUME_REGIONS = 2;

/**
 * Rule followRecent: the window's rate when it is the same heart as the number shown last (within FOLLOW_BPM, that
 * number at most FOLLOW_MS old, the window at FOLLOW_MIN_SNR_DB or more), else null. `blocked`: a taint, the blink
 * gate or steadyLight withholds it.
 */
export function followRate(
	lastShown: { bpm: number; t: number } | null,
	timestampMs: number,
	windowBpm: number | null | undefined,
	windowSnrDb: number | null | undefined,
	blocked: boolean,
): number | null {
	if (blocked || lastShown == null || windowBpm == null || windowSnrDb == null) return null;
	if (timestampMs - lastShown.t > FOLLOW_MS || windowSnrDb < FOLLOW_MIN_SNR_DB) return null;
	return Math.abs(windowBpm - lastShown.bpm) <= FOLLOW_BPM ? windowBpm : null;
}
/**
 * Rule moreReadings (re-lock): the shortest streak that returns to a proven rate. Two is the fewest windows that can agree with each
 * other; one and two measured alike, three lost most of the shorter gaps on the side webcams (lane/sessionbar).
 */
export const RELOCK_STREAK = 2;
/**
 * Rule moreReadings (re-lock): the mean SNR a returning streak needs, a dB under the first proof's bar
 * (OWN_PULSE_MIN_SNR_DB, -3). The gaps after a number are mostly windows just under -3 dB, and a rate proven seconds
 * ago is evidence of its own. Chosen on one set of recorded webcam sessions against a finger reference (-4, -5 and -6
 * tied; the highest taken) and scored once on others: right seconds per 100 rose from 43.1 to 45.8 on a good webcam
 * and 9.8 to 10.5 on weaker ones, within 5 bpm unchanged (95.8%) and made-up seconds on no-pulse copies 5.4 to 6.0 per
 * 100 s.
 */
export const RELOCK_MIN_SNR_DB = -4;

/**
 * Rule moreReadings (building): the mean SNR a streak needs before a first proof to show as the building number, two
 * dB under the proof's bar (OWN_PULSE_MIN_SNR_DB, -3). Wearables trade some accuracy for a number nearly always on
 * screen; seated against ECG their mean error runs from about 3.6 bpm (best wrist devices) to 8.0 (a ring), median
 * about 5 (Gielen 2026). Chosen on one set of recorded webcam sessions against a finger reference as the most numbers
 * on screen at a mean error no worse than the ring's, and scored once on others: seconds with a number rose by about
 * a third over three cameras (by half on the two weaker ones) at a mean error of 3.8 bpm against 3.3, while a number
 * showed on about three times as many seconds of block-shuffled no-pulse copies, which the blink gate is for.
 */
export const BUILDING_MIN_SNR_DB = -5;

/** Rule moreReadings (re-lock): a not-measured verdict whose streak agrees with a rate proven in the last RELOCK_MS becomes that rate. */
export function relockVerdict<
	V extends { verdict: string; bpm: number | null; snrDb: number | null; streak: number; path: unknown; streakBpm?: number | null; streakSnrDb?: number | null },
>(v: V, lastProven: { bpm: number; t: number } | null, timestampMs: number): V {
	if (v.verdict === "measured" || lastProven == null || timestampMs - lastProven.t > RELOCK_MS) return v;
	if (v.streak < RELOCK_STREAK || v.streakBpm == null || v.streakSnrDb == null || v.streakSnrDb < RELOCK_MIN_SNR_DB) return v;
	if (Math.abs(v.streakBpm - lastProven.bpm) > OWN_PULSE_AGREE_BPM) return v;
	return { ...v, verdict: "measured", bpm: v.streakBpm, snrDb: Math.round(v.streakSnrDb * 10) / 10, path: "relock" };
}

/**
 * Rule foreheadPool: the building number's streak while the forehead is the patch pool. The pool reads the forehead
 * far cleaner, so the combined line agrees more often, on no pulse as well. Measured on block-shuffled no-pulse copies
 * of recorded webcam captures (three cameras): at streak 4 the pool showed about a sixth more made-up seconds than the
 * box, most of them the building number, while its gain on real pulses was mostly proven numbers. At streak 5 it showed
 * fewer made-up seconds than the box at streak 4, and against a finger reference still nearly doubled the right numbers
 * on the two weaker cameras and raised the good camera's by a fifth.
 */
export const POOL_BUILDING_STREAK = OWN_PULSE_STRONG_STREAK + 1;

/**
 * Rule coherentFusion: the building number's streak (whatever the forehead). With the coherent line, on recorded
 * webcam sessions of two sets of people against a finger reference, three windows gave about a fifth more seconds with a
 * number than today's building streak at a mean error around the wearables' median, and somewhat more numbers on
 * no-pulse copies and under a lamp flickering at a heart-like rate (lane fp52).
 */
export const COHERENT_BUILDING_STREAK = OWN_PULSE_STRONG_STREAK - 1;
/**
 * Rule shortStreak: the building number from 2 agreeing windows. On recorded lab webcam sessions (with
 * coherentFusion, the forehead pool and clearWindows) about a tenth more seconds with a number at an error still inside
 * the wearables' range at rest, and about a third more numbers on no-pulse copies; on real-device recordings more
 * seconds with a number on every device with the error against a typed watch unchanged.
 */
export const SHORT_BUILDING_STREAK = 2;
/**
 * Rule steadyLight: the building number waits while its window holds this many light steps or more. On a recorded
 * Android phone session a building number of 51 against a ring's 68 came from 2 windows holding 6 to 8 steps, right after the
 * screen light switched on. Replayed on every received recording and on recorded lab sessions, 3 removed it and the
 * phone's error against typed references fell from 6.6 to 4.0 bpm, at no cost in seconds with a number on the laptop,
 * half a point on the phone and 0.2 on lab webcams, and slightly fewer numbers on no-pulse copies (2.3 to 2.1 per 100);
 * 1 cut numbers on no-pulse copies further (1.7) but cost about 0.7 points of seconds everywhere.
 */
export const STEADY_LIGHT_MAX_STEPS = 3;
/** Rule steadyLight: whether a building number may show with this many light steps in its window. */
export function steadyLightAllows(windowScreenSteps: number | null | undefined, rules: Pick<ResolvedPulseCheckRules, "steadyLight">): boolean {
	return !rules.steadyLight || windowScreenSteps == null || windowScreenSteps < STEADY_LIGHT_MAX_STEPS;
}

/** The building streak under the rules running. */
/** The run of windows the early number counts: the clear windows under rule clearWindows, else every agreeing one. */
export function countingStreak(v: { streak: number; clearStreak?: number }, rules: Pick<ResolvedPulseCheckRules, "clearWindows">): number {
	return rules.clearWindows && v.clearStreak != null ? v.clearStreak : v.streak;
}

export function buildingStreak(rules: ResolvedPulseCheckRules): number {
	if (rules.shortStreak) return SHORT_BUILDING_STREAK;
	return rules.coherentFusion ? COHERENT_BUILDING_STREAK : rules.foreheadPool ? POOL_BUILDING_STREAK : OWN_PULSE_STRONG_STREAK;
}

/**
 * Rule moreReadings: the rate a streak may show while no proven rate is shown, or null. Only while nothing withholds
 * the window, and only for a streak at least `minStreak` windows long (OWN_PULSE_STRONG_STREAK, the shortest
 * streak the check ever accepts; POOL_BUILDING_STREAK under rule foreheadPool) whose mean SNR reaches
 * BUILDING_MIN_SNR_DB (two dB under the proof's bar).
 */
export function buildingRate(
	v: { verdict: string; streak: number; streakBpm?: number | null; streakSnrDb?: number | null; clearStreak?: number; clearBpm?: number | null; clearSnrDb?: number | null },
	withheld: boolean,
	minStreak: number = OWN_PULSE_STRONG_STREAK,
	/** Rule clearWindows: count only the streak's clear windows (clearStreak, clearBpm, clearSnrDb). */
	clear = false,
): number | null {
	if (clear && v.clearStreak != null) v = { ...v, streak: v.clearStreak, streakBpm: v.clearBpm, streakSnrDb: v.clearSnrDb };
	if (v.verdict === "measured" || withheld || v.streak < minStreak) return null;
	if (v.streakSnrDb == null || v.streakSnrDb < BUILDING_MIN_SNR_DB) return null;
	return v.streakBpm ?? null;
}

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
export const BLINK_RISE = 0.1574;
/** Rule blinkGate: the window whose median is the eyes' own open level. */
export const BLINK_BASE_MS = 2000;
/** Rule blinkGate: a blink ends within this long (a real blink lasts about 100 to 400 ms, Caffier 2003). */
export const BLINK_MAX_MS = 500;

/**
 * Rule blinkGate: a blink detector over blink scores in time order. Feed every frame's score; `seen` turns true once a
 * score rises BLINK_RISE above the median of the previous BLINK_BASE_MS and falls back under that level plus
 * BLINK_RISE within BLINK_MAX_MS. Needs half of BLINK_BASE_MS covered before it judges (about 1 s at 30 frames a second).
 */
export class BlinkDetector {
	private scores: [number, number][] = [];
	private start: { t: number; base: number } | null = null;
	seen = false;
	push(t: number, score: number): void {
		const prev = this.scores.filter(([u]) => u >= t - BLINK_BASE_MS && u < t).map(([, v]) => v);
		this.scores.push([t, score]);
		while (this.scores.length && this.scores[0][0] < t - BLINK_BASE_MS) this.scores.shift();
		const covered = prev.length >= 2 && t - this.scores[0][0] >= BLINK_BASE_MS / 2;
		if (this.start == null) {
			if (!covered) return;
			const sorted = [...prev].sort((a, b) => a - b);
			const n = sorted.length;
			const base = n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
			if (score >= base + BLINK_RISE) this.start = { t, base };
		} else if (score < this.start.base + BLINK_RISE) {
			if (t - this.start.t <= BLINK_MAX_MS) this.seen = true;
			this.start = null;
		}
	}
	reset(): void {
		this.scores = [];
		this.start = null;
		this.seen = false;
	}
}

/**
 * Why a state shows no rate, the check's first blocking cause in a fixed priority (spec SPEC-reading-state.md in the
 * testbed, section 4), so an app's one instruction comes from what the check itself saw: no face, a flickering light
 * (wall, room, screen or face-flicker rule), the head moving at the rate, no rate in the window (colour damaged and
 * the wall too dim for the backup method), a window under the SNR bar, a signal over the bar whose regions do not yet
 * agree, the blink gate waiting, or shown. `faceInView`: the app's own face tracking this second.
 */
export type PulseCheckCause = "noFace" | "lightFlicker" | "collecting" | "noRate" | "weakSignal" | "agreeing" | "waitingForBlink" | "shown";
export function pulseCheckCause(state: PulseCheckState, faceInView: boolean): PulseCheckCause {
	if (!faceInView) return "noFace";
	if (shownPulseBpm(state) != null) return "shown";
	if (state.wallMatch || state.roomMatch || state.screenLight) return "lightFlicker";
	if (state.waitingForBlink) return "waitingForBlink";
	if (state.collecting) return "collecting";
	if (state.windowSnrDb == null) return "noRate";
	if (state.windowSnrDb < OWN_PULSE_MIN_SNR_DB) return "weakSignal";
	return "agreeing";
}

/**
 * Whether the check's latest window found the camera's colour damaged, by its own measure: read by the
 * damaged-colour method, or colour damage at its switch (OWN_PULSE_COLOUR_SWITCH). An app names light (white light,
 * a night-light filter) as the fix for a weak signal only then, or when the face is measurably dark.
 */
export function pulseCheckColourDamaged(state: PulseCheckState): boolean {
	return state.windowMethod === "greenMinusWall" || (state.windowColourDamage ?? 0) >= OWN_PULSE_COLOUR_SWITCH;
}

/**
 * The streak the running rules need before a rate shows: the proof's OWN_PULSE_STREAK, or with moreReadings its
 * building bar OWN_PULSE_STRONG_STREAK, and RELOCK_STREAK while re-lock is open (`state.relockOpen`). An app's
 * progress toward a number counts toward this, never toward a fixed 8.
 */
export function streakNeeded(rules: ResolvedPulseCheckRules, relockOpen: boolean): number {
	if (!rules.moreReadings) return OWN_PULSE_STREAK;
	return relockOpen ? RELOCK_STREAK : buildingStreak(rules);
}

/**
 * How close the check is to a number, 0 to 1, for a progress ring every app draws the same way: the first window filling
 * (0 to 0.5), then the counting streak toward the windows the rules need (0.5 to 1); 0.95 when the count is complete but
 * a rule still holds the number, 1 with a number shown. It follows the check both ways: held at its best it read as nearly
 * there while the check had slipped (a tester saw it stuck short of full for about 10 s).
 */
export function pulseProgress(state: PulseCheckState, rules: ResolvedPulseCheckRules): number {
	if (shownPulseBpm(state) != null) return 1;
	if (state.collecting !== false) return Math.max(0, Math.min(1, state.windowFill ?? 0)) / 2;
	const needed = Math.max(1, streakNeeded(rules, state.relockOpen === true));
	const done = Math.min(needed, Math.max(0, state.countingStreak ?? state.streak));
	return done >= needed ? 0.95 : 0.5 + done / needed / 2;
}

export function shownPulseBpm(state: { verdict: string; bpm: number | null; buildingBpm?: number | null; followBpm?: number | null }): number | null {
	return state.verdict === "measured" && state.bpm != null ? state.bpm : (state.buildingBpm ?? state.followBpm ?? null);
}

/** Every rule resolved to true or false; left out means on. */
export function resolvePulseCheckRules(rules?: PulseCheckRules | null): ResolvedPulseCheckRules {
	return {
		screenLight: rules?.screenLight !== false,
		restBand: rules?.restBand !== false,
		moreReadings: rules?.moreReadings === true,
		blinkGate: rules?.blinkGate === true,
		foreheadPool: rules?.foreheadPool === true,
		coherentFusion: rules?.coherentFusion === true,
		clearWindows: rules?.clearWindows !== false,
		shortStreak: rules?.shortStreak !== false,
		steadyLight: rules?.steadyLight !== false,
		roomLight: rules?.roomLight !== false,
		followRecent: rules?.followRecent === true,
	};
}

/**
 * Face-mesh landmarks on bone, not on skin that moves with expression: nose bridge and tip, forehead,
 * chin, outer eye corners, cheekbones (MediaPipe face mesh indices).
 */
export const HEAD_LANDMARKS: readonly number[] = [168, 6, 4, 10, 152, 33, 263, 234, 454];

/** The cheekbones (MediaPipe face mesh 234 and 454): their distance is the face's width. */
const CHEEKBONES = [234, 454] as const;

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
export function eyeBlink(blendshapes: readonly { categoryName: string; score: number }[] | null | undefined): number | null {
	if (!blendshapes) return null;
	const l = blendshapes.find((b) => b.categoryName === "eyeBlinkLeft")?.score;
	const r = blendshapes.find((b) => b.categoryName === "eyeBlinkRight")?.score;
	return l != null && r != null && Number.isFinite(l) && Number.isFinite(r) ? (l + r) / 2 : null;
}

/** Inner lips, upper and lower (MediaPipe face mesh 13 and 14). */
const INNER_LIPS = [13, 14] as const;

/** Forehead and chin (MediaPipe face mesh 10 and 152): the face's vertical line, for pitch. */
const FOREHEAD_CHIN = [10, 152] as const;

/**
 * Yaw, pitch and roll in degrees from three mesh lines (headCentre). MediaPipe gives z on roughly the scale of x
 * (normalised by the image width), so z is scaled by the width. Null when any point lacks a finite z.
 */
export function headAngles(
	points: readonly { x: number; y: number; z?: number }[],
	width: number,
	height: number,
): { yawDeg: number; pitchDeg: number; rollDeg: number } | null {
	const [l, r] = CHEEKBONES.map((i) => points[i]);
	const [f, c] = FOREHEAD_CHIN.map((i) => points[i]);
	if (![l, r, f, c].every((p) => p && Number.isFinite(p.z))) return null;
	const deg = 180 / Math.PI;
	const yawDeg = Math.atan2(((r.z as number) - (l.z as number)) * width, (r.x - l.x) * width) * deg;
	const pitchDeg = Math.atan2(((c.z as number) - (f.z as number)) * width, (c.y - f.y) * height) * deg;
	const rollDeg = Math.atan2((r.y - l.y) * height, (r.x - l.x) * width) * deg;
	return { yawDeg, pitchDeg, rollDeg };
}

/**
 * The head's position this frame: the centre of HEAD_LANDMARKS in pixels, and the face's width
 * (cheekbone to cheekbone, in pixels), or null if the mesh lacks a landmark or the frame has no size.
 */
export function headCentre(
	points: readonly { x: number; y: number; z?: number }[],
	width: number,
	height: number,
): HeadPosition | null {
	if (points.length <= Math.max(...HEAD_LANDMARKS) || width <= 0 || height <= 0) return null;
	let x = 0;
	let y = 0;
	for (const i of HEAD_LANDMARKS) {
		x += points[i].x * width;
		y += points[i].y * height;
	}
	const [l, r] = CHEEKBONES.map((i) => points[i]);
	const faceWidth = Math.hypot((r.x - l.x) * width, (r.y - l.y) * height);
	const [u, d] = INNER_LIPS.map((i) => points[i]);
	const gap = Math.hypot((d.x - u.x) * width, (d.y - u.y) * height);
	return {
		x: x / HEAD_LANDMARKS.length,
		y: y / HEAD_LANDMARKS.length,
		faceWidth,
		...(faceWidth > 0 && Number.isFinite(gap) ? { mouthOpen: gap / faceWidth } : {}),
		...(headAngles(points, width, height) ?? {}),
	};
}

/** One frame of the head as the check keeps it: [time ms, x, y, face width], pixels (headCentre). */
export type HeadRow = [number, number, number, number];





const ALL_RULES_ON = resolvePulseCheckRules();

export function wallLine(
	wall: [number, number, number, number][],
	atMs: number,
	bandEdge = true,
): { bpm: number; snrDb: number } | null {
	const win = wall.filter(
		(w) => w[0] > atMs - OWN_PULSE_WINDOW_S * 1000 && w[0] <= atMs,
	);
	if (win.length < WALL_MIN_SAMPLES) return null;
	const t = win.map((w) => w[0] / 1000);
	const brightness = resample(
		t,
		win.map((w) => w[1] + w[2] + w[3]),
		t[0],
		t[t.length - 1],
	);
	if (!bandEdge) {
		// Switched off: the in-band local maximum this check used before (blind at the band's edge).
		const pk = peakOfSpectrum(spectrum(detrend(brightness, OWN_PULSE_DETREND_S)));
		return Number.isFinite(pk.bpm) ? { bpm: pk.bpm, snrDb: pk.snrDb } : null;
	}
	// The wall's strongest line is searched from the band's floor to the top of the computed
	// spectrum, with no local-maximum rule: that rule is right for choosing a pulse and wrong for
	// spotting a light. A light on the band's edge puts its maximum just outside the band, so no
	// in-band maximum exists and the wall would read as carrying nothing (120 Hz mains filmed at
	// 9 fps folds to exactly 3.0 Hz, 180 a minute). Line power: bins within 0.1 Hz of the line
	// and of twice it, as peakOfSpectrum counts it.
	const range = spectrum(detrend(brightness, OWN_PULSE_DETREND_S)).filter(
		([f]) => f >= OWN_PULSE_BAND_HZ[0],
	);
	if (!range.length) return null;
	const f0 = range.reduce((a, b) => (b[1] > a[1] ? b : a))[0];
	const inLine = (f: number) =>
		Math.abs(f - f0) <= 0.1 || Math.abs(f - 2 * f0) <= 0.1;
	let sig = 0;
	let rest = 0;
	for (const [f, p] of range) if (inLine(f)) sig += p;
	else rest += p;
	return { bpm: f0 * 60, snrDb: 10 * Math.log10(sig / Math.max(rest, 1e-12)) };
}

/**
 * Whether the wall carries `bpm` the way a light would: the strongest line (band floor up) of its
 * BRIGHTNESS (R + G + B), within OWN_PULSE_AGREE_BPM of the rate or of a LIGHT_FAMILY multiple of it,
 * and WALL_MIN_SNR_DB above its
 * noise. Brightness, not colour: a lamp scales a grey wall's R, G and B alike, which is exactly
 * the change the colour method cancels; and a heartbeat never changes a wall's brightness.
 */
export function wallCarries(
	wall: [number, number, number, number][],
	atMs: number,
	bpm: number,
	rules: ResolvedPulseCheckRules = ALL_RULES_ON,
): boolean {
	return lineCarries(wallLine(wall, atMs, false), bpm, rules);
}

/**
 * The room's own bar for rule roomLight. A room has no pulse, so its line only has to clear the room's own noise, not
 * the wall's bar: the bar sits at the room line's noise level on recorded captures without a lamp, so the room vetoes
 * a face rate only when it plainly carries a light at that rate.
 *
 * Value chosen by measurement on recorded captures without a lamp, checked on captures with one.
 */
export const ROOM_MIN_SNR_DB = 2.458;

/** Whether the room's line carries the face's rate (rule roomLight): within OWN_PULSE_AGREE_BPM, at or over ROOM_MIN_SNR_DB. */
export function roomCarries(line: { bpm: number; snrDb: number } | null, bpm: number): boolean {
	return line != null && line.snrDb >= ROOM_MIN_SNR_DB && Math.abs(line.bpm - bpm) <= OWN_PULSE_AGREE_BPM;
}


/** wallCarries on a wall line already found (one evaluation reads the same line up to three times). */
function lineCarries(
	line: { bpm: number; snrDb: number } | null,
	bpm: number,
	rules: ResolvedPulseCheckRules,
): boolean {
	const family = [1] as const;
	return (
		line != null &&
		line.snrDb >= WALL_MIN_SNR_DB &&
		family.some((k) => Math.abs(k * line.bpm - bpm) <= OWN_PULSE_AGREE_BPM)
	);
}


const EVAL_EVERY_MS = 1000;

/*
 * Rule screenLight. Blood cannot make a step: a pulse changes the skin smoothly, a few percent over a
 * whole beat, while a screen, a lamp switched or an exposure change scales all the skin at once, in one
 * frame, by the same fraction everywhere. Movement and a passing hand step the regions UNEQUALLY. A face
 * with no pulse lit by a screen showing video (steps every 0.3 to 1.5 s, about 67 a minute) was read as
 * a rate, since one light moves all three regions together and they agree. The rule only withholds; it
 * still misses slow (steps 1 to 3 s apart) or shallow (5%) screens, which make too few equal steps in a
 * window. Its settings were measured against recorded captures with a reference pulse before it was added.
 */
/** Largest over smallest region step for one light: a screen's steps sit well within this, unequal movement does not. */
const SCREEN_STEP_RATIO = 1.35;
/** Smallest step counted, as a share of the region's brightness: max(1%, 0.4 per second x frame gap). 0.4/s bounds a 2% pulse's slope at 3 Hz (2 pi x 3 x 0.02). */
const SCREEN_STEP_MIN = 0.01;
const SCREEN_STEP_SLOPE_PER_S = 0.4;
/** Frames further apart than this are a gap, not a step. */
const SCREEN_STEP_MAX_GAP_MS = 250;
/**
 * Regions darker than this share of full scale (R + G + B against 3 x full scale) are a lost face, not skin:
 * 30 of 765 on a 0 to 255 scale. Callers send either scale (the session's skin-masked mean is 0 to 1), so a
 * fixed 30 would discard every frame of a 0 to 1 caller; the scale is read from the values themselves.
 */
const SCREEN_STEP_MIN_BRIGHTNESS_SHARE = 30 / 765;
const brightnessFloor = (x: number) => (x <= 3 ? 3 : 765) * SCREEN_STEP_MIN_BRIGHTNESS_SHARE;
/** Equal steps in one window that make it not evidence: the most that left real captures' readings unchanged. */
export const SCREEN_STEPS_PER_WINDOW = 10;

/**
 * A step counts only if its new level holds: within SCREEN_LEVEL_HOLD_MS no region gives back
 * SCREEN_LEVEL_REVERSAL of it. A screen or a switched light moves the face to a new level that stays
 * (200 ms or more on the generated screens); mains flicker filmed with uneven frame drops moves every
 * region together too, but reverses on the next kept frame, so it is not a screen and a pulse under it
 * is still read.
 */
export const SCREEN_LEVEL_HOLD_MS = 100;
export const SCREEN_LEVEL_REVERSAL = 0.5;
export function levelHolds(samples: readonly (readonly number[])[], k: number): boolean {
	const bright = (s: readonly number[], r: number) => s[1 + 3 * r] + s[2 + 3 * r] + s[3 + 3 * r];
	const a = samples[k - 1];
	const b = samples[k];
	for (let j = k + 1; j < samples.length && samples[j][0] - b[0] <= SCREEN_LEVEL_HOLD_MS; j++)
		for (let r = 0; r < 3; r++) {
			const step = bright(b, r) - bright(a, r);
			if ((bright(samples[j], r) - bright(a, r)) / step < 1 - SCREEN_LEVEL_REVERSAL) return false;
		}
	return true;
}

/** Whether the change from sample `a` to sample `b` is one light stepping on all three regions alike. */
export function equalLightStep(a: readonly number[], b: readonly number[]): boolean {
	const dt = b[0] - a[0];
	if (!(dt > 0) || dt > SCREEN_STEP_MAX_GAP_MS) return false;
	const d: number[] = [];
	for (let r = 0; r < 3; r++) {
		const x = a[1 + 3 * r] + a[2 + 3 * r] + a[3 + 3 * r];
		const y = b[1 + 3 * r] + b[2 + 3 * r] + b[3 + 3 * r];
		if (!(x >= brightnessFloor(x)) || !(y >= brightnessFloor(y))) return false;
		d.push((y - x) / x);
	}
	if (Math.sign(d[0]) !== Math.sign(d[1]) || Math.sign(d[1]) !== Math.sign(d[2])) return false;
	const size = d.map(Math.abs);
	const least = Math.min(...size);
	return (
		least > Math.max(SCREEN_STEP_MIN, (SCREEN_STEP_SLOPE_PER_S * dt) / 1000) &&
		Math.max(...size) <= SCREEN_STEP_RATIO * least
	);
}

/** Equal light steps in the OWN_PULSE_WINDOW_S window ending at `atMs`. */
export function screenSteps(samples: readonly (readonly number[])[], atMs: number): number {
	// One light change counts once: consecutive frames stepping the same way (auto exposure or white balance
	// easing over several frames) are one event; a screen cut lands in one frame.
	const from = atMs - OWN_PULSE_WINDOW_S * 1000;
	const bright = (s: readonly number[]) => s[1] + s[2] + s[3];
	let n = 0;
	let lastK = -2;
	let lastSign = 0;
	for (let k = 1; k < samples.length; k++) {
		const t = samples[k][0];
		if (t <= from || t > atMs) continue;
		if (!equalLightStep(samples[k - 1], samples[k]) || !levelHolds(samples, k)) continue;
		const sign = Math.sign(bright(samples[k]) - bright(samples[k - 1]));
		if (!(lastK === k - 1 && sign === lastSign)) n++;
		lastK = k;
		lastSign = sign;
	}
	return n;
}
const KEEP_MS = (OWN_PULSE_WINDOW_S + 2) * 1000;
/**
 * The wall and head checks look back over OWN_PULSE_STRONG_STREAK windows, so they keep that much
 * more: 22 s, of which the head's withhold needs 19 (four 16 s windows a second apart).
 */
const WALL_KEEP_MS = KEEP_MS + OWN_PULSE_STRONG_STREAK * EVAL_EVERY_MS;
const HISTORY_MAX = 120;
/**
 * A proven rate belongs to the face it was measured on. Once no face has reached the check
 * for this long, the rate is dropped and the proof starts over: the face that comes back may
 * be someone else, or in other light. One evaluation interval, so a rate is never shown for
 * longer than the check takes to re-judge it, while a one-frame face-finder dropout (a few
 * tens of ms) keeps it.
 */
const FACE_GONE_MS = EVAL_EVERY_MS;

/**
 * A proven rate handed from one check to the next across a camera restart (the camera ended while the page was hidden,
 * a lower resolution, a switch to another camera): the rate and the wall-clock time (Date.now) it was last proven. The
 * new camera's frames run on a new clock, so the time is on the wall clock. Read with resumePoint, given back with
 * createRppgSession's pulseCheckResume; the new check uses it as followRecent uses a break that kept the camera.
 */
export type PulseCheckResume = { bpm: number; atEpochMs: number };

export class PulseCheck {
	constructor(opts: {
		rules?: PulseCheckRules;
		/** The rate proven by the check before a camera restart (resumePoint of that check). */
		resumeFrom?: PulseCheckResume | null;
		/** The wall clock, Date.now unless a test sets it. */
		now?: () => number;
		/** For replay only: a hand-over already placed on the recording's frame clock (PulseCheckRecording.resume). */
		resumeAt?: { bpm: number; t: number } | null;
	} = {}) {
		this.rules = resolvePulseCheckRules(opts.rules);
		this.now = opts.now ?? Date.now;
		const r = opts.resumeFrom;
		if (r != null) {
			if (!(r.bpm > 0) || !Number.isFinite(r.bpm) || !Number.isFinite(r.atEpochMs))
				throw new RangeError(`pulseCheckResume needs a finite bpm above 0 and a finite atEpochMs, not ${JSON.stringify(r)}`);
			this.resumeFrom = { bpm: r.bpm, atEpochMs: r.atEpochMs };
		}
		if (opts.resumeAt != null) {
			this.followKept = { bpm: opts.resumeAt.bpm, t: opts.resumeAt.t };
			this.resumeSeed = { ...this.followKept };
		}
	}

	private readonly now: () => number;
	/** A hand-over not yet placed on this check's frame clock (placed at the first frame). */
	private resumeFrom: PulseCheckResume | null = null;
	/** The wall-clock time of followKept, for resumePoint. */
	private keptEpochMs: number | null = null;
	/** The hand-over as placed on this check's frame clock, kept for the recording; null when none was given. */
	resumeSeed: { bpm: number; t: number } | null = null;

	/** A hand-over was given and no frame has placed it yet. */
	get resumePending(): boolean {
		return this.resumeFrom != null;
	}

	/** The rate to hand to the check after a camera restart: the last proven rate and when, or null before one. */
	resumePoint(): PulseCheckResume | null {
		return this.followKept != null && this.keptEpochMs != null ? { bpm: this.followKept.bpm, atEpochMs: this.keptEpochMs } : null;
	}

	/** Which light rules this check runs (see PulseCheckRules). */
	readonly rules: ResolvedPulseCheckRules;

	/** The least wall against the face for green minus the wall: any wall seen (rule darkWall deleted 2026-10-30). */
	private get swapMinWall(): number {
		return 0;
	}

	private samples: RawRoiSample[] = [];
	private wall: [number, number, number, number][] = [];
	/** The room (roomFromFrame) as handed over, for rule roomLight, kept as long as the wall. */
	private room: [number, number, number, number][] = [];
	private head: HeadRow[] = [];
	/** A head argument (a position or null) has reached push since the last reset: the movement is judged. */
	private headHandedOver = false;
	private history: (OwnPulseEstimate | null)[] = [];
	private held: number | null = null;
	/** Rule blinkGate: the blinks seen since the face appeared. */
	private blinks = new BlinkDetector();
	/** Rule moreReadings (re-lock): the latest proven rate and when it was proven, or null. */
	private lastProven: { bpm: number; t: number } | null = null;
	/** Rule followRecent across a break: the last proven number, kept through a reset (FOLLOW_RESUME_MS). */
	private followKept: { bpm: number; t: number } | null = null;
	/** Rule followRecent: the last number the check proved, with its time. */
	private lastShown: { bpm: number; t: number } | null = null;
	/** The newest in-band follower value, or null (the state's followerBpm). */
	private followerBpm: number | null = null;
	private lastEvalMs: number | null = null;
	private lostSinceMs: number | null = null;
	private wallTally = { seen: 0, noRoom: 0, skin: 0 };
	private state: PulseCheckState = {
		verdict: "unknown",
		bpm: null,
		snrDb: null,
		streak: 0,
		wallMatch: false,
	};

	/**
	 * Whether a caller should compute push's diagnostics: when rule roomLight needs the room, and always in a
	 * RecordingPulseCheck, which keeps them. Otherwise they are skipped, at no cost.
	 */
	get wantsDiagnostics(): boolean {
		return this.rules.roomLight;
	}

	/**
	 * Rule blinkGate is satisfied: a blink has been seen since the face appeared, or the rule is off. The face frame
	 * source reuses a still face's landmarks for longer only then, so the gate is never starved of blink samples.
	 */
	get blinkGateOpen(): boolean {
		return !this.rules.blinkGate || this.blinks.seen;
	}

	/** Whether a caller should compute the 115 face patches for push's diagnostics: only a recording built to keep them. */
	get wantsFacePatches(): boolean {
		return false;
	}

	/**
	 * One frame: mean RGB of forehead, left cheek and right cheek, at the frame's timestamp,
	 * and optionally the mean RGB of a patch of wall beside the face (see the wall check), on one
	 * continuous scale across patches (WallTracker).
	 */
	push(
		timestampMs: number,
		regions: readonly Rgb[],
		wall?: Rgb,
		wallMiss?: WallMiss,
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
		diag?: PulseCheckFrameDiag,
	): void {
		if (regions.length < 3 || !Number.isFinite(timestampMs)) return;
		if (this.resumeFrom != null) {
			// The first frame after a camera restart: the rate proven before it, as old as the wall clock says.
			const r = this.resumeFrom;
			this.resumeFrom = null;
			if (this.followKept == null) {
				this.followKept = { bpm: r.bpm, t: timestampMs - (this.now() - r.atEpochMs) };
				this.keptEpochMs = r.atEpochMs;
				this.resumeSeed = { ...this.followKept };
			}
		}
		if (wall) this.wallTally.seen++;
		else if (wallMiss === "no-room") this.wallTally.noRoom++;
		else if (wallMiss === "skin") this.wallTally.skin++;
		// Frames that stopped arriving unannounced count as a lost face too: the windows would
		// otherwise run across the break.
		const last = this.samples[this.samples.length - 1];
		if (last && timestampMs - last[0] > FACE_GONE_MS) this.reset();
		this.lostSinceMs = null;
		const [f, l, r] = regions;
		this.samples.push([
			timestampMs,
			f.r,
			f.g,
			f.b,
			l.r,
			l.g,
			l.b,
			r.r,
			r.g,
			r.b,
			// The wall beside the face, for the colour-damage switch (OWN_PULSE_COLOUR_DAMAGE).
			wall?.r ?? Number.NaN,
			wall?.g ?? Number.NaN,
			wall?.b ?? Number.NaN,
			// And as the camera read it, for its brightness (rule darkWall, wallLevelSeen).
			wall ? (wallRaw ?? wall).r : Number.NaN,
			wall ? (wallRaw ?? wall).g : Number.NaN,
			wall ? (wallRaw ?? wall).b : Number.NaN,
		]);
		while (this.samples.length && this.samples[0][0] < timestampMs - KEEP_MS)
			this.samples.shift();
		if (wall) this.wall.push([timestampMs, wall.r, wall.g, wall.b]);
		while (this.wall.length && this.wall[0][0] < timestampMs - WALL_KEEP_MS)
			this.wall.shift();
		const room = this.rules.roomLight ? combineRoom(diag?.room) : null;
		if (room) this.room.push([timestampMs, room.r, room.g, room.b]);
		while (this.room.length && this.room[0][0] < timestampMs - WALL_KEEP_MS)
			this.room.shift();
		if (head !== undefined) this.headHandedOver = true;
		if (head?.blink != null && Number.isFinite(head.blink)) this.blinks.push(timestampMs, head.blink);
		if (head && Number.isFinite(head.x) && Number.isFinite(head.y) && Number.isFinite(head.faceWidth) && head.faceWidth > 0)
			this.head.push([timestampMs, head.x, head.y, head.faceWidth]);
		while (this.head.length && this.head[0][0] < timestampMs - WALL_KEEP_MS)
			this.head.shift();
		if (this.lastEvalMs == null) this.lastEvalMs = timestampMs;
		if (timestampMs - this.lastEvalMs < EVAL_EVERY_MS) return;
		this.lastEvalMs = timestampMs;
		const wallFrames = this.wallTally;
		this.wallTally = { seen: 0, noRoom: 0, skin: 0 };
		const est = estimateOwnPulse(this.samples, OWN_PULSE_WINDOW_S, timestampMs, OWN_PULSE_COLOUR_SWITCH, this.swapMinWall, this.rules.coherentFusion);
		if (est && (est as { skip?: boolean }).skip) return;
		// The wall's line for a window end, found once per evaluation: the taint, the wall check and
		// the state read the newest one, and the wall rows do not change while this runs.
		const lines = new Map<number, ReturnType<typeof wallLine>>();
		const lineAt = (ms: number) => {
			if (!lines.has(ms)) lines.set(ms, wallLine(this.wall, ms, false));
			return lines.get(ms) ?? null;
		};
		// A window whose rate the wall carries is the light's, not evidence of a pulse (lightTaint):
		// counted, it builds a streak under the light, and the rate shows the first second the wall
		// line dips. Its cost on real pulses was measured on recorded captures against a reference
		// pulse before it was added. The head's movement is judged the same way (headMotion).
		// Only a window whose head is seen and clear of the rate counts (fail-closed): a window the
		// head's rows do not cover could hide a nod, as the colour carries on while the mesh is not looking.
		// A window a stepping light on the face fills is not evidence either (screenLight): it only withholds.
		const windowScreenSteps = this.rules.screenLight ? screenSteps(this.samples, timestampMs) : null;
		const screenLit = est?.bpm != null && windowScreenSteps != null && windowScreenSteps >= SCREEN_STEPS_PER_WINDOW;
		// Rule roomLight: the room's line, found and judged exactly as the wall's.
		const roomLines = new Map<number, ReturnType<typeof wallLine>>();
		const roomLineAt = (ms: number) => {
			if (!this.rules.roomLight) return null;
			if (!roomLines.has(ms)) roomLines.set(ms, wallLine(this.room, ms, false));
			return roomLines.get(ms) ?? null;
		};
		const tainted =
			est?.bpm != null &&
			(screenLit || (this.rules.roomLight && roomCarries(roomLineAt(timestampMs), est.bpm)));
		this.history.push(tainted ? null : est);
		if (this.history.length > HISTORY_MAX) this.history.shift();
		let v = ownPulseVerdict(this.history, this.held, this.rules.restBand ? OWN_PULSE_EDGE_BPM : OWN_PULSE_LOW_BAND_BPM);
		// Rule moreReadings (re-lock): a streak that agrees with a rate proven moments ago is that rate again (relockVerdict).
		if (this.rules.moreReadings) v = relockVerdict(v, this.lastProven, timestampMs);
		this.held = v.verdict === "measured" ? v.bpm : null;
		if (v.verdict === "measured" && v.bpm != null) this.lastProven = { bpm: v.bpm, t: timestampMs };
		// The wall check only withholds; it never changes what the check itself has proven.
		// Judged over the last 4 one-second windows at once, not counted forward from the
		// moment of proof, so a lamp's rate is withheld from its first second.
		const held = this.held;
		const wallMatch =
			held != null &&
			Array.from({ length: OWN_PULSE_STRONG_STREAK }, (_, k) => k).every((k) =>
				lineCarries(lineAt(timestampMs - k * EVAL_EVERY_MS), held, this.rules),
			);
		const roomMatch =
			this.rules.roomLight &&
			held != null &&
			Array.from({ length: OWN_PULSE_STRONG_STREAK }, (_, k) => k).every((k) =>
				roomCarries(roomLineAt(timestampMs - k * EVAL_EVERY_MS), held),
			);
		this.followerBpm = null;
		this.state = wallMatch || roomMatch
			? {
					verdict: "not-measured",
					bpm: null,
					snrDb: v.snrDb,
					streak: v.streak,
					countingStreak: countingStreak(v, this.rules),
					wallMatch,
					...(this.rules.roomLight ? { roomMatch, roomLine: roomLineAt(timestampMs) } : {}),
					windowBpm: est?.bpm ?? null,
					windowSnrDb: est?.snrDb ?? null,
					windowMethod: est?.method ?? null,
					windowColourDamage: est?.colourDamage ?? null,
					windowWallSeen: est?.wallSeen ?? false,
					windowWallLevel: est?.wallLevel ?? null,
					windowWallToFace: est?.wallToFace ?? null,
					wallLine: lineAt(timestampMs),
					wallFrames,
				}
			: {
					verdict: v.verdict,
					bpm: this.shownRate(timestampMs),
					via: this.held != null ? "check" : null,
					snrDb: v.snrDb,
					streak: v.streak,
					countingStreak: countingStreak(v, this.rules),
					wallMatch,
					...(this.rules.roomLight ? { roomMatch, roomLine: roomLineAt(timestampMs) } : {}),
					windowBpm: est?.bpm ?? null,
					windowSnrDb: est?.snrDb ?? null,
					windowMethod: est?.method ?? null,
					windowColourDamage: est?.colourDamage ?? null,
					windowWallSeen: est?.wallSeen ?? false,
					windowWallLevel: est?.wallLevel ?? null,
					windowWallToFace: est?.wallToFace ?? null,
					wallLine: lineAt(timestampMs),
					wallFrames,
				};
		this.state.collecting = !this.samples.length || timestampMs - this.samples[0][0] < OWN_PULSE_WINDOW_S * 1000;
		this.state.windowFill = this.samples.length ? Math.min(1, (timestampMs - this.samples[0][0]) / (OWN_PULSE_WINDOW_S * 1000)) : 0;
		this.state.followerBpm = this.followerBpm;
		this.state.heldBpm = this.held;
		// Rule moreReadings: a streak long and strong enough to be the check's shortest accepted one, not yet proven.
		this.state.buildingBpm = this.rules.moreReadings
			? buildingRate({ ...v, verdict: this.state.bpm != null ? "measured" : "not-shown" }, wallMatch || roomMatch, buildingStreak(this.rules), this.rules.clearWindows)
			: null;
		if (this.state.buildingBpm != null && !steadyLightAllows(windowScreenSteps, this.rules)) this.state.buildingBpm = null;
		// Rule blinkGate: nothing shows until the eyes have blinked since the face appeared (a photo does not blink).
		if (this.rules.blinkGate && !this.blinks.seen && (this.state.bpm != null || this.state.buildingBpm != null)) {
			this.state.verdict = "not-measured";
			this.state.bpm = null;
			this.state.buildingBpm = null;
			this.state.waitingForBlink = true;
		}
		// Rule followRecent: nothing shows, the window is the same heart as a number shown moments ago.
		this.state.followBpm = null;
		// Anchored on a proven number only: following a building number carried wrong lab rates on (tools/follow.mjs).
		const own = this.state.verdict === "measured" && this.state.bpm != null ? this.state.bpm : null;
		if (own != null) {
			this.lastShown = { bpm: own, t: timestampMs };
			this.followKept = this.lastShown;
			this.keptEpochMs = this.now();
		} else if (this.rules.followRecent) {
			const blocked = this.state.waitingForBlink === true || wallMatch || roomMatch || !steadyLightAllows(windowScreenSteps, this.rules);
			this.state.followBpm = followRate(this.lastShown, timestampMs, est?.bpm, est?.snrDb, blocked);
			// Across a break: while the first window refills, the data so far against the number proven before it.
			const kept = this.followKept;
			const span = this.samples.length ? (timestampMs - this.samples[0][0]) / 1000 : 0;
			if (this.state.followBpm == null && this.state.collecting && !blocked && !screenLit && this.blinkGateOpen && kept != null &&
				timestampMs - kept.t <= FOLLOW_RESUME_MS && span >= FOLLOW_RESUME_MIN_S) {
				const e = estimateOwnPulse(this.samples, span, timestampMs, OWN_PULSE_COLOUR_SWITCH, this.swapMinWall, this.rules.coherentFusion);
				if (e && e.bpm != null && e.snrDb != null && e.snrDb >= FOLLOW_MIN_SNR_DB && e.agreeing.length >= FOLLOW_RESUME_REGIONS && Math.abs(e.bpm - kept.bpm) <= FOLLOW_BPM)
					this.state.followBpm = e.bpm;
			}
		}
		this.state.relockOpen = this.rules.moreReadings && this.lastProven != null && timestampMs - this.lastProven.t <= RELOCK_MS;
		this.state.windowScreenSteps = windowScreenSteps;
		this.state.screenLight = screenLit;
		this.evaluationCount += 1;
	}

	/** Consecutive evaluations in which the newest OWN_PULSE_SUPPORT_S seconds did not carry the proven rate. */
	private unsupported = 0;

	/**
	 * The rate to show once one is proven: the line in the newest OWN_PULSE_SUPPORT_S seconds when it sits
	 * within OWN_PULSE_TRACK_BPM of the proven rate, else the proven rate, and nothing once the newest
	 * window has not carried it for OWN_PULSE_SUPPORT_MISS evaluations in a row. The proof itself
	 * (this.held, the verdict, the hold) is unchanged.
	 */
	private shownRate(timestampMs: number): number | null {
		if (this.held == null) {
			this.unsupported = 0;
			return null;
		}
		const recent = estimateOwnPulse(
			this.samples,
			OWN_PULSE_SUPPORT_S,
			timestampMs,
			OWN_PULSE_COLOUR_SWITCH,
			this.swapMinWall,
			this.rules.coherentFusion,
		);
		const rate = recent?.bpmFine ?? recent?.bpm ?? null;
		if (rate != null && Math.abs(rate - this.held) <= OWN_PULSE_TRACK_BPM) {
			this.unsupported = 0;
			this.followerBpm = rate;
			return rate;
		}
		this.unsupported += 1;
		return this.unsupported >= OWN_PULSE_SUPPORT_MISS ? null : this.held;
	}

	/** A frame in which no face (no forehead and cheeks) was found. */
	faceLost(timestampMs: number): void {
		if (!Number.isFinite(timestampMs)) return;
		if (this.lostSinceMs == null) this.lostSinceMs = timestampMs;
		else if (timestampMs - this.lostSinceMs >= FACE_GONE_MS) this.reset();
	}

	getState(): PulseCheckState {
		return this.state;
	}

	/**
	 * How many times the check has judged a window (about once a second while frames arrive), counting
	 * from its creation; a reset does not clear it. A replay reads it to know which pushes produced a new
	 * state. Nothing in the check reads it.
	 */
	get evaluations(): number {
		return this.evaluationCount;
	}

	private evaluationCount = 0;

	reset(): void {
		this.room = [];
		this.samples = [];
		this.wall = [];
		this.head = [];
		this.headHandedOver = false;
		this.history = [];
		this.held = null;
		this.lastProven = null;
		this.lastShown = null;
		this.blinks.reset();
		this.followerBpm = null;
		this.lastEvalMs = null;
		this.lostSinceMs = null;
		this.wallTally = { seen: 0, noRoom: 0, skin: 0 };
		this.state = {
			verdict: "unknown",
			bpm: null,
			snrDb: null,
			streak: 0,
			wallMatch: false,
		};
	}
}

/**
 * How far the wall patch sits from the face's points, as a share of the face's width, tried in
 * this order. 0.15 clears hair on a face seen from the front. A side camera sees a turned head,
 * whose cheek, ear and neck reach well past the points, so the farther distances find wall
 * where the nearest patch is all skin.
 *
 * Value chosen by measurement on recorded captures against a reference pulse.
 */
export const WALL_GAPS = [0.15, 0.4, 0.7, 1.0] as const;

/**
 * The wall beside the face: the first of WALL_GAPS whose patch is mostly not skin, starting from
 * `preferIndex` (the distance that worked last frame), so the wall stays one patch while it can
 * and its brightness does not step between patches. Null when every distance shows skin.
 */
export function wallBesideFace(
	points: readonly { x: number; y: number }[],
	frame: Frame,
	preferIndex: number,
): { rgb: Rgb; gapIndex: number; patch: WallPatchDiag } | null {
	const order = [preferIndex, ...WALL_GAPS.map((_, i) => i).filter((i) => i !== preferIndex)];
	for (const i of order) {
		const gap = WALL_GAPS[i];
		if (gap == null) continue;
		const patch = wallPatchFromLandmarks(points, frame.width, frame.height, gap);
		if (!patch) continue;
		const x = Math.max(0, Math.min(frame.width - 1, patch.x));
		const y = Math.max(0, Math.min(frame.height - 1, patch.y));
		const w = Math.max(1, Math.min(frame.width - x, patch.w));
		const h = Math.max(1, Math.min(frame.height - y, patch.h));
		const m = averageRgbInROINonSkinCounted(frame, x, y, w, h);
		if (m) return { rgb: { r: m.r, g: m.g, b: m.b }, gapIndex: i, patch: [x, y, w, h, m.n] };
	}
	return null;
}

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
export class WallTracker {
	private gapIndex = 0;
	private current: number | null = null;
	private gain: Rgb = { r: 1, g: 1, b: 1 };
	private last: Rgb | null = null;

	/** The wall this frame on one continuous scale, and as read (see track), or null when none was found. */
	next(
		points: readonly { x: number; y: number }[],
		frame: Frame,
	): { rgb: Rgb; raw: Rgb; gapIndex: number; patch?: WallPatchDiag } | null {
		const w = wallBesideFace(points, frame, this.gapIndex);
		if (!w) return null;
		this.gapIndex = w.gapIndex;
		return { ...this.track(w.gapIndex, w.rgb), patch: w.patch };
	}

	/**
	 * Patch `gapIndex` read as `rgb`: `rgb` on one continuous scale (continuous), for the wall's
	 * rhythm, and `raw`, the patch as read, for its brightness. PulseCheck.push takes both.
	 */
	track(gapIndex: number, rgb: Rgb): { rgb: Rgb; raw: Rgb; gapIndex: number } {
		return { rgb: this.continuous(gapIndex, rgb), raw: rgb, gapIndex };
	}

	/** `rgb` from patch `gapIndex`, rescaled at a change of patch so the signal does not step. */
	continuous(gapIndex: number, rgb: Rgb): Rgb {
		if (gapIndex !== this.current) {
			const to = this.last ?? rgb;
			this.gain = {
				r: to.r / (rgb.r || 1e-6),
				g: to.g / (rgb.g || 1e-6),
				b: to.b / (rgb.b || 1e-6),
			};
			this.current = gapIndex;
		}
		this.last = { r: rgb.r * this.gain.r, g: rgb.g * this.gain.g, b: rgb.b * this.gain.b };
		return this.last;
	}
}

/** One upper corner of the room: mean RGB (0..1, to 7 decimals) of its non-skin pixels, and how many it averaged. */
export type RoomCorner = { rgb: Rgb; n: number };
/** The room, each upper corner on its own: a face reaching one corner changes only that corner's pixel set. */
export type RoomCorners = { left: RoomCorner | null; right: RoomCorner | null };
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
	light?: { face: { luma: number; redClip: number } | null; wanted: number; applied: number } | null;
	/**
	 * The 115 skin patches (facePatches.ts) this frame, only when the check keeps them (`wantsFacePatches`), recorded
	 * only; null when the frame had no mesh.
	 */
	facePatches?: FacePatches | null;
};


/** The wall patch as read this frame, for the recording only: x, y, w, h in pixels and how many non-skin pixels it averaged. */
export type WallPatchDiag = [number, number, number, number, number];

/** The room as one signal: the corners' pixel-weighted mean, or the one corner there is, or null. */
export function combineRoom(room: RoomCorners | null | undefined): Rgb | null {
	const parts = [room?.left, room?.right].filter((c): c is RoomCorner => c != null && c.n > 0);
	if (!parts.length) return null;
	const n = parts.reduce((a, c) => a + c.n, 0);
	return {
		r: parts.reduce((a, c) => a + c.rgb.r * c.n, 0) / n,
		g: parts.reduce((a, c) => a + c.rgb.g * c.n, 0) / n,
		b: parts.reduce((a, c) => a + c.rgb.b * c.n, 0) / n,
	};
}

/** Share of the frame's width and height each upper-corner patch of the room spans (roomFromFrame). */
export const ROOM_CORNER_SHARE = 0.2;
/** How far clear of the face box, as a share of the face's width, a room pixel must lie (roomFromFrame). */
export const ROOM_FACE_CLEAR = 0.5;
/**
 * roomFromFrame reads every ROOM_STRIDE-th pixel across and down. Measured (lane/wallroom, real frames with a 1% lamp,
 * dark, after VP9): the lamp's line against its noise was 95.6 reading every pixel, 77.6 at 2, 67.5 at 3, 62.6 at 4;
 * the room's noise is mostly shared between pixels, so a quarter of the pixels keeps 81% of it at a quarter of the
 * cost (an independent review measured the full read at about 1 to 3 ms a frame on a mid-range phone).
 */
export const ROOM_STRIDE = 2;

/**
 * The room: for each of the frame's two upper corners (each ROOM_CORNER_SHARE of the width and height), the mean RGB
 * (0..1, to 7 decimals) of its non-skin pixels, leaving out every pixel within ROOM_FACE_CLEAR face widths of the face
 * box, with how many pixels it averaged; a corner is null under 25 qualifying pixels or a tenth of those looked at, and
 * the whole is null when both are. Reads every ROOM_STRIDE-th pixel. The corners are kept apart because the face box
 * follows the mesh every frame: when a face reaches a corner, that corner's pixel set changes and its level can step,
 * while the other corner stays a constant set. Rule roomLight (off by default) reads it, combined (combineRoom).
 */
export function roomFromFrame(
	frame: Frame,
	points: readonly { x: number; y: number }[] | null | undefined,
): RoomCorners | null {
	const { width, height, data } = frame;
	if (width <= 0 || height <= 0) return null;
	// The face box from the points' extremes, in one pass with no allocation (percentiles are not needed: the box is
	// widened by ROOM_FACE_CLEAR face widths anyway, and sorting 478 points twice a frame cost about 164 KB of garbage).
	let fx0 = Number.POSITIVE_INFINITY, fy0 = Number.POSITIVE_INFINITY, fx1 = Number.NEGATIVE_INFINITY, fy1 = Number.NEGATIVE_INFINITY;
	if (points?.length) {
		let x0 = Number.POSITIVE_INFINITY, x1 = Number.NEGATIVE_INFINITY, y0 = Number.POSITIVE_INFINITY, y1 = Number.NEGATIVE_INFINITY;
		for (const p of points) {
			const x = Math.min(1, Math.max(0, p.x)) * width, y = Math.min(1, Math.max(0, p.y)) * height;
			if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
		}
		const clear = (x1 - x0) * ROOM_FACE_CLEAR;
		fx0 = x0 - clear; fx1 = x1 + clear; fy0 = y0 - clear; fy1 = y1 + clear;
	}
	const cw = Math.max(1, Math.floor(width * ROOM_CORNER_SHARE));
	const ch = Math.max(1, Math.floor(height * ROOM_CORNER_SHARE));
	// Each value to 7 decimals, so what a recording keeps is exactly what the check used (live and replay agree).
	const r7 = (v: number) => Math.round(v * 1e7) / 1e7;
	const corner = (xStart: number): RoomCorner | null => {
		let sumR = 0, sumG = 0, sumB = 0, n = 0, count = 0;
		for (let row = 0; row < ch; row += ROOM_STRIDE) {
			for (let col = xStart; col < xStart + cw; col += ROOM_STRIDE) {
				if (col >= fx0 && col <= fx1 && row >= fy0 && row <= fy1) continue;
				count++;
				const idx = (row * width + col) * 4;
				const r = (data as any)[idx], g = (data as any)[idx + 1], b = (data as any)[idx + 2];
				const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
				const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
				if (cb >= 77 && cb <= 127 && cr >= 133 && cr <= 173) continue;
				sumR += r; sumG += g; sumB += b; n++;
			}
		}
		if (n < Math.max(25, count * 0.1)) return null;
		return { rgb: { r: r7(sumR / n / 255), g: r7(sumG / n / 255), b: r7(sumB / n / 255) }, n };
	};
	const left = corner(0), right = corner(width - cw);
	return left || right ? { left, right } : null;
}


/**
 * Why wallBesideFace found nothing: "no-room" when no distance leaves a patch inside the frame
 * (the face fills it), otherwise "skin" (every patch looked like skin: an ear or neck, or a
 * beige or wooden wall, or warm light making the wall skin-coloured).
 */
export function wallMissReason(
	points: readonly { x: number; y: number }[],
	width: number,
	height: number,
): WallMiss {
	return WALL_GAPS.some((g) => wallPatchFromLandmarks(points, width, height, g))
		? "skin"
		: "no-room";
}

/**
 * A patch of wall beside the face for the wall check, in pixels, or null when there is no
 * room for one (a face that fills the frame). At cheek height (the middle third of the face),
 * a quarter of the face wide, `gap` of the face's width clear of its edge (WALL_GAPS), on
 * whichever side has more room. The face's edges are taken at the 5th and 95th percentile of
 * the points across and the 3rd and 97th down, so a single stray point cannot move the patch.
 */
export function wallPatchFromLandmarks(
	points: readonly { x: number; y: number }[],
	width: number,
	height: number,
	gap: number = WALL_GAPS[0],
): { x: number; y: number; w: number; h: number } | null {
	if (!points.length || width <= 0 || height <= 0) return null;
	const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
	const xs = points.map((p) => clamp01(p.x) * width).sort((a, b) => a - b);
	const ys = points.map((p) => clamp01(p.y) * height).sort((a, b) => a - b);
	const pick = (v: number[], q: number) =>
		v[Math.min(v.length - 1, Math.max(0, Math.floor((v.length - 1) * q)))];
	const x0 = pick(xs, 0.05);
	const y0 = pick(ys, 0.03);
	const fw = Math.max(1, pick(xs, 0.95) - x0);
	const fh = Math.max(1, pick(ys, 0.97) - y0);
	const w = fw * 0.25;
	const clear = fw * gap;
	const y = y0 + fh / 3;
	const h = fh / 3;
	if (y < 0 || y + h > height) return null;
	const roomLeft = x0 - clear;
	const roomRight = width - (x0 + fw + clear);
	let x: number | null = null;
	if (roomLeft >= roomRight && roomLeft >= w) x = roomLeft - w;
	else if (roomRight > roomLeft && roomRight >= w) x = x0 + fw + clear;
	if (x == null) return null;
	return {
		x: Math.round(x),
		y: Math.round(y),
		w: Math.max(1, Math.round(w)),
		h: Math.max(1, Math.round(h)),
	};
}
