#!/usr/bin/env node
// strap-score: scores the demo page's "Save readings" file (one row per second) against a chest strap.
//
// It lines the two files up by clock time, searches a small lag, builds a reference heart rate for every second from
// the strap's beat-to-beat (RR) intervals, and reports how often the page showed a number, how often that number was
// right, and how far off it was. No dependencies; Node 18 or newer. Run with --help for usage.
//
// Before it scores anything it runs its own self-checks on synthetic files with known answers (see selfCheck()).
// SELFCHECK_BREAK=<name> breaks one check on purpose so it can be seen to fail. Names: known, shift, formats,
// overlap, flat, tz.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------------------------------------------
// Constants, each with its reason.

/** Lag searched, in seconds, either way. Both clocks on automatic time agree to about a second; the rest of the
 * range absorbs a start time typed by hand and the page's own display delay. Set by the test brief. */
const MAX_LAG_S = 15;
/** Reference window in seconds. A 5 s mean of the strap's beats, not the instantaneous beat rate: breathing alone
 * swings the beat-to-beat rate by several bpm in a calm person (respiratory sinus arrhythmia), and the page shows a
 * rate estimated over a window of several seconds, so the instantaneous rate would mark a correct page wrong. The
 * instantaneous rate is still reported, as a second line. */
const REF_WINDOW_S = 5;
/** A window needs at least this many seconds of clean beats, or that second has no reference (a strap dropout). */
const REF_MIN_COVER_S = 3;
/** "Right": within 5 bpm, this repository's convention (docs/evidence/README.md). */
const RIGHT_BPM = 5;
/** Also reported: within 10 percent. "Wrong" means outside BOTH, i.e. outside the heart-rate meter bar of
 * ANSI/AAMI EC13 (now IEC 60601-2-27): within 10 percent or 5 bpm, whichever is greater. */
const RIGHT_FRACTION = 0.1;
/** RR intervals outside 250 to 2000 ms (240 to 30 bpm) are not heartbeats a seated adult has. */
const RR_MIN_MS = 250;
const RR_MAX_MS = 2000;
/** An RR interval more than 20 percent away from the median of its four neighbours is treated as a missed or extra
 * beat and dropped (the common 20 percent rule for RR artefacts). */
const RR_NEIGHBOUR_FRACTION = 0.2;
/** Phone-stamped RR formats: a jump of more than this between the stamp and the running sum of RR starts a new
 * segment (a dropout or removed beats). Normal Bluetooth batching moves it by up to about one second. */
const ANCHOR_SPLIT_MS = 2000;
/** Lag search score: mean absolute difference, each second capped at 20 bpm so a few wild seconds cannot pick
 * the lag. */
const LAG_CAP_BPM = 20;
/** A lag is only scored when at least this many seconds have both a page number and a reference. */
const LAG_MIN_PAIRS = 20;
/** "Clearly better than its neighbours": the best lag must beat every lag 3 s or more away (adjacent lags are always
 * close, heart rate changes slowly) by more than chance. The per-second differences are averaged in 10 s blocks first,
 * because neighbouring seconds are not independent: the page estimates over a window of about 8 s and the reference
 * over 5 s. The best lag must win with a t statistic of at least 3 over at least 5 blocks. A fixed bpm margin was tried
 * first and refused an accurate page whose rate barely changed; the t rule asks the actual question (could noise have
 * produced this minimum?). The 3 is a choice, checked here only on synthetic files ("known", "shift", "flat"). */
const LAG_FAR_S = 3;
const LAG_BLOCK_S = 10;
const LAG_MIN_BLOCKS = 5;
const LAG_MIN_T = 3;
/** Too little overlap to say anything. */
const MIN_OVERLAP_S = 30;

const DEMO_HEADER = 'epoch_ms,iso_time,bpm_shown,confidence,library_version';

// ---------------------------------------------------------------------------------------------------------------
// Time zones. Strap apps write local clock time, usually with no zone; the page writes UTC epoch milliseconds.

/** Offset of `tz` from UTC in ms at instant `epochMs`. `tz` is "UTC", "+02:00", "-0530" or an IANA name. */
export function tzOffsetMs(tz, epochMs) {
	if (/^(utc|gmt|z)$/i.test(tz)) return 0;
	const m = /^([+-])(\d{2}):?(\d{2})$/.exec(tz);
	if (m) return (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) * 60000;
	const parts = new Intl.DateTimeFormat('en-US', {
		timeZone: tz,
		hourCycle: 'h23',
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit',
	}).formatToParts(new Date(epochMs));
	const g = (t) => Number(parts.find((p) => p.type === t).value);
	const asUtc = Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute'), g('second'));
	return asUtc - Math.floor(epochMs / 1000) * 1000;
}

/** Local wall-clock fields in zone `tz` to epoch ms. */
export function localToEpoch(f, tz) {
	const naive = Date.UTC(f.y, f.mo - 1, f.d, f.h, f.mi, f.s, f.ms || 0);
	let guess = naive - tzOffsetMs(tz, naive);
	guess = naive - tzOffsetMs(tz, guess);
	return guess;
}

/** Parses "2026-10-12 14:03:05.123", "2026-10-12T14:03:05", optional zone (Z, +02:00, +0200, UTC). */
function parseStamp(str) {
	const m =
		/^\s*(\d{4})-(\d{2})-(\d{2})[T ](\d{1,2}):(\d{2}):(\d{2})(?:[.,](\d+))?\s*(Z|UTC|GMT|[+-]\d{2}:?\d{2})?\s*$/i.exec(
			str,
		);
	if (!m) return null;
	const frac = m[7] ? Number(`0.${m[7]}`) * 1000 : 0;
	return {
		f: { y: +m[1], mo: +m[2], d: +m[3], h: +m[4], mi: +m[5], s: +m[6], ms: Math.round(frac) },
		zone: m[8] || null,
	};
}

class NeedsInput extends Error {}

function stampToEpoch(str, tz, what) {
	const p = parseStamp(str);
	if (!p) throw new Error(`cannot read the time "${str}" in ${what}`);
	const zone = p.zone || tz;
	if (!zone)
		throw new NeedsInput(
			`${what} writes local clock times with no time zone ("${str.trim()}"). Pass --tz with the phone's zone, ` +
				'for example --tz Europe/Stockholm or --tz +02:00.',
		);
	return localToEpoch(p.f, zone);
}

// ---------------------------------------------------------------------------------------------------------------
// Strap file readers. Each returns { format, beats: [{t, rr}] } (t = beat end, epoch ms) or { format, hr: Map }.

const num = (s) => (s != null && s.trim() !== '' && Number.isFinite(Number(s)) ? Number(s) : null);

function splitRow(line, sep) {
	return line.split(sep).map((c) => c.trim().replace(/^"(.*)"$/, '$1'));
}

