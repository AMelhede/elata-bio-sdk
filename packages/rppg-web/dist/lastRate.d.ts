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
/** Keeps a rate proven on this face; a storage failure changes nothing. */
export declare function writeLastReading(store: LastRateStore | null | undefined, r: LastReading): void;
//# sourceMappingURL=lastRate.d.ts.map