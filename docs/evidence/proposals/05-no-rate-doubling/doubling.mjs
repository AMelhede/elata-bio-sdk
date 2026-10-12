// Fix 5, the spectral estimator stops doubling resting rates. Synthetic input only, Node 20 or later, no WASM needed.
//
//   node doubling.mjs <pkgDir>     <pkgDir> holds dist/ (published 0.14.0, a fix-branch build, or packages/rppg-web here)
//
// 1. estimateDominantBpm on a 65 bpm pulse with a second harmonic at 0.6 of its strength. Good is 65 or 66.
// 2. RppgProcessor fed a grey pulse at 60 and 72 bpm with harmonics 0.5 and 0.4. Good is 60 and 72.
// SELFCHECK_BREAK=1 makes the self-check throw on purpose.
import { pathToFileURL } from "node:url";
import { checkRate } from "../../tools/selfcheck.mjs";
const PKG = process.argv[2];
if (!PKG) {
	console.error("usage: node doubling.mjs <pkgDir>");
	process.exit(2);
}
const { estimateDominantBpm, RppgProcessor } = await import(
	pathToFileURL(`${PKG}/dist/index.js`).href
);
const fs = 30;
const f = 65 / 60;
const x = Array.from(
	{ length: fs * 10 },
	(_, i) =>
		Math.sin((2 * Math.PI * f * i) / fs) +
		0.6 * Math.sin((2 * Math.PI * 2 * f * i) / fs + 0.8),
);
// Self-check: the input's strongest line is the 65 bpm fundamental, not the harmonic; 10 s at 30 fps is 300 samples.
checkRate("65 bpm with harmonic 0.6", x, fs, 65, 300);
console.log(
	`estimateDominantBpm, true 65: ${estimateDominantBpm(x, fs, 0.7, 3.3).bpm.toFixed(1)}`,
);

const idle = () => ({ bpm: null, confidence: 0.1, signal_quality: 0.9 });
const backend = {
	newPipeline: () => ({
		push_sample_rgb_meta() {},
		get_metrics: idle,
		getMetrics: idle,
		free() {},
	}),
};
for (const [bpm, h2] of [
	[60, 0.5],
	[72, 0.4],
]) {
	const p = new RppgProcessor(backend, fs, 10);
	const fr = bpm / 60;
	for (let i = 0; i < fs * 30; i++) {
		const v =
			0.5 +
			0.02 *
				(Math.sin((2 * Math.PI * fr * i) / fs) +
					h2 * Math.sin((2 * Math.PI * 2 * fr * i) / fs + 0.8));
		p.pushSampleRgbMeta((i * 1000) / fs, v, v, v, 0.9, 0.01, 0.01);
	}
	const m = p.getMetrics();
	console.log(
		`RppgProcessor, true ${bpm} (harmonic ${h2}): bpm ${m.bpm == null ? "withheld" : m.bpm.toFixed(1)}, confidence ${m.confidence.toFixed(2)}`,
	);
}