/** RR values to ms: a median above 10 means milliseconds, below means seconds. */
function toMs(values) {
	const sorted = [...values].sort((a, b) => a - b);
	const med = sorted[Math.floor(sorted.length / 2)];
	return med > 10 ? values : values.map((v) => v * 1000);
}

/** Phone-stamped RR: each beat carries the time the phone RECEIVED it, which is at or after the beat and often in
 * batches. The running sum of RR keeps the spacing exact; its anchor is the earliest-arriving beats (2nd percentile of
 * stamp minus running sum) within each segment between dropouts. */
function anchorBeats(stamps, rrs) {
	const n = rrs.length;
	const cum = new Array(n);
	let c = 0;
	for (let i = 0; i < n; i++) cum[i] = c += rrs[i];
	const off = stamps.map((s, i) => s - cum[i]);
	const t = new Array(n);
	let start = 0;
	const flush = (end) => {
		const seg = off.slice(start, end).sort((a, b) => a - b);
		const anchor = seg[Math.floor((seg.length - 1) * 0.02)];
		for (let i = start; i < end; i++) t[i] = cum[i] + anchor;
	};
	for (let i = 1; i <= n; i++) {
		if (i === n || Math.abs(off[i] - off[i - 1]) > ANCHOR_SPLIT_MS) {
			flush(i);
			start = i;
		}
	}
	return t.map((ti, i) => ({ t: ti, rr: rrs[i] }));
}

/** Plain RR list with a known start: beat k ends at start + sum of the first k intervals. */
function beatsFromStart(startMs, rrs) {
	let t = startMs;
	return rrs.map((rr) => ({ t: (t += rr), rr }));
}

function resolveStart(opts, file, needWhat) {
	if (opts.start) {
		const p = parseStamp(opts.start);
		if (!p) throw new Error(`cannot read --start "${opts.start}" (use 2026-10-12T14:03:05+02:00)`);
		return { ms: localToEpoch(p.f, p.zone || requireTz(opts, '--start')), from: '--start' };
	}
	// Elite HRV names each file by the reading's local date and time: "2015-05-12 07-48-32".
	const m = /(\d{4})-(\d{2})-(\d{2})[ _T](\d{2})[-:.](\d{2})[-:.](\d{2})/.exec(path.basename(file));
	if (m) {
		const f = { y: +m[1], mo: +m[2], d: +m[3], h: +m[4], mi: +m[5], s: +m[6] };
		return { ms: localToEpoch(f, requireTz(opts, 'the file name')), from: 'file name' };
	}
	throw new NeedsInput(
		`${needWhat} has no clock times. Pass --start with when the strap recording started, for example ` +
			'--start 2026-10-12T14:03:05+02:00.',
	);
}

function requireTz(opts, what) {
	if (!opts.tz)
		throw new NeedsInput(`${what} is local clock time with no zone. Pass --tz, for example --tz Europe/Stockholm.`);
	return opts.tz;
}

export function readStrap(text, file, opts = {}) {
	text = text.replace(/^﻿/, '');
	const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
	if (lines.length === 0) throw new Error(`${file} is empty`);
	const head = lines[0];

	// Polar Flow training-session CSV (also what a Polar Beat session exports once synced to Flow). Line 1 is a
	// summary header (Name,Sport,Date,Start time,...), line 2 its values, line 3 the sample header
	// (Sample rate,Time,HR (bpm),...), then one row per second with Time as elapsed HH:MM:SS. Date is dd-mm-yyyy and
	// Start time is local, with no zone.
	if (/^Name,Sport,Date,Start time/i.test(head)) {
		const h = splitRow(head, ',');
		const v = splitRow(lines[1], ',');
		const date = v[h.findIndex((c) => /^date$/i.test(c))];
		const time = v[h.findIndex((c) => /^start time$/i.test(c))];
		const dm = /^(\d{1,2})[-./](\d{1,2})[-./](\d{4})$/.exec(date) || null;
		const im = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
		const tm = /^(\d{1,2}):(\d{2}):(\d{2})$/.exec(time);
		if (!(dm || im) || !tm) throw new Error(`cannot read Polar Flow Date "${date}" / Start time "${time}"`);
		const f = dm
			? { y: +dm[3], mo: +dm[2], d: +dm[1], h: +tm[1], mi: +tm[2], s: +tm[3] }
			: { y: +im[1], mo: +im[2], d: +im[3], h: +tm[1], mi: +tm[2], s: +tm[3] };
		const start = localToEpoch(f, requireTz(opts, 'Polar Flow Start time'));
		const si = lines.findIndex((l) => /^Sample rate,Time,HR/i.test(l));
		if (si < 0) throw new Error('Polar Flow file has no "Sample rate,Time,HR (bpm)" table');
		const sh = splitRow(lines[si], ',');
		const ti = sh.findIndex((c) => /^time$/i.test(c));
		const hi = sh.findIndex((c) => /^HR/i.test(c));
		const hr = new Map();
		for (const line of lines.slice(si + 1)) {
			const c = splitRow(line, ',');
			const tt = /^(\d+):(\d{2}):(\d{2})$/.exec(c[ti] || '');
			const bpm = num(c[hi]);
			if (!tt || bpm == null || bpm <= 0) continue;
			const sec = Math.floor((start + ((+tt[1] * 60 + +tt[2]) * 60 + +tt[3]) * 1000) / 1000);
			hr.set(sec, bpm);
		}
		return { format: 'Polar Flow CSV (per-second HR)', hr };
	}

	const sep = head.includes(';') ? ';' : head.includes('\t') ? '\t' : ',';
	const cols = splitRow(head, sep).map((c) => c.toLowerCase());

	// Polar Sensor Logger (and similar): "Phone timestamp;RR-interval [ms]", local ISO time, e.g.
	// 2023-02-01T17:32:42.608;802. Its HR file has an "HR [bpm]" column instead; that is used only if no RR.
	if (cols[0] === 'phone timestamp') {
		const rows = lines.slice(1).map((l) => splitRow(l, sep));
		const ri = cols.findIndex((c) => c.startsWith('rr-interval'));
		if (ri >= 0) {
			const stamps = rows.map((r) => stampToEpoch(r[0], opts.tz, 'Polar Sensor Logger'));
			return { format: 'Polar Sensor Logger RR', beats: anchorBeats(stamps, rows.map((r) => Number(r[ri]))) };
		}
		const hi = cols.findIndex((c) => c.startsWith('hr'));
		if (hi < 0) throw new Error('Polar Sensor Logger file has neither an RR nor an HR column');
		const acc = new Map();
		for (const r of rows) {
			const sec = Math.floor(stampToEpoch(r[0], opts.tz, 'Polar Sensor Logger') / 1000);
			const v = num(r[hi]);
			if (v == null || v <= 0) continue;
			const a = acc.get(sec) || [0, 0];
			acc.set(sec, [a[0] + v, a[1] + 1]);
		}
		return { format: 'Polar Sensor Logger HR', hr: new Map([...acc].map(([s, [sum, n]]) => [s, sum / n])) };
	}

	// HRV Logger RR file: "date,rr,since start" (newer versions name the first column "timestamp"). One row per beat,
	// a clock stamp per beat, RR in ms. With artefact removal on, "since start" drifts from the stamps, so the stamps
	// anchor the beats and the RR values space them.
	if ((cols[0] === 'date' || cols[0] === 'timestamp') && cols.includes('rr')) {
		const ri = cols.indexOf('rr');
		const rows = lines.slice(1).map((l) => splitRow(l, sep));
		const stamps = rows.map((r) => {
			const n = num(r[0]);
			if (n != null) return n > 1e12 ? n : n * 1000; // epoch ms or epoch s
			return stampToEpoch(r[0], opts.tz, 'HRV Logger');
		});
		return { format: 'HRV Logger RR', beats: anchorBeats(stamps, toMs(rows.map((r) => Number(r[ri])))) };
	}

	// Kubios: a report with an "RR Intervals" section, or a series export with "#" comment lines. No clock times.
	const isKubios = /kubios/i.test(text) || lines.some((l) => l.trim().startsWith('#'));
	let body = lines.filter((l) => !l.trim().startsWith('#'));
	if (isKubios) {
		const k = body.findIndex((l) => /RR Interval/i.test(l));
		if (k >= 0) body = body.slice(k + 1).filter((l) => !/^-+$/.test(l.trim()));
		body = body.filter((l) => /^[\s\d.,;\t-]+$/.test(l) && /\d/.test(l));
	}
	const numeric = body.map((l) => l.trim().split(/[\s,;]+/).map(Number));
	if (numeric.length > 0 && numeric.every((r) => r.every(Number.isFinite))) {
		const width = numeric[0].length;
		const label = isKubios ? 'Kubios' : /\d{4}-\d{2}-\d{2}[ _T]\d{2}[-:.]\d{2}/.test(path.basename(file))
			? 'Elite HRV'
			: 'plain RR list';
		// One column: an RR list (Elite HRV, Kubios series, any plain export). Needs a start time.
		if (width === 1 && numeric.every((r) => r.length === 1)) {
			const start = resolveStart(opts, file, `${label} file`);
			return {
				format: `${label} (start from ${start.from})`,
				beats: beatsFromStart(start.ms, toMs(numeric.map((r) => r[0]))),
			};
		}
		// Two columns: elapsed seconds at each beat, then RR (Polar Flow HRV export, Kubios time + RR).
		if (width === 2 && numeric.every((r) => r.length === 2)) {
			const start = resolveStart(opts, file, `${label} (elapsed time, RR) file`);
			const rr = toMs(numeric.map((r) => r[1]));
			return {
				format: `${isKubios ? 'Kubios' : 'elapsed time + RR'} (start from ${start.from})`,
				beats: numeric.map((r, i) => ({ t: start.ms + r[0] * 1000, rr: rr[i] })),
			};
		}
	}
	throw new Error(
		`cannot tell what format ${file} is. Supported: Polar Flow CSV, Polar Sensor Logger, HRV Logger, Elite HRV, ` +
			'Kubios, a plain RR list, or elapsed time + RR.',
	);
}

