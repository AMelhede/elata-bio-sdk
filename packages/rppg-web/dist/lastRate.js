export const LAST_RATE_KEY = "elata-rppg:last-rate";
/**
 * How old the kept rate may be: 24 h. Recorded sessions handed the same person's previous session on the same device
 * (test-page phone and laptop recordings, 2026-10-31): extra early numbers within 5 bpm or 10% of the next proven number
 * 177 of 186 at under 24 h, none over 10; older than a day too few sessions to judge, so not used.
 */
export const LAST_RATE_MAX_AGE_MS = 24 * 3600000;
/** The browser's localStorage, or null where there is none or reading it throws (private windows, blocked storage). */
export function defaultLastRateStore() {
    try {
        const s = globalThis.localStorage;
        return s ?? null;
    }
    catch {
        return null;
    }
}
/** The kept reading, or null when there is none, it is too old or from the future, or storage fails. */
export function readLastReading(store, nowMs) {
    try {
        const raw = store?.getItem(LAST_RATE_KEY);
        if (!raw)
            return null;
        const v = JSON.parse(raw);
        if (typeof v.bpm !== "number" || !(v.bpm > 0) || !Number.isFinite(v.bpm))
            return null;
        if (typeof v.atEpochMs !== "number" || !Number.isFinite(v.atEpochMs))
            return null;
        const age = nowMs - v.atEpochMs;
        if (age < 0 || age > LAST_RATE_MAX_AGE_MS)
            return null;
        return { bpm: v.bpm, atEpochMs: v.atEpochMs };
    }
    catch {
        return null;
    }
}
/** The kept reading as the next session's hand-over. */
export function lastReadingResume(r) {
    return r ? { bpm: r.bpm, atEpochMs: r.atEpochMs, maxAgeMs: LAST_RATE_MAX_AGE_MS } : null;
}
/** Keeps a rate proven on this face; a storage failure changes nothing. */
export function writeLastReading(store, r) {
    try {
        store?.setItem(LAST_RATE_KEY, JSON.stringify({ bpm: Math.round(r.bpm * 10) / 10, atEpochMs: r.atEpochMs }));
    }
    catch {
        /* private mode or full storage: the next session starts from nothing, as before */
    }
}
