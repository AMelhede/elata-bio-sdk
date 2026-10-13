// replay.mjs: the replay mode of strap-score (`--replay --library <dir>`).
//
// The demo page's Save readings JSON holds the number shown every second AND what the library's pulse
// check was fed (the library's own recording, `recordPulseCheckInputs`). This replays every capture
// through the library's own `replayPulseCheck` once per arm (the default, each of the four dim-light
// candidates alone, all four), scores each arm against the strap on the same seconds, and applies the
// decision rule written in advance in docs/evidence/open-gaps.md ("Strap study, fixed in advance"),
// as written there. It does not import strap-score.mjs (strap-score imports it), so it takes the
// strap reference, the lag and the right/wrong judge as arguments.
//
// Self-checks (replaySelfCheck) run before anything is scored; SELFCHECK_BREAK=<name> breaks one on
// purpose. Names: replay-generator, replay-known, replay-exact, decide.

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { peakBpm } from '../selfcheck.mjs';

/** The four candidates, in the order open-gaps.md lists them. Their settings are fixed in the library build. */
export const CANDIDATES = ['followerMedian', 'reproveOnDrift', 'tooDark', 'anchorDrift'];

/** The demo page's JSON: `format` and the one `version` this reads. */
export const DEMO_JSON_FORMAT = 'rppg-demo-sandbox/readings';
export const DEMO_JSON_VERSION = 1;

// The decision rule's numbers, copied from open-gaps.md ("A candidate goes on by default only if").
/** Rule 1: at least this many people with a dim-light capture... */
const MIN_DIM_PEOPLE = 5;
/** ...and at least this many dim seconds shown by either arm. */
const MIN_DIM_SECONDS = 600;
/** Rule 2: bootstrap over people, 2,000 resamples, seed 1, 95% interval. */
const BOOT_N = 2000;
const BOOT_SEED = 1;
const BOOT_LO = 0.025;
const BOOT_HI = 0.975;
/** Rule 4: wrong per 100 shown at most 1 point above the default's; right seconds at least 95 percent of the default's. */
const NORMAL_WRONG_SLACK = 1;
const NORMAL_RIGHT_KEEP = 0.95;
/** Combination: its dim wrong share within 1 point of the best single passer's. */
const COMBO_SLACK = 1;

/** Which condition class a file's condition name belongs to. Only these three are judged (open-gaps.md's
 * "Conditions"); any other name (a lamp behind, head movement) is scored and reported, not judged. A
 * numeric suffix is allowed for repeats ("dim2"). */
export function conditionClass(name) {
	const m = /^(calm|dim|stairs)(?:[-_ ]?\d+)?$/i.exec(String(name).trim());
	if (!m) return 'other';
	return { calm: 'normal', dim: 'dim', stairs: 'stairs' }[m[1].toLowerCase()];
}

/** An arm's rules: the four candidates false except those named; every other rule is left to the library's default. */
export function armRules(on) {
	const r = {};
	for (const c of CANDIDATES) r[c] = on.includes(c);
	return r;
}

/** The arms the brief names: default, each candidate alone, all four. */
export const ARMS = [
	{ name: 'default', on: [] },
	...CANDIDATES.map((c) => ({ name: c, on: [c] })),
	{ name: 'all four', on: [...CANDIDATES] },
];

const armName = (on) => (on.length === 0 ? 'default' : on.length === CANDIDATES.length ? 'all four' : on.join('+'));

// ---------------------------------------------------------------------------------------------------------------
// The library.

/** Loads the replay helper from an installed or unpacked package directory (the one holding package.json and
 * dist/). The demo app's own copy is `<demo checkout>/node_modules/@elata-biosciences/rppg-web`. */