/** Drops RR intervals that cannot be heartbeats or that jump more than 20 percent from their neighbours. */
export function cleanBeats(beats) {
	const keep = [];
	for (let i = 0; i < beats.length; i++) {
		const rr = beats[i].rr;
		if (rr < RR_MIN_MS || rr > RR_MAX_MS) continue;
		const nb = [];
		for (let j = i - 2; j <= i + 2; j++) if (j !== i && j >= 0 && j < beats.length) nb.push(beats[j].rr);
		nb.sort((a, b) => a - b);
		const med = nb.length ? (nb[(nb.length - 1) >> 1] + nb[nb.length >> 1]) / 2 : rr;
		if (Math.abs(rr - med) > RR_NEIGHBOUR_FRACTION * med) continue;
		keep.push(beats[i]);
	}
	return { beats: keep, dropped: beats.length - keep.length };
}

/** Reference per epoch second s (the page's row for second s shows its number during [s, s+1)):
 * mean5 = 60000 / mean RR of the beats ending in (s+1-5, s+1]; inst = 60000 / RR of the beat in progress at s+1. */
export function buildReference(strap) {
	const mean5 = new Map();
	const inst = new Map();
	if (strap.hr) {
		for (const [s, v] of strap.hr) mean5.set(s, v);
		return { mean5, inst, kind: 'per-second HR as written by the strap app (its own averaging)' };
	}
	const b = strap.beats;
	if (b.length === 0) return { mean5, inst, kind: 'none' };
	const first = Math.floor(b[0].t / 1000) - 1;
	const last = Math.ceil(b[b.length - 1].t / 1000) + 1;
	let lo = 0;
	let hi = 0;
	let k = 0;
	for (let s = first; s <= last; s++) {
		const end = (s + 1) * 1000;
		while (hi < b.length && b[hi].t <= end) hi++;
		while (lo < hi && b[lo].t <= end - REF_WINDOW_S * 1000) lo++;
		let sum = 0;
		for (let i = lo; i < hi; i++) sum += b[i].rr;
		if (hi > lo && sum >= REF_MIN_COVER_S * 1000) mean5.set(s, 60000 / (sum / (hi - lo)));
		while (k < b.length && b[k].t < end) k++;
		if (k < b.length && b[k].t - b[k].rr <= end) inst.set(s, 60000 / b[k].rr);
	}
	return { mean5, inst, kind: `${REF_WINDOW_S} s mean of the strap's beats (60000 / mean RR)` };
}

// ---------------------------------------------------------------------------------------------------------------
// The page's file.

export function readDemo(text, file) {
	const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim() !== '');
	if (lines[0]?.trim() !== DEMO_HEADER)
		throw new Error(`${file} is not a demo "Save readings" file (first line must be ${DEMO_HEADER})`);
	const rows = [];
	const versions = new Set();
	for (const line of lines.slice(1)) {
		const c = line.split(',');
		const ms = Number(c[0]);
		if (!Number.isFinite(ms)) throw new Error(`${file}: bad epoch_ms "${c[0]}"`);
		if (c[1] && Math.abs(Date.parse(c[1]) - ms) > 1)
			throw new Error(`${file}: iso_time ${c[1]} does not match epoch_ms ${ms}`);
		rows.push({ s: Math.floor(ms / 1000), ms, bpm: num(c[2]) });
		if (c[4]) versions.add(c[4].trim());
	}
	rows.sort((a, b) => a.ms - b.ms);
	return { rows, versions: [...versions] };
}

