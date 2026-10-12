// Fix 11 on camera recordings. The recordings are PRIVATE (one person's own webcam captures, kept in a private app
// repository) and are not in this repository. Anyone holding a folder in the same format can run it.
//
//   RECORDINGS_DIR=<folder> node owner-recordings.mjs <pkgA> <pkgB> ['<B options json>'] [limit]
//   e.g. RECORDINGS_DIR=~/recordings node owner-recordings.mjs node_modules/@elata-biosciences/rppg-web \
//          packages/rppg-web '{"fixes":{"rgbPulse":true}}'
//
// Format: one JSON file per capture, with `rawRois`: rows [tMs, foreheadR, G, B, leftCheekR, G, B, rightCheekR, G, B]
// in 0 to 255, and the reference rate in the file name as ref<bpm> or oura<bpm>. A pulseless control file named
// fixture-pulseless-*.json must be in the folder (the no-gate self-check below needs it).
// Method, the same as the audit's: the three regions are averaged into one colour per frame and fed to
// RppgProcessor.pushSampleRgb at the frame's own timestamp; bpm is read once a second from 20 s on; right means
// within 5 bpm of the file's reference. Both arms see the same frames, so every second is paired.
//
// Self-checks, all before any scoring (SELFCHECK_BREAK=rate|window|nogate breaks one on purpose; it must throw):
//   rate:   a noiseless synthetic 72 at 15, 24 and 30 fps reads within 2 bpm through arm B;
//   window: the processor keeps 45 s of samples at each of those rates;
//   nogate: estimateDominantBpm, which has no gate, returns a rate on the pulseless control file.
import { readFileSync, readdirSync } from "node:fs";
import { pathToFileURL } from "node:url";

const [A, B, BOPTS, LIMIT] = process.argv.slice(2);
const DIR = process.env.RECORDINGS_DIR;
if (!A || !B || !DIR) {
	console.error(
		"usage: RECORDINGS_DIR=<folder> node owner-recordings.mjs <pkgA> <pkgB> ['<B options json>'] [limit]",
	);
	process.exit(2);
}
const BREAK = process.env.SELFCHECK_BREAK ?? "";
async function load(dir) {
	const sdk = await import(pathToFileURL(`${dir}/dist/index.js`).href);
	const bytes = readFileSync(`${dir}/pkg/rppg_wasm_bg.wasm`);
	const backend = await sdk.loadWasmBackend(
		async (u) => {
			const m = await import(u);
			m.initSync?.({ module: bytes });
			return m;
		},
		{ strict: true, jsUrl: pathToFileURL(`${dir}/pkg/rppg_wasm.js`).href },
	);
	return {
		sdk,
		backend,
		name: sdk.RPPG_WEB_BUILD_VERSION ?? "published 0.14.0",
	};
}
const arms = [
	{ ...(await load(A)), opts: undefined, label: "A" },
	{
		...(await load(B)),
		opts: BOPTS ? JSON.parse(BOPTS) : undefined,
		label: "B",
	},
];
function run(arm, frames) {
	const p = arm.opts
		? new arm.sdk.RppgProcessor(arm.backend, 30, 10, arm.opts)
		: new arm.sdk.RppgProcessor(arm.backend, 30, 10);
	let next = frames[0].t + 20000;
	const out = [];
	for (const f of frames) {
		p.pushSampleRgb(f.t, f.r, f.g, f.b, 1);
		if (f.t >= next) {
			next += 1000;
			const b = p.getMetrics().bpm;
			out.push(typeof b === "number" && Number.isFinite(b) ? b : null);
		}
	}
	const n = p.samples?.length ?? 0;
	const span =
		n > 1
			? (p.samples[n - 1].timestampMs - p.samples[0].timestampMs) / 1000
			: 0;
	p.dispose?.();
	return { out, n, span };
}
const median = (a) => {
	const s = a.filter((x) => x != null).sort((x, y) => x - y);
	return s.length ? s[s.length >> 1] : null;
};
const PBV = [0.33, 0.77, 0.53];
const synth = (bpm, fps, seconds) =>
	Array.from({ length: Math.round(seconds * fps) }, (_, i) => {
		const t = (i * 1000) / fps;
		const p = Math.sin((2 * Math.PI * bpm * t) / 60000);
		const c = [170, 120, 100].map((v, k) => v * (1 - 0.01 * PBV[k] * p));
		return { t, r: c[0], g: c[1], b: c[2] };
	});
