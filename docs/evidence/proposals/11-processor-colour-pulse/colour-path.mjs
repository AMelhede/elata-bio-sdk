// Fix 11, the processor's own colour path. Synthetic input only, Node 20 or later, no WASM needed (the engine is a
// stub that never gives a rate, so every number printed comes from the processor's own colour path).
//
//   node colour-path.mjs <pkgDir> [optionsJson]
//   e.g. node colour-path.mjs node_modules/@elata-biosciences/rppg-web
//        node colour-path.mjs <fix-branch build> '{"rgbPulse":"pos"}'
//        node colour-path.mjs packages/rppg-web '{"fixes":{"rgbPulse":true}}'   (the test build's switch for the same fix)
//
// A pulse in blood's colour direction at 50, 72 and 120 bpm at 30 fps, and 72 at 20 fps. Good is the true rate.
// SELFCHECK_BREAK=1 makes the self-check throw on purpose.
import { pathToFileURL } from "node:url";
import { checkRate } from "../../tools/selfcheck.mjs";
const [PKG, OPTS] = process.argv.slice(2);
if (!PKG) {
	console.error("usage: node colour-path.mjs <pkgDir> [optionsJson]");
	process.exit(2);
}
const { RppgProcessor } = await import(
	pathToFileURL(`${PKG}/dist/index.js`).href
);
const opts = OPTS ? JSON.parse(OPTS) : undefined;
const idle = () => ({ bpm: null, confidence: 0, signal_quality: 0 });
const backend = {
	newPipeline: () => ({ push_sample_rgb() {}, get_metrics: idle }),
};
let s = 1;
const u = () =>
	((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) + 0.5) / 2 ** 32;
const noise = () =>
	0.05 * Math.sqrt(-2 * Math.log(u())) * Math.cos(2 * Math.PI * u());
const green = (bpm, fps, i) =>
	120 * (1 - 0.0077 * Math.sin((2 * Math.PI * bpm * i) / fps / 60));
// Self-check: the noiseless green channel carries the set rate; 20 s at 30 fps is 600 samples.
checkRate(
	"green at 72",
	Array.from({ length: 600 }, (_, i) => green(72, 30, i)),
	30,
	72,
	600,
);
console.log(`options: ${OPTS ?? "none"}`);
for (const [bpm, fps] of [
	[50, 30],
	[72, 30],
	[120, 30],
	[72, 20],
]) {
	const p = opts
		? new RppgProcessor(backend, fps, 10, opts)
		: new RppgProcessor(backend, fps, 10);
	for (let i = 0; i < 30 * fps; i++) {
		const t = (i * 1000) / fps;
		const x = Math.sin((2 * Math.PI * bpm * t) / 60000);
		p.pushSampleRgb(
			t,
			170 * (1 - 0.0033 * x) + noise(),
			green(bpm, fps, i) + noise(),
			100 * (1 - 0.0053 * x) + noise(),
			1,
		);
		if ((i + 1) % fps === 0) p.getMetrics();
	}
	const m = p.getMetrics();
	console.log(
		`true ${bpm} at ${fps} fps: spectral ${m.spectral_bpm?.toFixed(1)}, bpm ${m.bpm?.toFixed(1) ?? "none"}`,
	);
}