/** Condition name: "calm=file.csv" on the command line, else the file name without the page's default prefix. */
function conditionName(arg) {
	const eq = arg.indexOf('=');
	if (eq > 0 && !fs.existsSync(arg)) return { name: arg.slice(0, eq), file: arg.slice(eq + 1) };
	const stem = path.basename(arg).replace(/\.csv$/i, '');
	const m = /^demo-readings-.*?(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2})/.exec(stem);
	return { name: m ? `started ${m[1].slice(11, 16).replace('-', ':')} UTC` : stem, file: arg };
}

// ---------------------------------------------------------------------------------------------------------------
// Lag and scoring.

function lagCurve(demos, ref, maxLag) {
	const curve = [];
	for (let L = -maxLag; L <= maxLag; L++) {
		let sum = 0;
		let n = 0;
		for (const d of demos)
			for (const r of d.rows) {
				if (r.bpm == null) continue;
				const v = ref.mean5.get(r.s + L);
				if (v == null) continue;
				sum += Math.min(Math.abs(r.bpm - v), LAG_CAP_BPM);
				n++;
			}
		curve.push({ lag: L, n, err: n ? sum / n : null });
	}
	return curve;
}

/** Per-block mean of (capped error at lag a) minus (capped error at lag b), over seconds both lags can score. */
function blockDiffs(demos, ref, a, b) {
	const out = [];
	for (const d of demos) {
		let sum = 0;
		let n = 0;
		let blockStart = null;
		const flush = () => {
			if (n) out.push(sum / n);
			sum = 0;
			n = 0;
		};
		for (const r of d.rows) {
			if (r.bpm == null) continue;
			const va = ref.mean5.get(r.s + a);
			const vb = ref.mean5.get(r.s + b);
			if (va == null || vb == null) continue;
			if (blockStart == null || r.s - blockStart >= LAG_BLOCK_S) {
				flush();
				blockStart = r.s;
			}
			sum += Math.min(Math.abs(r.bpm - va), LAG_CAP_BPM) - Math.min(Math.abs(r.bpm - vb), LAG_CAP_BPM);
			n++;
		}
		flush();
	}
	return out;
}

/** Picks the lag, or refuses. The best lag must beat every lag 3 s or more away by more than chance (a t statistic of
 * at least 3 over 10 s blocks, at least 5 blocks), and must not sit at the edge of the search. */
export function chooseLag(curve, maxLag, demos, ref) {
	const ok = curve.filter((c) => c.n >= LAG_MIN_PAIRS);
	if (ok.length === 0) return { refused: 'too few seconds where the page showed a number while the strap recorded' };
	const best = ok.reduce((a, c) => (c.err < a.err ? c : a));
	const far = ok.filter((c) => Math.abs(c.lag - best.lag) >= LAG_FAR_S);
	if (far.length === 0) return { refused: 'no lags far enough from the best one to compare with', best };
	let weakest = null;
	for (const c of far) {
		const bd = blockDiffs(demos, ref, c.lag, best.lag);
		const m = bd.reduce((x, y) => x + y, 0) / (bd.length || 1);
		const sd = bd.length > 1 ? Math.sqrt(bd.reduce((x, y) => x + (y - m) ** 2, 0) / (bd.length - 1)) : 0;
		const t = bd.length < LAG_MIN_BLOCKS ? 0 : sd > 0 ? m / (sd / Math.sqrt(bd.length)) : m > 0 ? Infinity : 0;
		if (!weakest || t < weakest.t) weakest = { lag: c.lag, err: c.err, t, blocks: bd.length };
	}
	if (!(weakest.t >= LAG_MIN_T))
		return {
			refused:
				`the lag cannot be told apart: best ${best.lag} s is off by ${best.err.toFixed(1)} bpm, lag ${weakest.lag} s ` +
				`by ${weakest.err.toFixed(1)}, a difference chance could make (t ${Number.isFinite(weakest.t) ? weakest.t.toFixed(1) : weakest.t} over ` +
				`${weakest.blocks} blocks of ${LAG_BLOCK_S} s, need ${LAG_MIN_T})`,
			best,
		};
	if (Math.abs(best.lag) === maxLag)
		return { refused: `the best lag is at the edge of the search (${best.lag} s); the true lag may be outside it`, best };
	return { lag: best.lag, best, weakest };
}

export function score(rows, ref, lag) {
	const first = rows[0];
	const out = {
		logged: rows.length,
		missingFromLog: rows.length ? rows[rows.length - 1].s - first.s + 1 - rows.length : 0,
		withRef: 0,
		shown: 0,
		within5: 0,
		within10pct: 0,
		right: 0,
		wrong: 0,
		firstNumberS: null,
		bias: null,
		sd: null,
		loaLow: null,
		loaHigh: null,
		mae: null,
		instWithin5: 0,
		instN: 0,
	};
	const firstShown = rows.find((r) => r.bpm != null);
	if (firstShown) out.firstNumberS = firstShown.s - first.s;
	const diffs = [];
	for (const r of rows) {
		const v = ref.mean5.get(r.s + lag);
		if (v == null) continue;
		out.withRef++;
		if (r.bpm == null) continue;
		out.shown++;
		const d = r.bpm - v;
		diffs.push(d);
		const a = Math.abs(d);
		if (a <= RIGHT_BPM) out.within5++;
		if (a <= RIGHT_FRACTION * v) out.within10pct++;
		if (a <= Math.max(RIGHT_BPM, RIGHT_FRACTION * v)) out.right++;
		else out.wrong++;
		const iv = ref.inst.get(r.s + lag);
		if (iv != null) {
			out.instN++;
			if (Math.abs(r.bpm - iv) <= RIGHT_BPM) out.instWithin5++;
		}
	}
	if (diffs.length) {
		const mean = diffs.reduce((a, b) => a + b, 0) / diffs.length;
		const sd =
			diffs.length > 1 ? Math.sqrt(diffs.reduce((a, b) => a + (b - mean) ** 2, 0) / (diffs.length - 1)) : 0;
		Object.assign(out, {
			bias: mean,
			sd,
			loaLow: mean - 1.96 * sd,
			loaHigh: mean + 1.96 * sd,
			mae: diffs.reduce((a, b) => a + Math.abs(b), 0) / diffs.length,
		});
	}
	return out;
}

