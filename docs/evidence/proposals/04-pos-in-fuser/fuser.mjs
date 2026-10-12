// Fix 4, POS in the multi-region fuser. Synthetic input only, Node 20 or later, no WASM needed.
//
//   node fuser.mjs <pkgDir>     <pkgDir> holds dist/ (published 0.14.0, a fix-branch build, or packages/rppg-web here)
//
// Three face regions carry a 72 bpm pulse in blood's colour direction plus a little sensor noise. The fuser's output
// is read with a plain DFT over its last 10 s, for five noise seeds. Good is 72 every time.
// On 0.14.0 every row is CHROM (the fourth constructor argument does not exist and is ignored).
// SELFCHECK_BREAK=1 makes the self-check throw on purpose.
import { pathToFileURL } from "node:url";
import { checkRate } from "../../tools/selfcheck.mjs";
const PKG = process.argv[2];
if (!PKG) {
	console.error("usage: node fuser.mjs <pkgDir>");
	process.exit(2);
}
const { MultiRoiRppgFuser } = await import(
	pathToFileURL(`${PKG}/dist/multiRoiFusion.js`).href
);
const { ChromPulseModel } = await import(
	pathToFileURL(`${PKG}/dist/rppgSignalModel.js`).href
);
// Self-check: the generated region colour (green over red, noiseless) carries 72 bpm; 20 s at 30 fps is 600 samples.
checkRate(
	"region colour",
	Array.from({ length: 600 }, (_, i) => {
		const p = 0.004 * Math.sin((2 * Math.PI * 1.2 * i) / 30);
		return (120 * (1 + 0.77 * p)) / (180 * (1 + 0.33 * p));
	}),
	30,
	72,
	600,
);
const fs = 30;
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const sd = (a) => Math.sqrt(mean(a.map((v) => (v - mean(a)) ** 2)));
const rng = (s) => () => (s = (s * 1664525 + 1013904223) >>> 0) / 0xffffffff;
const gauss = (r) => {
	let u = 0;
	while (u === 0) u = r();
	return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r());
};
function peakBpm(x) {
	let best = 0,
		bestHz = 0;
	for (let hz = 0.7; hz <= 3.5; hz += 0.01) {
		let re = 0,
			im = 0;
		x.forEach((v, i) => {
			const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (x.length - 1));
			re += w * v * Math.cos((2 * Math.PI * hz * i) / fs);
			im += w * v * Math.sin((2 * Math.PI * hz * i) / fs);
		});
		if (re * re + im * im > best) {
			best = re * re + im * im;
			bestHz = hz;
		}
	}
	return Math.round(bestHz * 60);
}
function read(projection, seed) {
	// on main the fourth argument does not exist and is ignored
	const fuser = new MultiRoiRppgFuser(fs, 8, 0.5, projection),
		r = rng(seed),
		out = [];
	for (let i = 0; i < 600; i++) {
		const p = 0.004 * Math.sin((2 * Math.PI * 1.2 * i) / fs);
		const s = () => ({
			r: 180 * (1 + 0.33 * p) + 0.1 * gauss(r),
			g: 120 * (1 + 0.77 * p) + 0.1 * gauss(r),
			b: 100 * (1 + 0.53 * p) + 0.1 * gauss(r),
		});
		out.push(
			fuser.pushFrame({ forehead: s(), leftCheek: s(), rightCheek: s() }).fused,
		);
	}
	return peakBpm(out.slice(-300));
}
const row = (label, projection) =>
	console.log(
		label.padEnd(44),
		[1, 2, 3, 4, 5].map((s) => read(projection, s)).join(", "),
	);
row("default projection", undefined);
row('CHROM (main\'s default; "chrom" on the branch)', "chrom");
// ChromPulseModel with the window mean of X and Y removed before combining; nothing else changed.
ChromPulseModel.prototype.process = function (r, g, b) {
	const q = (this.q ??= []);
	q.push([r, g, b]);
	if (q.length > 45) q.shift();
	if (q.length < 10) return 0;
	const m = [0, 1, 2].map((c) => mean(q.map((v) => v[c])));
	const X = q.map((v) => (3 * v[0]) / m[0] - (2 * v[1]) / m[1]);
	const Y = q.map(
		(v) => (1.5 * v[0]) / m[0] + v[1] / m[1] - (1.5 * v[2]) / m[2],
	);
	return X.at(-1) - mean(X) - (sd(X) / sd(Y)) * (Y.at(-1) - mean(Y));
};
row("CHROM with mean(X), mean(Y) removed", "chrom");
