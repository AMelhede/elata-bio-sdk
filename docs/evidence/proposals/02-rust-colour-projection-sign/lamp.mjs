// Fix 2, the WASM core's colour projection. A pulse under a flickering lamp, fed as camera colour to RppgProcessor
// (pushSampleRgb), real WASM, Node 20 or later. Synthetic input only.
//
//   node lamp.mjs <pkgDir> <pulse bpm or 0> <lamp per minute> [noise sd] [seconds] [seed]
//   e.g. node lamp.mjs node_modules/@elata-biosciences/rppg-web 90 60
//
// <pkgDir> holds dist/ and pkg/ (published 0.14.0, or a build of the fix branch with its pkg/).
// The core's projection sign lives in the WASM, so the test build in this branch carries the fix too
// (its colourProjectionFix switch). With the sign as published, the lamp wins: a true 90 under a lamp at 60 reads
// near the lamp's rate. With the fix, the pulse wins.
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { checkRate } from "../../tools/selfcheck.mjs";

const [DIR, PULSE = "90", LAMP = "60", NOISE = "0.3", SECS = "30", SEED = "1"] =
	process.argv.slice(2);
if (!DIR) {
	console.error(
		"usage: node lamp.mjs <pkgDir> <pulse bpm or 0> <lamp per minute> [noise] [seconds] [seed]",
	);
	process.exit(2);
}
const sdk = await import(pathToFileURL(`${DIR}/dist/index.js`).href);
const wasm = readFileSync(`${DIR}/pkg/rppg_wasm_bg.wasm`);
const backend = await sdk.loadWasmBackend(
	async (u) => {
		const m = await import(u);
		m.initSync?.({ module: wasm });
		return m;
	},
	{ strict: true, jsUrl: pathToFileURL(`${DIR}/pkg/rppg_wasm.js`).href },
);
if (!backend) throw new Error("no WASM backend");
let s = Number(SEED) >>> 0 || 1;
const u = () =>
	((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) + 0.5) / 2 ** 32;
const gauss = () => {
	let a = 0;
	for (let i = 0; i < 12; i++) a += u();
	return a - 6;
};
const a = 0.004 / 0.77;
const nz = Number(NOISE);
const pulse = Number(PULSE);
const lamp = Number(LAMP);
const sample = (i, noise) => {
	const t = i / 30;
	const p = pulse ? Math.sin((2 * Math.PI * pulse * t) / 60) : 0;
	const k = 1 + 0.01 * Math.sin((2 * Math.PI * lamp * t) / 60 + 0.7);
	return [
		150 * k * (1 - 0.33 * a * p) + noise * gauss(),
		120 * k * (1 - 0.77 * a * p) + noise * gauss(),
		100 * k * (1 - 0.53 * a * p) + noise * gauss(),
	];
};
// Self-check: the lamp alone (no pulse, no noise) must carry the lamp's rate; then the colour difference G/R, which
// a lamp cannot move, must carry the pulse's rate. 20 s at 30 fps is 600 samples.
if (lamp >= 40)
	checkRate(
		"lamp",
		Array.from({ length: 600 }, (_, i) => sample(i, 0)[1]),
		30,
		lamp,
		600,
	);
if (pulse)
	checkRate(
		"pulse",
		Array.from({ length: 600 }, (_, i) => {
			const c = sample(i, 0);
			return c[1] / c[0];
		}),
		30,
		pulse,
		600,
	);
const proc = new sdk.RppgProcessor(backend, 30, 10);
const rows = [];
for (let i = 0; i < Number(SECS) * 30; i++) {
	const c = sample(i, nz);
	proc.pushSampleRgb(Math.trunc((i / 30) * 1000), c[0], c[1], c[2], 1);
	if ((i + 1) % 30 === 0) rows.push(proc.getMetrics());
}
const f = (x, d = 0) =>
	x == null || Number.isNaN(x) ? "-" : Number(x).toFixed(d);
const last15 = rows.slice(-15);
const right = last15.filter(
	(m) => m.bpm != null && Math.abs(m.bpm - pulse) <= 5,
).length;
console.log(
	`${sdk.RPPG_WEB_BUILD_VERSION ?? "published 0.14.0"}: pulse ${pulse}, lamp ${lamp}, noise ${nz}`,
);
console.log(`bpm, last 15 s: ${last15.map((m) => f(m.bpm)).join(" ")}`);
console.log(`seconds of the last 15 within 5 bpm of the pulse: ${right} of 15`);