/** The whole job: returns { refused } or { lag, perFile, all, curve }. */
export function run({ strap, demos, maxLag = MAX_LAG_S, forceLag = null }) {
	const ref = buildReference(strap);
	const refSecs = [...ref.mean5.keys()];
	if (refSecs.length === 0) return { refused: 'the strap file has no usable heart rate' };
	const rMin = Math.min(...refSecs);
	const rMax = Math.max(...refSecs);
	const allRows = demos.flatMap((d) => d.rows);
	const dMin = Math.min(...allRows.map((r) => r.s));
	const dMax = Math.max(...allRows.map((r) => r.s));
	const overlap = Math.min(dMax + maxLag, rMax) - Math.max(dMin - maxLag, rMin);
	const spans = { strap: [rMin, rMax], page: [dMin, dMax] };
	if (overlap < MIN_OVERLAP_S) {
		const gap = dMin > rMax ? dMin - rMax : rMin - dMax;
		return {
			refused:
				`no overlap: the page file runs ${iso(dMin)} to ${iso(dMax)} and the strap ${iso(rMin)} to ${iso(rMax)} ` +
				`(${overlap < 0 ? `${Math.abs(Math.round(gap))} s apart` : `${Math.round(overlap)} s overlap`}). ` +
				hintZone(dMin, dMax, rMin, rMax),
			spans,
			ref,
		};
	}
	const curve = lagCurve(demos, ref, maxLag);
	let lag;
	let pick = null;
	if (forceLag != null) lag = forceLag;
	else if (!allRows.some((r) => r.bpm != null)) lag = 0;
	else {
		pick = chooseLag(curve, maxLag, demos, ref);
		if (pick.refused) return { refused: pick.refused, curve, spans, ref };
		lag = pick.lag;
	}
	const perFile = demos.map((d) => {
		const c = d.rows.some((r) => r.bpm != null) ? chooseLag(lagCurve([d], ref, maxLag), maxLag, [d], ref) : null;
		return { name: d.name, versions: d.versions, s: score(d.rows, ref, lag), s0: score(d.rows, ref, 0), ownLag: c };
	});
	return {
		lag,
		forced: forceLag != null,
		curve,
		pick,
		ref,
		spans,
		perFile,
		all: withMedianFirst(score(allRows, ref, lag), demos),
		all0: withMedianFirst(score(allRows, ref, 0), demos),
	};
}

/** Across files, "time to first number" is the median of each file's own time (pooled rows have no single start). */
function withMedianFirst(s, demos) {
	const t = demos
		.map((d) => d.rows.find((r) => r.bpm != null) && d.rows.find((r) => r.bpm != null).s - d.rows[0].s)
		.filter((x) => x != null)
		.sort((a, b) => a - b);
	s.firstNumberS = t.length ? (t[(t.length - 1) >> 1] + t[t.length >> 1]) / 2 : null;
	s.firstNumberIsMedian = demos.length > 1;
	return s;
}

function iso(sec) {
	return new Date(sec * 1000).toISOString().slice(0, 19).replace('T', ' ') + 'Z';
}

/** When moving the page file by a whole number of quarter hours would put it inside the strap recording, the cause
 * is almost always a wrong time zone. */
function hintZone(dMin, dMax, rMin, rMax) {
	const fits = [];
	for (let q = -56; q <= 56; q++) {
		if (q === 0) continue;
		const sh = q * 900;
		if (dMin + sh >= rMin - MAX_LAG_S && dMax + sh <= rMax + MAX_LAG_S) fits.push(q / 4);
	}
	if (fits.length && fits.length <= 3)
		return `The page file would fit inside the strap recording if the strap times were moved by ${fits.map((h) => `${-h} h`).join(' or ')}: check --tz.`;
	return 'Check that both files are from the same session and that --tz is the phone\'s zone.';
}

// ---------------------------------------------------------------------------------------------------------------
// Report.

const pct = (a, b) => (b ? Math.round((100 * a) / b) : 0);
const f1 = (x) => (x == null ? 'n/a' : (x >= 0 ? '+' : '') + x.toFixed(1));

function line(name, s) {
	const cov = `${s.shown}/${s.withRef} s shown (${pct(s.shown, s.withRef)} of 100)`;
	if (!s.shown) return `${name}: ${cov}; no number ever shown while the strap recorded`;
	return (
		`${name}: ${cov}; ${s.firstNumberIsMedian ? 'median ' : ''}first number after ${s.firstNumberS ?? 'never'} s; ` +
		`right within 5 bpm ${pct(s.within5, s.shown)}, within 10% ${pct(s.within10pct, s.shown)}, ` +
		`wrong ${pct(s.wrong, s.shown)} of every 100 shown; ` +
		`bias ${f1(s.bias)} bpm, limits ${f1(s.loaLow)} to ${f1(s.loaHigh)}`
	);
}

export function report(res, meta) {
	const out = [];
	out.push(`strap: ${meta.strapFormat}; ${meta.strapSize}`);
	if (res.refused) {
		out.push(`REFUSED: ${res.refused}`);
		if (res.curve) out.push(curveText(res.curve));
		out.push('Nothing was scored. To score with the clocks exactly as recorded, rerun with --lag 0 (say so in any write-up).');
		return out.join('\n');
	}
	out.push(`reference: ${res.ref.kind}`);
	out.push(
		res.forced
			? `lag: ${res.lag} s, FORCED by --lag (not searched)`
			: !res.pick
			? 'lag: not searched, the page never showed a number (nothing to line up); 0 used'
			: `lag found: ${res.lag} s (the page's number at second s is compared with the strap at s${res.lag >= 0 ? '+' : ''}${res.lag}; ` +
					`this is the clock difference plus how late the page is). Off by ${res.pick?.best?.err?.toFixed(1) ?? 'n/a'} bpm ` +
					`at this lag; the closest rival ${LAG_FAR_S}+ s away (${res.pick?.weakest?.lag} s) is off by ${res.pick?.weakest?.err?.toFixed(1)}, t ${res.pick?.weakest?.t?.toFixed?.(1)}.`,
	);
	if (res.pick) out.push(curveText(res.curve));
	for (const p of res.perFile) {
		out.push('');
		out.push(line(p.name, p.s));
		if (p.s.missingFromLog) out.push(`  ${p.s.missingFromLog} s missing from the page's log (tab hidden or paused?)`);
		if (p.s.withRef < p.s.logged) out.push(`  ${p.s.logged - p.s.withRef} logged s had no strap reference (not counted)`);
		if (p.ownLag?.lag != null && Math.abs(p.ownLag.lag - res.lag) > 2)
			out.push(`  WARNING: this file alone points to lag ${p.ownLag.lag} s, not ${res.lag} s`);
		if (p.s.instN)
			out.push(`  against the instantaneous beat rate instead: within 5 bpm ${pct(p.s.instWithin5, p.s.instN)} of 100`);
		out.push(`  at lag 0 (clocks as recorded): ${line('', p.s0).slice(2)}`);
	}
	out.push('');
	out.push(line('ALL', res.all));
	out.push(
		'Limits are Bland-Altman 95% limits over seconds; neighbouring seconds are not independent, so treat them as a ' +
			'description, not a confidence interval.',
	);
	out.push(verdict(res.all));
	return out.join('\n');
}