// Self-checks.
for (const fps of [15, 24, 30]) {
	const { out, n, span } = run(arms[1], synth(72, fps, 60));
	const m = median(out);
	const want = BREAK === "rate" ? 62 : 72;
	if (m == null || Math.abs(m - want) > 2)
		throw new Error(
			`self-check failed (rate): B reads ${m} for a known ${want} at ${fps} fps`,
		);
	const wantSpan = BREAK === "window" ? 30 : 45;
	if (Math.abs(span - wantSpan) > 1 || Math.abs(n - 45 * fps) > 0.1 * 45 * fps)
		throw new Error(
			`self-check failed (window): ${n} samples over ${span.toFixed(1)} s at ${fps} fps, expected ${wantSpan} s`,
		);
}
{
	const ctl = readdirSync(DIR).find((f) => f.startsWith("fixture-pulseless-"));
	if (!ctl)
		throw new Error(
			"self-check failed (nogate): no fixture-pulseless-*.json in RECORDINGS_DIR",
		);
	const raw = JSON.parse(readFileSync(`${DIR}/${ctl}`, "utf8")).rawRois ?? [];
	const g = raw.slice(0, 300).map((x) => (x[2] + x[5] + x[8]) / 3);
	const est =
		BREAK === "nogate"
			? null
			: arms[0].sdk.estimateDominantBpm(g, 30, 0.7, 3.3);
	if (est?.bpm == null)
		throw new Error(
			`self-check failed (nogate): no rate from the no-gate estimate on ${ctl}`,
		);
	console.log(
		`self-checks ok: known 72 at 15, 24, 30 fps through B; 45 s window; no-gate estimate ${est.bpm.toFixed(1)} on ${ctl}`,
	);
}
// Score.
const files = readdirSync(DIR)
	.filter((f) => /(ref|oura)\d+/.test(f))
	.sort()
	.slice(0, LIMIT ? Number(LIMIT) : undefined);
const tot = arms.map(() => ({ right: 0, shown: 0 }));
let seconds = 0;
let recordings = 0;
let better = 0;
let worse = 0;
for (const f of files) {
	const raw = JSON.parse(readFileSync(`${DIR}/${f}`, "utf8")).rawRois;
	if (!raw || raw.length < 600) continue;
	const truth = Number(/(?:ref|oura)(\d+)/.exec(f)[1]);
	const frames = raw.map((x) => ({
		t: x[0],
		r: (x[1] + x[4] + x[7]) / 3,
		g: (x[2] + x[5] + x[8]) / 3,
		b: (x[3] + x[6] + x[9]) / 3,
	}));
	const res = arms.map((a) => run(a, frames).out);
	const right = res.map(
		(o) => o.filter((x) => x != null && Math.abs(x - truth) <= 5).length,
	);
	res.forEach((o, k) => {
		tot[k].right += right[k];
		tot[k].shown += o.filter((x) => x != null).length;
	});
	seconds += res[0].length;
	recordings++;
	if (right[1] > right[0]) better++;
	if (right[1] < right[0]) worse++;
}
arms.forEach((a, k) =>
	console.log(
		`${a.label} (${a.name}${a.opts ? ` ${JSON.stringify(a.opts)}` : ""}): right ${tot[k].right} of ${seconds} seconds, a number in ${tot[k].shown}`,
	),
);
console.log(
	`${recordings} recordings: B better in ${better}, worse in ${worse} (private, owner recordings)`,
);
