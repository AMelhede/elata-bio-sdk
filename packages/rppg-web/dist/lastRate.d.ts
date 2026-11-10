/**
 * The person's last proven heart rate on this device, kept between sessions (createRppgSession option rememberRate,
 * on unless false). A new session starts from it: the check confirms a rate within FOLLOW_BPM of it, as after a break
 * (pulseCheckResume with LAST_RATE_MAX_AGE_MS), so the first number comes sooner when the heart is near it, and the
 * display can show it with its age until a new number exists (PulseDisplay.setLast). It only gates: the number shown is
 * always the face's own window. Kept in the app's own storage on the device; the library sends nothing.
 */
import type { PulseCheckResume } from "./pulseCheck.js";
export declare const LAST_RATE_KEY = "elata-rppg:last-rate";
/**
 * How old the kept rate may be: 24 h. Recorded sessions handed the same person's previous session on the same device
 * (test-page phone and laptop recordings, 2026-10-31): extra early numbers within 5 bpm or 10% of the next proven number
 * 177 of 186 at under 24 h, none over 10; older than a day too few sessions to judge, so not used.
 */
export declare const LAST_RATE_MAX_AGE_MS: number;
/** The storage the rate is kept in: localStorage, or an app's own with the same two calls. */
export type LastRateStore = Pick<Storage, "getItem" | "setItem">;
export type LastReading = {
    bpm: number;
    atEpochMs: number;
};
/** The browser's localStorage, or null where there is none or reading it throws (private windows, blocked storage). */
export declare function defaultLastRateStore(): LastRateStore | null;
/** The kept reading, or null when there is none, it is too old or from the future, or storage fails. */
export declare function readLastReading(store: LastRateStore | null | undefined, nowMs: number): LastReading | null;
/** The kept reading as the next session's hand-over. */
export declare function lastReadingResume(r: LastReading | null): PulseCheckResume | null;
/**
 * The person's own rate: every session's last proven rate is kept (up to PERSONAL_RATE_SESSIONS, none older than
 * PERSONAL_RATE_MAX_AGE_MS), and the rate is their recency-weighted median, each session weighing half as much per
 * PERSONAL_RATE_HALF_LIFE_DAYS of age: a resting level that drifts (fitness, season, illness) is followed within days
 * while one odd session cannot move it, and a history of any length is used without a cut-off. The spread is the
 * person's own (1.48 x the weighted median absolute deviation, PERSONAL_SPREAD_MIN..MAX bpm) once
 * PERSONAL_SPREAD_MIN_SESSIONS sessions exist. Screened per person and device on received files spanning about four
 * weeks (evsave TRIED 2026-11-09, F2 pp7): half-lives 7 to 90 days and none scored alike there (prior off the session's
 * rate median 4.4 to 4.6 bpm), so 30 days follows a real drift in weeks; the own spread brought the first number 17 to
 * 15 s at the same references. About 30 bytes a session.
 */
export declare const PERSONAL_RATE_SESSIONS = 400;
export declare const PERSONAL_RATE_MAX_AGE_MS: number;
export declare const PERSONAL_RATE_HALF_LIFE_DAYS = 30;
export declare const PERSONAL_SPREAD_MIN = 6;
export declare const PERSONAL_SPREAD_MAX = 15;
export declare const PERSONAL_SPREAD_MIN_SESSIONS = 4;
/** The person's own rate and spread on this device, or null with no usable history. */
export declare function readPersonalPrior(store: LastRateStore | null | undefined, nowMs: number): {
    bpm: number;
    sd: number | null;
} | null;
/** The person's own rate on this device (readPersonalPrior's rate), or null. */
export declare function readPersonalRate(store: LastRateStore | null | undefined, nowMs: number): number | null;
/**
 * Keeps a rate proven on this face; a storage failure changes nothing. `sessionMs` names the session (its start), so
 * each session keeps one entry, its latest rate, among the person's recent sessions.
 */
export declare function writeLastReading(store: LastRateStore | null | undefined, r: LastReading, sessionMs?: number): void;
//# sourceMappingURL=lastRate.d.ts.map