function curveText(curve) {
	return (
		'lag curve (s: mean |page - strap| bpm, capped at 20): ' +
		curve
			.filter((c) => c.err != null)
			.map((c) => `${c.lag}:${c.err.toFixed(1)}`)
			.join(' ')
	);
}

export function verdict(s) {
	if (!s.withRef) return 'VERDICT: nothing to judge, the page and the strap never recorded at the same time.';
	if (!s.shown)
		return `VERDICT: the page never showed a number in ${s.withRef} s (it withheld every time; no wrong numbers, no right ones).`;
	return (
		`VERDICT: the page showed a number in ${pct(s.shown, s.withRef)} of every 100 seconds; when it did, it was ` +
		`within 5 bpm of the chest strap ${pct(s.within5, s.shown)} times in 100 and wrong (outside 5 bpm and 10%) ` +
		`${pct(s.wrong, s.shown)} times in 100 (good is close to 0); ${s.firstNumberIsMedian ? 'median ' : ''}first number after ${s.firstNumberS} s.`
	);
}

// ---------------------------------------------------------------------------------------------------------------
// Synthetic files for the self-checks and the examples. Generated from a known heart-rate curve, not from the
// scorer's own reference code, so a bug in the reference cannot cancel itself out.

/** Beats from a heart-rate curve hrAt(seconds since t0). Each interval takes the rate at its own midpoint. */
function synthBeats(t0, durS, hrAt) {
	const beats = [];
	let t = t0;
	while (t < t0 + durS * 1000) {
		const guess = 60000 / hrAt((t - t0) / 1000);
		const rr = Math.round(60000 / hrAt((t + guess / 2 - t0) / 1000));
		t += rr;
		beats.push({ t, rr });
	}
	return beats;
}

/** Mean of hrAt over the reference window of physical second p (independent numeric integration). */
function windowMean(hrAt, p) {
	let sum = 0;
	let n = 0;
	for (let x = p + 1 - REF_WINDOW_S; x <= p + 1; x += 0.01) {
		sum += hrAt(x);
		n++;
	}
	return sum / n;
}

/** Demo file text. physStart: epoch s of the first row in physical time; clockAhead: s the laptop is ahead. */
function synthDemo({ physStart, n, clockAhead, hrAt, t0, blankFirst, blanks = [], plus = [], minus = [], plusBy = 12, minusBy = 3 }) {
	const rows = [DEMO_HEADER];
	for (let i = 0; i < n; i++) {
		const p = physStart + i;
		const ms = (p + clockAhead) * 1000;
		let bpm = null;
		if (i >= blankFirst && !blanks.includes(i)) {
			bpm = windowMean(hrAt, p - t0 / 1000);
			if (plus.includes(i)) bpm += plusBy;
			if (minus.includes(i)) bpm -= minusBy;
		}
		rows.push(`${ms},${new Date(ms).toISOString()},${bpm == null ? '' : bpm.toFixed(1)},${bpm == null ? '0.000' : '0.900'},0.15.0-test.19`);
	}
	return rows.join('\n');
}

const pad = (x, w = 2) => String(x).padStart(w, '0');
function localStamp(epochMs, tz, sep = ' ') {
	const l = new Date(epochMs + tzOffsetMs(tz, epochMs));
	return (
		`${l.getUTCFullYear()}-${pad(l.getUTCMonth() + 1)}-${pad(l.getUTCDate())}${sep}` +
		`${pad(l.getUTCHours())}:${pad(l.getUTCMinutes())}:${pad(l.getUTCSeconds())}.${pad(l.getUTCMilliseconds(), 3)}`
	);
}

/** Phone receipt stamps: Bluetooth delivers beats in batches at the next whole second. */
const receipt = (t) => Math.ceil(t / 1000) * 1000;

function hrvLoggerText(beats, tz) {
	let c = 0;
	return ['date,rr,since start', ...beats.map((b) => `${localStamp(receipt(b.t), tz)},${b.rr},${(c += b.rr) - b.rr}`)].join('\n');
}
function polarLoggerText(beats, tz) {
	return ['Phone timestamp;RR-interval [ms]', ...beats.map((b) => `${localStamp(receipt(b.t), tz, 'T')};${b.rr}`)].join('\n');
}

const T0 = Date.UTC(2026, 9, 12, 10, 0, 0); // physical start of the synthetic strap recording
const wavy = (x) => 70 + 15 * Math.sin((2 * Math.PI * x) / 40);

function assert(cond, name, msg) {
	if (!cond) throw new Error(`self-check failed (${name}): ${msg}`);
}