export async function loadLibrary(dir) {
	const dist = path.join(dir, 'dist');
	for (const f of ['pulseCheckRecording.js', 'pulseCheck.js', 'buildInfo.js'])
		if (!fs.existsSync(path.join(dist, f)))
			throw new Error(`--library ${dir} has no dist/${f}; pass the folder of an installed rppg-web test build (0.15.0-test.21 or later)`);
	const rec = await import(pathToFileURL(path.join(dist, 'pulseCheckRecording.js')).href);
	const check = await import(pathToFileURL(path.join(dist, 'pulseCheck.js')).href);
	const info = await import(pathToFileURL(path.join(dist, 'buildInfo.js')).href);
	const off = [...(check.PULSE_CHECK_RULES_OFF_BY_DEFAULT ?? [])].sort().join(',');
	if (off !== [...CANDIDATES].sort().join(','))
		throw new Error(
			`--library ${info.RPPG_WEB_BUILD_VERSION}: its off-by-default rules are [${off}], not the four candidates fixed in open-gaps.md`,
		);
	return {
		version: info.RPPG_WEB_BUILD_VERSION,
		replayPulseCheck: rec.replayPulseCheck,
		parsePulseCheckRecording: rec.parsePulseCheckRecording,
		serializePulseCheckRecording: rec.serializePulseCheckRecording,
		RecordingPulseCheck: rec.RecordingPulseCheck,
		resolvePulseCheckRules: check.resolvePulseCheckRules,
	};
}

// ---------------------------------------------------------------------------------------------------------------
// One capture.

/** Reads the demo page's JSON (format rppg-demo-sandbox/readings, version 1). Rows are what strap-score scores;
 * `session` keeps what replay needs. */
export function readDemoJson(text, file) {
	let j;
	try {
		j = JSON.parse(text);
	} catch (e) {
		throw new Error(`${file}: not valid JSON (${e.message})`);
	}
	if (j.format !== DEMO_JSON_FORMAT || j.version !== DEMO_JSON_VERSION)
		throw new Error(`${file} is not a demo Save readings file (format ${JSON.stringify(j.format)} version ${j.version}; expected ${DEMO_JSON_FORMAT} version ${DEMO_JSON_VERSION})`);
	if (!Array.isArray(j.readings)) throw new Error(`${file}: no readings`);
	const rows = [];
	const versions = new Set();
	for (const r of j.readings) {
		if (!Number.isFinite(r.epoch_ms)) throw new Error(`${file}: bad epoch_ms ${r.epoch_ms}`);
		if (!(r.bpm_shown === null || Number.isFinite(r.bpm_shown))) throw new Error(`${file}: bad bpm_shown ${r.bpm_shown}`);
		if (!Number.isInteger(r.read_index) || r.read_index < 0) throw new Error(`${file}: bad read_index ${r.read_index}`);
		rows.push({ s: Math.floor(r.epoch_ms / 1000), ms: r.epoch_ms, bpm: r.bpm_shown, readIndex: r.read_index });
		if (r.library_version) versions.add(String(r.library_version));
	}
	rows.sort((a, b) => a.ms - b.ms);
	return { rows, versions: [...versions], session: { readsTotal: j.reads_total, recording: j.pulse_check_inputs ?? null } };
}

/**
 * Checks a capture can be replayed and that the default arm gives back, exactly, every number the page showed.
 * Returns { ok: true, replay(on) } or { ok: false, why }. `replay(on)` gives the rows with each row's number as
 * the arm would have shown it.
 */
