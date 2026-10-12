// Grey-pulse suite for RppgProcessor, public API only, no data. Node 20+.
//   node grey-suite.mjs <A> [<B>]        A, B: a built rppg-web package dir (dist/ + pkg/), e.g. node_modules/@elata-biosciences/rppg-web
//   env A_OPTS / B_OPTS: JSON for RppgProcessor's 4th argument, e.g. B_OPTS='{"calibrationBlend":false}'
//   env WASM_PKG: a pkg/ dir to use for both (a source build of main has no pkg/; copy it from the published 0.14.0)
// Feed: R = G = B = 0.5 + 0.02 (sin + 0.4 sin(2x + 0.8)) + Gaussian noise; 0 bpm = noise only. Read getMetrics() once a
// second from 16 s to 39 s, as an app polls. Right = within 5 bpm of the true rate. With B, every second is paired.
import { pathToFileURL } from "node:url";
import { readFileSync } from "node:fs";
const [A, B] = process.argv.slice(2);
const BREAK = process.env.BREAK ?? ""; // rate | window | nogate: each breaks one self-check on purpose
async function load(dir) {
	const sdk = await import(pathToFileURL(`${dir}/dist/index.js`).href);
	const pkg = process.env.WASM_PKG ?? `${dir}/pkg`;
	const bytes = readFileSync(`${pkg}/rppg_wasm_bg.wasm`);
	const backend = await sdk.loadWasmBackend(
		async (u) => {
			const m = await import(u);
			m.initSync?.({ module: bytes });
			return m;
		},
		{ strict: true, jsUrl: pathToFileURL(`${pkg}/rppg_wasm.js`).href },
	);
	return { sdk, backend };
}
function grey({ bpm, fps, seconds = 40, noise = 0.005, seed = 1 }) {
	let s = seed >>> 0;
	const u = () => {
		s = (s * 1664525 + 1013904223) >>> 0;
		return (s + 0.5) / 2 ** 32;
	};
	const g = () => Math.sqrt(-2 * Math.log(u())) * Math.cos(2 * Math.PI * u());
	return Array.from({ length: Math.round(seconds * fps) }, (_, i) => {
		const t = (i * 1000) / fps,
			ph = (2 * Math.PI * bpm * t) / 60000;
		return {
			t,
			v:
				0.5 +
				(bpm > 0 ? 0.02 * (Math.sin(ph) + 0.4 * Math.sin(2 * ph + 0.8)) : 0) +
				noise * g(),
		};
	});
}
function run({ sdk, backend }, opts, frames, fps, readFrom = 16) {
	const p = opts
		? new sdk.RppgProcessor(backend, fps, 10, opts)
		: new sdk.RppgProcessor(backend, fps, 10);
	let next = 1000;
	const out = [];
	for (const f of frames) {
		p.pushSampleRgb(f.t, f.v, f.v, f.v, 1);
		if (f.t >= next - 1e-6) {
			next += 1000;
			const m = p.getMetrics();
			const sec = Math.round(f.t / 1000);
			if (sec >= readFrom) out.push(Number.isFinite(m.bpm) ? m.bpm : null);
		}
	}
	const n = p.samples?.length ?? 0,
		span =
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
async function selfCheck(name, b, opts) {
	const k = run(
		b,
		opts,
		grey({ bpm: 72, fps: 30, seconds: 60, noise: 0 }),
		30,
		20,
	);
	const med = median(k.out),
		want = BREAK === "rate" ? 68 : 72;
	if (med == null || Math.abs(med - want) > 2)
		throw new Error(`${name} self-check: known 72 reads ${med}`);
	const wantS = BREAK === "window" ? 30 : 45;
	if (Math.abs(k.span - wantS) > 1)
		throw new Error(
			`${name} self-check: window ${k.span.toFixed(1)} s, expected ${wantS}`,
		);
	const nogate = b.sdk.estimateDominantBpm(
		grey({ bpm: 0, fps: 30, seconds: 10 }).map((f) => f.v),
		30,
		0.7,
		3.3,
	);
	if ((BREAK === "nogate" ? null : nogate?.bpm) == null)
		throw new Error(
			`${name} self-check: the no-gate spectral estimate gave nothing on a pulseless input`,
		);
	console.error(
		`${name}: self-check ok (known 72 -> ${med.toFixed(1)}, window ${k.span.toFixed(1)} s, no-gate ${nogate.bpm.toFixed(1)} on noise)`,
	);
}
const arms = [
	{
		name: "A",
		b: await load(A),
		opts: process.env.A_OPTS ? JSON.parse(process.env.A_OPTS) : undefined,
	},
];
if (B)
	arms.push({
		name: "B",
		b: await load(B),
		opts: process.env.B_OPTS ? JSON.parse(process.env.B_OPTS) : undefined,
	});
for (const a of arms) await selfCheck(a.name, a.b, a.opts);
if (BREAK) process.exit(0);
const tot = arms.map(() => ({
	right: 0,
	scored: 0,
	nopulse: 0,
	nopulseShown: 0,
	byRate: {},
}));
let lost = 0,
	gained = 0;
for (const fps of [30, 20, 15])
	for (const noise of [0.005, 0.02])
		for (const bpm of [0, 50, 72, 100, 120, 140, 160])
			for (const seed of [1, 2, 3]) {
				const frames = grey({ bpm, fps, noise, seed });
				const res = arms.map((a) => run(a.b, a.opts, frames, fps).out);
				res.forEach((out, i) => {
					const T = tot[i];
					for (const v of out) {
						if (bpm === 0) {
							T.nopulse++;
							if (v != null) T.nopulseShown++;
						} else {
							const ok = v != null && Math.abs(v - bpm) <= 5;
							T.scored++;
							T.right += ok;
							T.byRate[bpm] = (T.byRate[bpm] ?? 0) + ok;
						}
					}
				});
				if (res.length === 2 && bpm > 0)
					res[0].forEach((v, j) => {
						const ok = (x) => x != null && Math.abs(x - bpm) <= 5;
						if (ok(v) && !ok(res[1][j])) lost++;
						if (!ok(v) && ok(res[1][j])) gained++;
					});
			}
tot.forEach((T, i) =>
	console.log(
		`${arms[i].name}: right ${T.right} of ${T.scored} seconds with a pulse; no pulse: a number in ${T.nopulseShown} of ${T.nopulse}; by rate ${JSON.stringify(T.byRate)}`,
	),
);
if (arms.length === 2)
	console.log(`B against A: ${lost} right seconds lost, ${gained} gained`);