/** Runs every self-check; throws on the first failure. */
export function selfCheck({ quiet = false } = {}) {
	const say = (m) => quiet || console.log(m);
	const brk = (n) => process.env.SELFCHECK_BREAK === n;

	// tz: local clock to epoch, both sides of a daylight-saving change, and a fixed offset.
	{
		const z = brk('tz') ? 'Europe/London' : 'Europe/Stockholm';
		const oct = localToEpoch({ y: 2026, mo: 10, d: 12, h: 12, mi: 0, s: 0 }, z);
		const jan = localToEpoch({ y: 2026, mo: 1, d: 12, h: 12, mi: 0, s: 0 }, 'Europe/Stockholm');
		const ind = localToEpoch({ y: 2026, mo: 10, d: 12, h: 15, mi: 30, s: 0 }, '+05:30');
		assert(oct === Date.UTC(2026, 9, 12, 10), 'tz', `Stockholm 12:00 in October read as ${new Date(oct).toISOString()}`);
		assert(jan === Date.UTC(2026, 0, 12, 11), 'tz', `Stockholm 12:00 in January read as ${new Date(jan).toISOString()}`);
		assert(ind === Date.UTC(2026, 9, 12, 10), 'tz', `+05:30 15:30 read as ${new Date(ind).toISOString()}`);
		say('self-check ok (tz): local times convert to UTC on both sides of daylight saving and with a fixed offset');
	}

	const beats = synthBeats(T0, 400, wavy);

	// formats: every reader gives back the generated beat times.
	{
		const tz = 'Europe/Stockholm';
		// Elite HRV names the file by the reading's local start time; the break moves that name 1 s late.
		const named = localStamp(brk('formats') ? T0 + 1000 : T0, tz);
		const eliteFile = `${named.slice(0, 10)} ${named.slice(11, 19).replace(/:/g, '-')}.txt`;
		const rrList = beats.map((b) => b.rr).join('\n');
		let el = 0;
		const cases = [
			['HRV Logger', hrvLoggerText(beats, tz), 'rr.csv', { tz }],
			['Polar Sensor Logger', polarLoggerText(beats, tz), 'polar.txt', { tz }],
			['Elite HRV', rrList, eliteFile, { tz }],
			['Kubios series', `# SIGNAL/SERIES EXPORT - KUBIOS\n# File: x.txt\n${rrList}`, 'k.txt', { start: new Date(T0).toISOString() }],
			['Kubios report', `Kubios HRV Analysis Report\nRR Intervals (ms)\n------------------\n${rrList}`, 'k2.txt', { start: new Date(T0).toISOString() }],
			['plain RR in seconds', beats.map((b) => (b.rr / 1000).toFixed(3)).join('\n'), 'rr.txt', { start: new Date(T0).toISOString() }],
			['elapsed + RR', beats.map((b) => `${((el += b.rr) / 1000).toFixed(3)}\t${b.rr}`).join('\n'), 'flow-hrv.txt', { start: new Date(T0).toISOString() }],
		];
		for (const [label, text, file, opts] of cases) {
			const got = readStrap(text, file, opts).beats;
			assert(got.length === beats.length, 'formats', `${label}: ${got.length} beats, expected ${beats.length}`);
			const worst = Math.max(...got.map((g, i) => Math.abs(g.t - beats[i].t)));
			const tol = /Logger/.test(label) ? 50 : 1; // receipt-stamped formats are anchored to within tens of ms
			assert(worst <= tol, 'formats', `${label}: beat times off by up to ${worst} ms (allowed ${tol})`);
		}
		// Polar Flow per-second HR.
		const startL = new Date(T0 + tzOffsetMs(tz, T0));
		const flowRows = [];
		for (let i = 1; i <= 300; i++) flowRows.push(`1,${pad(Math.floor(i / 3600))}:${pad(Math.floor(i / 60) % 60)}:${pad(i % 60)},${Math.round(wavy(i))},,,,,,,,`);
		const flow = [
			'Name,Sport,Date,Start time,Duration,Total distance (km),Average heart rate (bpm)',
			`Someone,OTHER_INDOOR,${pad(startL.getUTCDate())}-${pad(startL.getUTCMonth() + 1)}-${startL.getUTCFullYear()},${pad(startL.getUTCHours())}:${pad(startL.getUTCMinutes())}:${pad(startL.getUTCSeconds())},00:05:00,,72`,
			'Sample rate,Time,HR (bpm),Speed (km/h),Pace (min/km),Cadence,Altitude (m),Stride length (m),Distances (m),Temperatures (C),Power (W)',
			...flowRows,
		].join('\n');
		const hr = readStrap(flow, 'flow.csv', { tz }).hr;
		assert(hr.get(T0 / 1000 + 100) === Math.round(wavy(100)), 'formats', `Polar Flow second 100 read ${hr.get(T0 / 1000 + 100)}`);
		assert(hr.size === 300, 'formats', `Polar Flow gave ${hr.size} seconds, expected 300`);
		say(`self-check ok (formats): ${cases.length} RR readers return the generated ${beats.length} beat times; Polar Flow per-second HR read exactly`);
	}

	// known: a page file with known blanks, known errors and a known clock offset is scored exactly.
	{
		const plus = [30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90, 95, 105];
		if (brk('known')) plus.push(110);
		const minus = [32, 42, 52, 62, 72, 82, 92, 102, 112, 122];
		const blanks = [33, 43, 53, 63, 73, 83, 93, 103, 113, 123];
		const demo = readDemo(
			synthDemo({ physStart: T0 / 1000 + 30, n: 180, clockAhead: -4, hrAt: wavy, t0: T0, blankFirst: 20, blanks, plus, minus }),
			'known.csv',
		);
		const strap = { beats: cleanBeats(beats).beats };
		const res = run({ strap, demos: [{ ...demo, name: 'known' }] });
		assert(!res.refused, 'known', `refused: ${res.refused}`);
		const s = res.all;
		const want = { lag: 4, withRef: 180, shown: 150, within5: 135, wrong: 15, right: 135, firstNumberS: 20 };
		const got = { lag: res.lag, withRef: s.withRef, shown: s.shown, within5: s.within5, wrong: s.wrong, right: s.right, firstNumberS: s.firstNumberS };
		for (const k of Object.keys(want)) assert(got[k] === want[k], 'known', `${k} = ${got[k]}, expected ${want[k]}`);
		const wantBias = (15 * 12 - 10 * 3) / 150;
		assert(Math.abs(s.bias - wantBias) < 0.3, 'known', `bias ${s.bias.toFixed(2)}, expected ${wantBias.toFixed(2)}`);
		say(`self-check ok (known): lag 4 s, 150 of 180 s shown, 135 right, 15 wrong, first number 20 s, bias ${s.bias.toFixed(2)} (set ${wantBias.toFixed(2)})`);
	}

	// shift: the laptop 11 s ahead, strap read through the HRV Logger reader in local time; lag -11 found.
	{
		const ahead = brk('shift') ? 12 : 11;
		const tz = 'Europe/Stockholm';
		const strap = readStrap(hrvLoggerText(beats, tz), 'rr.csv', { tz });
		const demo = readDemo(synthDemo({ physStart: T0 / 1000 + 60, n: 200, clockAhead: ahead, hrAt: wavy, t0: T0, blankFirst: 10 }), 'shift.csv');
		const res = run({ strap: { beats: cleanBeats(strap.beats).beats }, demos: [{ ...demo, name: 'shift' }] });
		assert(!res.refused && res.lag === -11, 'shift', `lag ${res.lag ?? 'refused: ' + res.refused}, expected -11`);
		assert(res.all.right === 190 && res.all.wrong === 0, 'shift', `right ${res.all.right}, wrong ${res.all.wrong}, expected 190 and 0`);
		say('self-check ok (shift): laptop 11 s ahead found as lag -11 s, all 190 shown seconds right');
	}

	// overlap: a page file an hour after the strap stopped is refused.
	{
		const startS = brk('overlap') ? T0 / 1000 + 100 : T0 / 1000 + 400 + 3600;
		const demo = readDemo(synthDemo({ physStart: startS, n: 120, clockAhead: 0, hrAt: wavy, t0: T0, blankFirst: 10 }), 'late.csv');
		const res = run({ strap: { beats }, demos: [{ ...demo, name: 'late' }] });
		assert(res.refused && /no overlap/.test(res.refused), 'overlap', `not refused for no overlap (${res.refused ?? 'scored'})`);
		say('self-check ok (overlap): a page file with no strap overlap is refused');
	}

	// flat: a constant heart rate gives no way to find the lag, so the search refuses.
	{
		const flatHr = brk('flat') ? wavy : () => 72;
		const fb = synthBeats(T0, 400, flatHr);
		const demo = readDemo(synthDemo({ physStart: T0 / 1000 + 60, n: 200, clockAhead: 3, hrAt: flatHr, t0: T0, blankFirst: 10 }), 'flat.csv');
		const res = run({ strap: { beats: fb }, demos: [{ ...demo, name: 'flat' }] });
		assert(res.refused && /cannot be told apart/.test(res.refused), 'flat', `not refused (${res.refused ?? 'lag ' + res.lag})`);
		say('self-check ok (flat): a lag that is not clearly better than its neighbours is refused');
	}
}

