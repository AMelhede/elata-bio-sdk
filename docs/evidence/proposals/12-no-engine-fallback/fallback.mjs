// Fix 12 (withdrawn as code, kept as an issue): the processor shows the engine's unchecked rate when its own checks
// refuse one. Synthetic input only, Node 20 or later, no WASM needed (the engine is a stub that always says 88).
//
//   node fallback.mjs <pkgDir> [optionsJson]
//
// The input has no pulse at all. Good is no number. The last line shows that fused_bpm, a field apps can already
// read, is null while bpm shows 88: that is why the code change was withdrawn in favour of the issue.
// SELFCHECK_BREAK=1 makes the self-check throw on purpose.
import { pathToFileURL } from "node:url";
const [PKG, OPTS] = process.argv.slice(2);
if (!PKG) {
	console.error("usage: node fallback.mjs <pkgDir> [optionsJson]");
	process.exit(2);
}
const { RppgProcessor } = await import(
	pathToFileURL(`${PKG}/dist/index.js`).href
);
const engine = {
	newPipeline: () => ({
		push_sample_rgb() {},
		get_metrics: () => ({ bpm: 88, confidence: 0.2, signal_quality: 0.8 }),
	}),
};
let s = 1;
const u = () =>
	((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) + 0.5) / 2 ** 32;
const noise = () =>
	0.05 * Math.sqrt(-2 * Math.log(u())) * Math.cos(2 * Math.PI * u());
// Self-check: the input really has no pulse. The noise's standard deviation must be near 0.05 grey levels and its
// mean near 0, over 600 draws; a generator that leaked a rhythm or a scale error would fail this.
{
	const xs = Array.from({ length: 600 }, noise);
	const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
	const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length);
	const want = process.env.SELFCHECK_BREAK ? 0.5 : 0.05;
	if (Math.abs(sd - want) > 0.01 || Math.abs(mean) > 0.01)
		throw new Error(
			`self-check failed: noise sd ${sd.toFixed(3)}, mean ${mean.toFixed(3)}, expected sd ${want}`,
		);
	console.log(
		`self-check ok: noise only, sd ${sd.toFixed(3)} grey levels, mean ${mean.toFixed(3)}, 600 samples`,
	);
	s = 1;
}
const p = OPTS
	? new RppgProcessor(engine, 30, 10, JSON.parse(OPTS))
	: new RppgProcessor(engine, 30, 10);
const shown = [];
for (let i = 0; i < 20 * 30; i++) {
	p.pushSampleRgb(
		(i * 1000) / 30,
		170 + noise(),
		120 + noise(),
		100 + noise(),
		1,
	);
	if ((i + 1) % 30 === 0) shown.push(`${p.getMetrics().bpm ?? "none"}`);
}
const m = p.getMetrics();
console.log(`bpm each second: ${shown.join(" ")}`);
console.log(
	`last read: bpm ${m.bpm}, fused_bpm ${m.fused_bpm}, fused_source ${m.fused_source}, confidence ${m.confidence.toFixed(2)}`,
);
