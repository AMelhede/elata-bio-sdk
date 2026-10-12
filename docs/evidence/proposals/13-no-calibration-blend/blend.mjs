// Fix 13, show the rate the processor settled on, not the calibration blend. Synthetic input only, Node 20 or
// later, no WASM needed (the engine is a stub).
//
//   node blend.mjs <pkgDir> [optionsJson]
//   e.g. node blend.mjs node_modules/@elata-biosciences/rppg-web
//        node blend.mjs <fix-branch build> '{"calibrationBlend":false}'
//
// A grey pulse at 120 bpm with a second harmonic. Good is 120 every second.
// SELFCHECK_BREAK=1 makes the self-check throw on purpose.
import { pathToFileURL } from "node:url";
import { checkRate } from "../../tools/selfcheck.mjs";
const [PKG, OPTS] = process.argv.slice(2);
if (!PKG) {
	console.error("usage: node blend.mjs <pkgDir> [optionsJson]");
	process.exit(2);
}
const { RppgProcessor } = await import(
	pathToFileURL(`${PKG}/dist/index.js`).href
);
const engine = {
	newPipeline: () => ({
		push_sample_rgb_meta() {},
		get_metrics: () => ({ bpm: 120, confidence: 0.8, signal_quality: 0.9 }),
	}),
};
const v = (i) => {
	const x = (2 * Math.PI * 120 * i) / (60 * 30);
	return 0.5 + 0.02 * (Math.sin(x) + 0.4 * Math.sin(2 * x + 0.8));
};
// Self-check: the input's strongest line is 120 bpm; 20 s at 30 fps is 600 samples.
checkRate(
	"grey 120",
	Array.from({ length: 600 }, (_, i) => v(i)),
	30,
	120,
	600,
);
const p = OPTS
	? new RppgProcessor(engine, 30, 10, JSON.parse(OPTS))
	: new RppgProcessor(engine, 30, 10);
const shown = [];
for (let i = 0; i < 30 * 30; i++) {
	p.pushSampleRgbMeta((i * 1000) / 30, v(i), v(i), v(i), 1, 0, 0);
	if ((i + 1) % 30 === 0 && i >= 16 * 30)
		shown.push(p.getMetrics().bpm.toFixed(1));
}
const m = p.getMetrics();
console.log(`options: ${OPTS ?? "none"}`);
console.log(`bpm each second from 17 s: ${shown.join(" ")}`);
console.log(
	`last read: bpm ${m.bpm.toFixed(1)}, calibrated_bpm ${m.calibrated_bpm?.toFixed(1)}, resolved_bpm ${m.resolved_bpm?.toFixed(1)}, spectral_bpm ${m.spectral_bpm?.toFixed(1)}, acf_bpm ${m.acf_bpm?.toFixed(1)}`,
);