// ---------------------------------------------------------------------------------------------------------------
// Example files (docs/evidence/tools/strap-score/examples), regenerated with --write-examples <dir>.

function writeExamples(dir) {
	fs.mkdirSync(dir, { recursive: true });
	const tz = 'Europe/Stockholm';
	// One strap session, 10:00 to 10:12 UTC: calm, then stairs at 10:06 (rate jumps to 125 and settles back to 80).
	const hrAt = (x) => (x < 360 ? 68 + 4 * Math.sin((2 * Math.PI * x) / 30) : 80 + 45 * Math.exp(-(x - 360) / 60));
	const b = synthBeats(T0, 720, hrAt);
	fs.writeFileSync(path.join(dir, 'strap-hrv-logger.csv'), hrvLoggerText(b, tz) + '\n');
	// The laptop clock is 2 s behind the phone. Calm: number from 25 s, 8 wrong seconds (+14).
	fs.writeFileSync(
		path.join(dir, 'calm.csv'),
		synthDemo({ physStart: T0 / 1000 + 60, n: 120, clockAhead: -2, hrAt, t0: T0, blankFirst: 25, plus: [50, 51, 52, 53, 90, 91, 92, 93], plusBy: 14 }) + '\n',
	);
	// Stairs: number from 30 s, 6 blank seconds, 12 seconds 9 bpm low.
	fs.writeFileSync(
		path.join(dir, 'stairs.csv'),
		synthDemo({
			physStart: T0 / 1000 + 365,
			n: 150,
			clockAhead: -2,
			hrAt,
			t0: T0,
			blankFirst: 30,
			blanks: [70, 71, 72, 73, 74, 75],
			minus: [40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51],
			minusBy: 9,
		}) + '\n',
	);
}

// ---------------------------------------------------------------------------------------------------------------
// Command line.

const HELP = `strap-score: score the demo page's "Save readings" files against a chest strap.

  node strap-score.mjs --strap <strap file> [--strap <another>] [--tz <zone>] [--start <time>]
                       [--lag <s>] [--max-lag <s>] [--json <out.json>] <page file> [<page file> ...]

  <page file>   the page's CSV. Name it by condition (calm.csv) or write calm=<file>.
  --strap       Polar Flow CSV, Polar Sensor Logger, HRV Logger, Elite HRV, Kubios, a plain RR list,
                or elapsed time + RR. Several --strap files are joined.
  --tz          the phone's time zone, for strap files with local times (Europe/Stockholm, +02:00).
  --start       when the strap recording started, for files with no clock times (Kubios, plain RR).
  --lag         skip the lag search and use this lag (say so in any write-up).
  --max-lag     widen or narrow the lag search (default ${MAX_LAG_S} s).
  --selfcheck   run only the self-checks.  --write-examples <dir>  regenerate the example files.
Exit: 0 scored, 2 refused or needs input, 1 error or failed self-check.`;

function parseArgs(argv) {
	const o = { straps: [], pages: [], tz: null, start: null, lag: null, maxLag: MAX_LAG_S, json: null };
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		const v = () => argv[++i];
		if (a === '--strap') o.straps.push(v());
		else if (a === '--tz') o.tz = v();
		else if (a === '--start') o.start = v();
		else if (a === '--lag') o.lag = Number(v());
		else if (a === '--max-lag') o.maxLag = Number(v());
		else if (a === '--json') o.json = v();
		else if (a === '--selfcheck') o.selfcheckOnly = true;
		else if (a === '--write-examples') o.examples = v();
		else if (a === '--help' || a === '-h') o.help = true;
		else o.pages.push(a);
	}
	return o;
}

function main() {
	const o = parseArgs(process.argv.slice(2));
	if (o.help) return console.log(HELP), 0;
	if (o.selfcheckOnly) return 0;
	if (o.examples) return writeExamples(o.examples), console.log(`examples written to ${o.examples}`), 0;
	if (o.straps.length === 0 || o.pages.length === 0) return console.error(HELP), 1;
	if (o.tz) tzOffsetMs(o.tz, Date.now()); // throws now on an unknown zone name
	try {
		let beats = [];
		const hr = new Map();
		const formats = [];
		for (const f of o.straps) {
			const s = readStrap(fs.readFileSync(f, 'utf8'), f, o);
			formats.push(s.format);
			if (s.beats) beats = beats.concat(s.beats);
			else for (const [k, v] of s.hr) hr.set(k, v);
		}
		if (beats.length && hr.size) throw new Error('mixing a per-second HR file with RR files is not supported');
		beats.sort((a, b) => a.t - b.t);
		const cleaned = cleanBeats(beats);
		const strap = hr.size ? { hr } : { beats: cleaned.beats };
		const demos = o.pages.map((arg) => {
			const { name, file } = conditionName(arg);
			return { name, ...readDemo(fs.readFileSync(file, 'utf8'), file) };
		});
		const res = run({ strap, demos, maxLag: o.maxLag, forceLag: Number.isFinite(o.lag) ? o.lag : null });
		const versions = [...new Set(demos.flatMap((d) => d.versions))];
		console.log(`page library version: ${versions.join(', ') || 'unknown'}`);
		console.log(
			report(res, {
				strapFormat: formats.join(' + '),
				strapSize: hr.size ? `${hr.size} s of heart rate` : `${beats.length} beats, ${cleaned.dropped} dropped as artefacts`,
			}),
		);
		if (!hr.size && cleaned.dropped > 0.05 * beats.length)
			console.log(`WARNING: ${cleaned.dropped} of ${beats.length} beats dropped as artefacts; check the strap's contact.`);
		if (o.json) {
			const { ref, ...rest } = res;
			fs.writeFileSync(o.json, JSON.stringify(rest, null, 2));
		}
		return res.refused ? 2 : 0;
	} catch (e) {
		if (e instanceof NeedsInput) return console.error(`NEEDS INPUT: ${e.message}`), 2;
		throw e;
	}
}

const isMain = Boolean(process.argv[1]) && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

// Self-checks run at import, before anything can be scored; a failure throws and nothing is reported.
selfCheck({ quiet: !isMain });

if (isMain) {
	try {
		process.exitCode = main();
	} catch (e) {
		console.error(e.message);
		process.exitCode = 1;
	}
}