export function prepareReplay(demo, lib) {
	const s = demo.session;
	if (!s) return { ok: false, why: 'a CSV file: it holds only the number shown, so no other arm can be replayed' };
	if (!s.recording) return { ok: false, why: 'the file has no pulse_check_inputs (the page did not record)' };
	let rec;
	try {
		// The library's own reader: it checks format and version and revives NaN, infinities and -0.
		rec = lib.parsePulseCheckRecording(JSON.stringify(s.recording));
	} catch (e) {
		return { ok: false, why: `recording unreadable: ${e.message}` };
	}
	if (rec.build !== lib.version)
		return { ok: false, why: `recorded on ${rec.build}, the library given is ${lib.version}; replay with the same build` };
	if (rec.dropped !== 0)
		return { ok: false, why: `the recording let ${rec.dropped} events go from its start (session longer than it keeps); its first numbers cannot be replayed exactly` };
	const live = lib.resolvePulseCheckRules(rec.rules);
	const want = lib.resolvePulseCheckRules(armRules([]));
	const differ = Object.keys(want).filter((k) => live[k] !== want[k]);
	if (differ.length) return { ok: false, why: `the page ran other rules than the default arm (${differ.join(', ')})` };
	const reads = (on) => lib.replayPulseCheck(rec, { rules: armRules(on) }).reads;
	const base = reads([]);
	const offset = s.readsTotal - base.length;
	if (offset !== 0)
		return { ok: false, why: `the page counted ${s.readsTotal} reads and the recording holds ${base.length}` };
	const rowsFor = (rs) =>
		demo.rows.map((r) => {
			const x = rs[r.readIndex];
			if (!x) throw new Error(`read ${r.readIndex} is not in the recording`);
			return { s: r.s, ms: r.ms, bpm: x.bpm };
		});
	let defRows;
	try {
		defRows = rowsFor(base);
	} catch (e) {
		return { ok: false, why: e.message };
	}
	const bad = defRows.filter((r, i) => r.bpm !== demo.rows[i].bpm).length;
	if (bad) return { ok: false, why: `the default arm differs from the number shown in ${bad} of ${defRows.length} seconds` };
	const cache = new Map([['', defRows]]);
	return {
		ok: true,
		rec,
		replay(on) {
			const key = [...on].sort().join('+');
			if (!cache.has(key)) cache.set(key, rowsFor(reads(on)));
			return cache.get(key);
		},
	};
}

// ---------------------------------------------------------------------------------------------------------------
// Per-second codes and the decision rule.

/** Per second with a strap reference: 0 no number, 1 right, 2 wrong. `judge(bpm, ref)` is strap-score's own. */
export function codes(rows, ref, lag, judge) {
	const out = [];
	for (const r of rows) {
		const v = ref.mean5.get(r.s + lag);
		if (v == null) continue;
		out.push(r.bpm == null ? 0 : judge(r.bpm, v) ? 1 : 2);
	}
	return out;
}

function tally(list) {
	const t = { withRef: 0, shown: 0, right: 0, wrong: 0 };
	for (const c of list)
		for (const x of c) {
			t.withRef++;
			if (x) t.shown++;
			if (x === 1) t.right++;
			if (x === 2) t.wrong++;
		}
	return t;
}

/** Wrong per 100 shown; 0 when nothing was shown (no number, no wrong number). */
const per100 = (t) => (t.shown ? (100 * t.wrong) / t.shown : 0);

