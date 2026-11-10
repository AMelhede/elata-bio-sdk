/**
 * The person's last proven heart rate on this device, kept between sessions (createRppgSession option rememberRate,
 * on unless false). A new session starts from it: the check confirms a rate within FOLLOW_BPM of it, as after a break
 * (pulseCheckResume with LAST_RATE_MAX_AGE_MS), so the first number comes sooner when the heart is near it, and the
 * display can show it with its age until a new number exists (PulseDisplay.setLast). It only gates: the number shown is
 * always the face's own window. Kept in the app's own storage on the device; the library sends nothing.
 */
import type { PulseCheckResume } from "./pulseCheck";

export const LAST_RATE_KEY = "elata-rppg:last-rate";

/**
 * How old the kept rate may be: 24 h. Recorded sessions handed the same person's previous session on the same device
 * (test-page phone and laptop recordings, 2026-10-31): extra early numbers within 5 bpm or 10% of the next proven number
 * 177 of 186 at under 24 h, none over 10; older than a day too few sessions to judge, so not used.
 */
export const LAST_RATE_MAX_AGE_MS = 24 * 3_600_000;

/** The storage the rate is kept in: localStorage, or an app's own with the same two calls. */
export type LastRateStore = Pick<Storage, "getItem" | "setItem">;

export type LastReading = { bpm: number; atEpochMs: number };

/** The browser's localStorage, or null where there is none or reading it throws (private windows, blocked storage). */
export function defaultLastRateStore(): LastRateStore | null {
	try {
		const s = (globalThis as { localStorage?: LastRateStore }).localStorage;
		return s ?? null;
	} catch {
		return null;
	}
}

/** The kept reading, or null when there is none, it is too old or from the future, or storage fails. */
export function readLastReading(store: LastRateStore | null | undefined, nowMs: number): LastReading | null {
	try {
		const raw = store?.getItem(LAST_RATE_KEY);
		if (!raw) return null;
		const v = JSON.parse(raw) as Partial<LastReading>;
		if (typeof v.bpm !== "number" || !(v.bpm > 0) || !Number.isFinite(v.bpm)) return null;
		if (typeof v.atEpochMs !== "number" || !Number.isFinite(v.atEpochMs)) return null;
		const age = nowMs - v.atEpochMs;
		if (age < 0 || age > LAST_RATE_MAX_AGE_MS) return null;
		return { bpm: v.bpm, atEpochMs: v.atEpochMs };
	} catch {
		return null;
	}
}

/** The kept reading as the next session's hand-over. */
export function lastReadingResume(r: LastReading | null): PulseCheckResume | null {
	return r ? { bpm: r.bpm, atEpochMs: r.atEpochMs, maxAgeMs: LAST_RATE_MAX_AGE_MS } : null;
}

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
export const PERSONAL_RATE_SESSIONS = 400;
export const PERSONAL_RATE_MAX_AGE_MS = 365 * 24 * 3_600_000;
export const PERSONAL_RATE_HALF_LIFE_DAYS = 30;
export const PERSONAL_SPREAD_MIN = 6;
export const PERSONAL_SPREAD_MAX = 15;
export const PERSONAL_SPREAD_MIN_SESSIONS = 4;
type KeptEntry = { s: number; bpm: number; at: number };
function keptEntries(raw: string | null | undefined): KeptEntry[] {
	if (!raw) return [];
	try {
		const v = JSON.parse(raw) as { recent?: unknown; bpm?: unknown; atEpochMs?: unknown };
		const ok = (e: Partial<KeptEntry>) => typeof e.bpm === "number" && e.bpm > 0 && Number.isFinite(e.bpm) && typeof e.at === "number" && Number.isFinite(e.at) && typeof e.s === "number";
		if (Array.isArray(v.recent)) return (v.recent as Partial<KeptEntry>[]).filter(ok) as KeptEntry[];
		// A store written before the person's rate was kept: its one reading is one session.
		if (typeof v.bpm === "number" && typeof v.atEpochMs === "number") return [{ s: v.atEpochMs, bpm: v.bpm, at: v.atEpochMs }].filter(ok);
	} catch {
		/* unreadable: nothing kept */
	}
	return [];
}
function weightedMedian(xs: Array<[number, number]>): number {
	const o = [...xs].sort((a, b) => a[0] - b[0]);
	const half = o.reduce((t, [, w]) => t + w, 0) / 2;
	let c = 0;
	for (const [x, w] of o) {
		c += w;
		if (c >= half) return x;
	}
	return o[o.length - 1][0];
}

/** The person's own rate and spread on this device, or null with no usable history. */
export function readPersonalPrior(store: LastRateStore | null | undefined, nowMs: number): { bpm: number; sd: number | null } | null {
	try {
		const e = keptEntries(store?.getItem(LAST_RATE_KEY)).filter((x) => x.at <= nowMs && nowMs - x.at <= PERSONAL_RATE_MAX_AGE_MS);
		if (!e.length) return null;
		const w = e.map((x) => [x.bpm, 0.5 ** ((nowMs - x.at) / 86_400_000 / PERSONAL_RATE_HALF_LIFE_DAYS)] as [number, number]);
		const bpm = weightedMedian(w);
		const sd = e.length >= PERSONAL_SPREAD_MIN_SESSIONS
			? Math.min(PERSONAL_SPREAD_MAX, Math.max(PERSONAL_SPREAD_MIN, 1.48 * weightedMedian(w.map(([x, k]) => [Math.abs(x - bpm), k]))))
			: null;
		return { bpm, sd };
	} catch {
		return null;
	}
}

/** The person's own rate on this device (readPersonalPrior's rate), or null. */
export function readPersonalRate(store: LastRateStore | null | undefined, nowMs: number): number | null {
	return readPersonalPrior(store, nowMs)?.bpm ?? null;
}

/**
 * Keeps a rate proven on this face; a storage failure changes nothing. `sessionMs` names the session (its start), so
 * each session keeps one entry, its latest rate, among the person's recent sessions.
 */
export function writeLastReading(store: LastRateStore | null | undefined, r: LastReading, sessionMs?: number): void {
	try {
		const bpm = Math.round(r.bpm * 10) / 10;
		const s = sessionMs ?? r.atEpochMs;
		const recent = keptEntries(store?.getItem(LAST_RATE_KEY)).filter((x) => x.s !== s);
		recent.push({ s, bpm, at: r.atEpochMs });
		store?.setItem(LAST_RATE_KEY, JSON.stringify({ bpm, atEpochMs: r.atEpochMs, recent: recent.slice(-PERSONAL_RATE_SESSIONS) }));
	} catch {
		/* private mode or full storage: the next session starts from nothing, as before */
	}
}