/** A seeded generator (mulberry32), so the bootstrap is the same on every run. */
function mulberry32(seed) {
	return () => {
		seed = (seed + 0x6d2b79f5) | 0;
		let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/** Linear-interpolation quantile of a sorted array (the common "type 7"). */
function quantile(sorted, q) {
	const h = (sorted.length - 1) * q;
	const lo = Math.floor(h);
	return sorted[lo] + (h - lo) * ((sorted[Math.min(lo + 1, sorted.length - 1)] ?? sorted[lo]) - sorted[lo]);
}

/**
 * Applies open-gaps.md's rule. `files`: [{ person, cls }] (cls normal, dim, stairs or other). `armCodes(on, i)`:
 * file i's per-second codes for the arm with candidates `on`. Returns per-candidate rule results and the decision.
 */
export function decide(files, armCodes) {
	const idx = (pred) => files.map((f, i) => (pred(f) ? i : -1)).filter((i) => i >= 0);
	const T = (on, cls, keep = () => true) => tally(idx((f) => f.cls === cls && keep(f)).map((i) => armCodes(on, i)));

	function rules(on) {
		const r = {};
		// Rule 1: at least 5 people with a dim capture, at least 600 dim seconds shown by either arm.
		const dimFiles = idx((f) => f.cls === 'dim');
		const dimPeople = [...new Set(dimFiles.map((i) => files[i].person))];
		let either = 0;
		for (const i of dimFiles) {
			const a = armCodes([], i);
			const b = armCodes(on, i);
			for (let k = 0; k < a.length; k++) if (a[k] || b[k]) either++;
		}
		r.r1 = { pass: dimPeople.length >= MIN_DIM_PEOPLE && either >= MIN_DIM_SECONDS, people: dimPeople.length, either };
		// Rule 2: dim wrong per 100 shown lower, 95% bootstrap interval of the difference (default minus arm) above 0.
		const d0 = T([], 'dim');
		const d1 = T(on, 'dim');
		const perPerson = dimPeople.map((p) => [T([], 'dim', (f) => f.person === p), T(on, 'dim', (f) => f.person === p)]);
		const rnd = mulberry32(BOOT_SEED);
		const diffs = [];
		for (let b = 0; b < BOOT_N && perPerson.length; b++) {
			const a = { shown: 0, wrong: 0 };
			const c = { shown: 0, wrong: 0 };
			for (let k = 0; k < perPerson.length; k++) {
				const [x, y] = perPerson[Math.floor(rnd() * perPerson.length)];
				a.shown += x.shown;
				a.wrong += x.wrong;
				c.shown += y.shown;
				c.wrong += y.wrong;
			}
			diffs.push(per100(a) - per100(c));
		}
		diffs.sort((x, y) => x - y);
		const ci = diffs.length ? [quantile(diffs, BOOT_LO), quantile(diffs, BOOT_HI)] : [null, null];
		r.r2 = { pass: per100(d1) < per100(d0) && ci[0] != null && ci[0] > 0, def: per100(d0), arm: per100(d1), ci };
		// Rule 3: in dim light it removes more wrong seconds than right ones.
		r.r3 = { pass: d0.wrong - d1.wrong > d0.right - d1.right, wrongRemoved: d0.wrong - d1.wrong, rightRemoved: d0.right - d1.right };
		// Rule 4: normal light and after stairs, separately.
		r.r4 = { pass: true, by: {} };
		for (const cls of ['normal', 'stairs']) {
			const a = T([], cls);
			const b = T(on, cls);
			const ok = a.withRef > 0 && per100(b) <= per100(a) + NORMAL_WRONG_SLACK && b.right >= NORMAL_RIGHT_KEEP * a.right;
			r.r4.by[cls] = { pass: ok, seconds: a.withRef, def: per100(a), arm: per100(b), rightDef: a.right, rightArm: b.right };
			if (!ok) r.r4.pass = false;
		}
		// Rule 5: rule 2's direction and rule 3 hold with any one person's files removed.
		const people = [...new Set(files.map((f) => f.person))];
		const failsWithout = [];
		for (const p of people) {
			const keep = (f) => f.person !== p;
			const a = T([], 'dim', keep);
			const b = T(on, 'dim', keep);
			if (!(per100(b) < per100(a) && a.wrong - b.wrong > a.right - b.right)) failsWithout.push(p);
		}
		r.r5 = { pass: people.length > 1 && failsWithout.length === 0, failsWithout };
		r.pass = r.r1.pass && r.r2.pass && r.r3.pass && r.r4.pass && r.r5.pass;
		r.decided = r.r1.pass;
		r.dimWrong = per100(d1);
		return r;
	}

	const each = Object.fromEntries(CANDIDATES.map((c) => [c, rules([c])]));
	const passers = CANDIDATES.filter((c) => each[c].pass);
	let on = [];
	let combo = null;
	if (passers.length === 1) on = passers;
	else if (passers.length > 1) {
		combo = { on: passers, ...rules(passers) };
		// The passer with the lowest dim wrong share; a tie goes to the one listed first in open-gaps.md.
		const best = passers.reduce((a, c) => (each[c].dimWrong < each[a].dimWrong ? c : a));
		combo.withinBest = combo.dimWrong <= each[best].dimWrong + COMBO_SLACK;
		on = combo.pass && combo.withinBest ? passers : [best];
	}
	return { each, passers, combo, on, comboName: combo ? armName(combo.on) : null };
}

// ---------------------------------------------------------------------------------------------------------------
// The whole replay: per file and per arm, scored on the shown-number run's lag, then the rule.

export function runReplay({ demos, ref, lag, judge, lib, weakerReference = null }) {
	const usable = [];
	const refused = [];
	for (const d of demos) {
		const p = prepareReplay(d, lib);
		if (!p.ok) refused.push({ name: d.label, why: p.why });
		else usable.push({ d, p });
	}
	const files = usable.map(({ d }) => ({ person: d.person, cls: conditionClass(d.condition), name: d.label }));
	const memo = new Map();
	const armCodes = (on, i) => {
		const key = `${i}|${[...on].sort().join('+')}`;
		if (!memo.has(key)) memo.set(key, codes(usable[i].p.replay(on), ref, lag, judge));
		return memo.get(key);
	};
	const table = ARMS.map((a) => {
		const by = {};
		for (const cls of ['normal', 'dim', 'stairs', 'other']) {
			const ids = files.map((f, i) => (f.cls === cls ? i : -1)).filter((i) => i >= 0);
			if (ids.length) by[cls] = tally(ids.map((i) => armCodes(a.on, i)));
		}
		return { arm: a.name, by };
	});
	const missingPerson = files.filter((f) => !f.person).map((f) => f.name);
	// The pre-registered rule scores against the strap's beat times; a strap-HR reference is reported, never judged.
	const decision = missingPerson.length || weakerReference ? null : decide(files, armCodes);
	return { lag, library: lib.version, refused, files, table, decision, missingPerson, weakerReference };
}

const pct1 = (x) => (x == null ? 'n/a' : x.toFixed(1));

export function replayReport(res) {
	const out = [];
	out.push('');
	out.push(`REPLAY (library ${res.library}; every arm on the same seconds, lag ${res.lag} s as found for the shown numbers)`);
	out.push(`captures replayed: ${res.files.length}; refused: ${res.refused.length}`);
	for (const r of res.refused) out.push(`  refused ${r.name}: ${r.why}`);
	out.push('Per arm and condition: seconds shown / seconds with a strap reference, wrong per 100 shown (good is close to 0), right seconds.');
	const tag = res.weakerReference ? `[${res.weakerReference}] ` : '';
	for (const row of res.table) {
		const parts = Object.entries(row.by).map(
			([cls, t]) => `${cls} ${t.shown}/${t.withRef} shown, wrong ${pct1(per100(t))} per 100, ${t.right} right`,
		);
		out.push(`  ${tag}${row.arm.padEnd(15)} ${parts.join('; ') || 'no seconds'}`);
	}
	if (res.weakerReference) {
		out.push(
			`DECISION: not applied. ${tag}The rule in open-gaps.md is scored against the strap's beat times; record RR and rescore.`,
		);
		return out.join('\n');
	}
	if (res.missingPerson.length) {
		out.push(`DECISION: not applied. Name the person for every file (person/condition=file): ${res.missingPerson.join(', ')}`);
		return out.join('\n');
	}
	const d = res.decision;
	out.push('Decision rule, open-gaps.md "Strap study, fixed in advance", each candidate alone against the default:');
	for (const c of CANDIDATES) {
		const r = d.each[c];
		out.push(
			`  ${c}: 1 ${r.r1.pass ? 'met' : 'NOT met'} (${r.r1.people} people with dim, ${r.r1.either} dim s shown by either arm); ` +
				`2 ${r.r2.pass ? 'met' : 'NOT met'} (dim wrong ${pct1(r.r2.def)} -> ${pct1(r.r2.arm)} per 100, 95% interval of the drop ${pct1(r.r2.ci[0])} to ${pct1(r.r2.ci[1])}); ` +
				`3 ${r.r3.pass ? 'met' : 'NOT met'} (removes ${r.r3.wrongRemoved} wrong, ${r.r3.rightRemoved} right); ` +
				`4 ${r.r4.pass ? 'met' : 'NOT met'} (${Object.entries(r.r4.by).map(([k, v]) => `${k} wrong ${pct1(v.def)} -> ${pct1(v.arm)}, right ${v.rightDef} -> ${v.rightArm}${v.seconds ? '' : ', no seconds'}`).join('; ')}); ` +
				`5 ${r.r5.pass ? 'met' : 'NOT met'}${r.r5.failsWithout.length ? ` (fails without ${r.r5.failsWithout.join(', ')})` : ''}` +
				` => ${r.pass ? 'PASSES' : r.decided ? 'fails, stays off' : 'not decided, stays off'}`,
		);
	}
	if (d.combo)
		out.push(
			`  together (${d.comboName}): ${d.combo.pass ? 'passes 1 to 5' : 'fails 1 to 5'}, dim wrong ${pct1(d.combo.dimWrong)} per 100, ` +
				`${d.combo.withinBest ? 'within' : 'NOT within'} 1 point of the best single passer`,
		);
	out.push(
		d.on.length
			? `DECISION: turn on in the test build only: ${d.on.join(', ')}. Every other candidate stays off.`
			: 'DECISION: no candidate passes; all four stay off.',
	);
	return out.join('\n');
}

// ---------------------------------------------------------------------------------------------------------------
// Self-checks.

function assert(cond, name, msg) {
	if (!cond) throw new Error(`self-check failed (${name}): ${msg}`);
}

/** The shared DFT check, but broken only by this script's own break name (../selfcheck.mjs breaks on any). */
function checkRate(label, xs, fs, bpm, n, { quiet }) {
	const want = process.env.SELFCHECK_BREAK === 'replay-generator' ? bpm + 10 : bpm;
	const got = peakBpm(xs, fs);
	assert(Math.abs(got - want) <= 2 && xs.length === n, label, `input reads ${got} bpm over ${xs.length} samples, expected ${want} over ${n}`);
	quiet || console.log(`self-check ok (${label}): the synthetic green channel carries ${got} bpm by an independent DFT (set ${bpm}), ${n} samples`);
}

/** A seeded synthetic capture through the library's own RecordingPulseCheck, saved the way the demo page saves it:
 * 30 frames a second, three face regions with a chromatic pulse (green falls most with blood) and a wall with none,
 * one session read per frame, a per-second row on the first read of each second. */
export function syntheticDemoJson(lib, { bpm, amp, seconds = 70, startMs = Date.UTC(2026, 9, 13, 9, 0, 0), seed = 7, shiftReads = 0 }) {
	const R = mulberry32(seed);
	const noise = () => (R() + R() + R() - 1.5) * 0.002;
	const check = new lib.RecordingPulseCheck();
	const readings = [];
	let reads = 0;
	for (let i = 0; i < 30 * seconds; i++) {
		const t = 1000 + (i * 1000) / 30;
		const p = amp * Math.sin((2 * Math.PI * bpm * t) / 60000);
		const regions = [0, 1, 2].map(() => ({ r: 0.6 - 0.001 * p + noise(), g: 0.45 - 0.004 * p + noise(), b: 0.38 - 0.0008 * p + noise() }));
		check.push(t, regions, { r: 0.3 + noise(), g: 0.3 + noise(), b: 0.3 + noise() }, undefined, undefined, { r: 0.3, g: 0.3, b: 0.3 });
		const st = check.getState();
		const shown = st.verdict === 'measured' ? st.bpm : null;
		check.noteRead(shown, null);
		const ms = startMs + Math.floor((t - 1000) / 1000) * 1000;
		if (!readings.length || readings[readings.length - 1].epoch_ms !== ms)
			readings.push({ epoch_ms: ms, bpm_shown: shown, confidence: 0, library_version: lib.version, read_index: Math.min(reads + shiftReads, 30 * seconds - 1) });
		reads++;
	}
	const head = { format: DEMO_JSON_FORMAT, version: DEMO_JSON_VERSION, library_version: lib.version, saved_at_ms: startMs, reads_total: reads, readings };
	return `${JSON.stringify(head).slice(0, -1)},"pulse_check_inputs":${lib.serializePulseCheckRecording(check.getRecording())}}`;
}

/** Runs the replay self-checks; throws on the first failure. */
export function replaySelfCheck(lib, { quiet = false } = {}) {
	const say = (m) => quiet || console.log(m);
	const brk = (n) => process.env.SELFCHECK_BREAK === n;

	// replay-known: a capture whose inputs carry a known pulse (72) replays to it; one with no pulse to nothing.
	{
		const want = brk('replay-known') ? 80 : 72;
		const pulse = readDemoJson(syntheticDemoJson(lib, { bpm: 72, amp: 1 }), 'synthetic-pulse72.json');
		const none = readDemoJson(syntheticDemoJson(lib, { bpm: 72, amp: 0 }), 'synthetic-nopulse.json');
		const p = prepareReplay(pulse, lib);
		const n = prepareReplay(none, lib);
		assert(p.ok && n.ok, 'replay-known', `refused: ${p.why ?? n.why}`);
		// The generator itself, read by an independent DFT (../selfcheck.mjs), before the library reads it.
		const green = p.rec.events.filter((e) => e[0] === 'f').map((e) => e[2][0][1]);
		checkRate('replay-known generator', green, 30, 72, 30 * 70, { quiet });
		const rows = p.replay([]);
		for (const a of ARMS) {
			const late = p.replay(a.on).slice(30);
			assert(late.every((r) => r.bpm != null && Math.abs(r.bpm - want) <= 2), 'replay-known',
				`${a.name}: from second 30 every row should show ${want} +- 2; got ${late.map((r) => r.bpm?.toFixed(1) ?? '-').join(' ')}`);
		}
		assert(n.replay([]).every((r) => r.bpm == null), 'replay-known', 'the capture with no pulse replayed to a number');
		for (const a of ARMS) assert(n.replay(a.on).every((r) => r.bpm == null), 'replay-known', `no pulse showed a number with ${a.name}`);
		say(`self-check ok (replay-known): a pulse at 72 replays to 72 +- 2 from second 30 in every arm (default first at ${rows.findIndex((r) => r.bpm != null)} s); no pulse replays to no number in every arm`);
	}

	// replay-exact: the default arm gives back the live numbers exactly; a file whose rows point at the wrong reads is refused.
	{
		const text = syntheticDemoJson(lib, { bpm: 66, amp: 1, seed: 3, shiftReads: brk('replay-exact') ? 30 : 0 });
		const demo = readDemoJson(text, 'synthetic-pulse66.json');
		const p = prepareReplay(demo, lib);
		assert(p.ok, 'replay-exact', `the default arm did not give back the shown numbers: ${p.why}`);
		const shown = demo.rows.filter((r) => r.bpm != null).length;
		const shifted = readDemoJson(syntheticDemoJson(lib, { bpm: 66, amp: 1, seed: 3, shiftReads: 30 }), 'shifted.json');
		const q = prepareReplay(shifted, lib);
		assert(!q.ok && /differs from the number shown/.test(q.why), 'replay-exact', `rows shifted by one second of reads were not refused (${q.why ?? 'accepted'})`);
		say(`self-check ok (replay-exact): the default arm gives back all ${demo.rows.length} rows exactly (${shown} with a number); rows pointing one second late are refused`);
	}

	// decide: a made-up study with a known outcome. Six people; dim light, normal light, stairs. followerMedian and
	// tooDark each blank 15 of 20 wrong dim seconds per person (pass); reproveOnDrift blanks 30 right dim seconds
	// (fails rule 3); anchorDrift changes nothing (fails rule 2). The two passers together equal each alone, so both go on.
	{
		const people = brk('decide') ? 4 : 6;
		const files = [];
		for (let p = 0; p < people; p++) for (const cls of ['dim', 'normal', 'stairs']) files.push({ person: `p${p}`, cls });
		const base = (cls) => {
			const a = [];
			if (cls === 'dim') {
				for (let k = 0; k < 150; k++) a.push(k < 50 ? 0 : k < 70 ? 2 : 1); // 100 shown, 20 wrong
			} else for (let k = 0; k < 120; k++) a.push(k < 20 ? 0 : k < 22 ? 2 : 1); // 100 shown, 2 wrong
			return a;
		};
		const armCodes = (on, i) => {
			const a = base(files[i].cls);
			if (files[i].cls !== 'dim') return a;
			if (on.includes('followerMedian') || on.includes('tooDark')) for (let k = 50; k < 65; k++) a[k] = 0;
			if (on.includes('reproveOnDrift')) for (let k = 70; k < 100; k++) a[k] = 0;
			return a;
		};
		const d = decide(files, armCodes);
		const got = `${d.passers.join(',')} | ${d.on.join(',')}`;
		assert(got === 'followerMedian,tooDark | followerMedian,tooDark', 'decide', `passers | on = ${got}, expected followerMedian,tooDark | followerMedian,tooDark`);
		assert(!d.each.reproveOnDrift.r3.pass && !d.each.anchorDrift.r2.pass, 'decide', 'the failing candidates failed for the wrong reason');
		say('self-check ok (decide): a made-up six-person study gives the known outcome (two pass and go on together; one fails rule 3, one rule 2)');
	}
}
