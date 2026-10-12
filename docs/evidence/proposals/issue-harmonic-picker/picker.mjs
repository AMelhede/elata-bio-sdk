// Issue 1, the WASM core's harmonic picker overrides a correct peak. Synthetic input only, Node 20 or later.
//
//   node picker.mjs <pkgDir>     <pkgDir> holds pkg/ (published 0.14.0, or packages/rppg-web here)
//
// A clean sine at 60, 72, 90 and 140 bpm, 30 s at 30 fps, straight into the core. Good is the true rate.
// On 0.14.0 a true 72 reads 48 at confidence 0.88. SELFCHECK_BREAK=1 makes the self-check throw on purpose.
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { checkRate } from "../../tools/selfcheck.mjs";
const PKG = process.argv[2];
if (!PKG) {
	console.error("usage: node picker.mjs <pkgDir>");
	process.exit(2);
}
const { initSync, WasmRppgPipeline } = await import(
	pathToFileURL(`${PKG}/pkg/rppg_wasm.js`).href
);
initSync({ module: readFileSync(`${PKG}/pkg/rppg_wasm_bg.wasm`) });
const sine = (bpm, i) => 100 + Math.sin((2 * Math.PI * bpm * i) / 30 / 60);
// Self-check: the input at 72 carries 72 bpm; 30 s at 30 fps is 900 samples.
checkRate(
	"sine 72",
	Array.from({ length: 900 }, (_, i) => sine(72, i)),
	30,
	72,
	900,
);
for (const bpm of [60, 72, 90, 140]) {
	const p = new WasmRppgPipeline(30, 10);
	for (let i = 0; i < 900; i++)
		p.push_sample(BigInt(Math.round((i / 30) * 1000)), sine(bpm, i));
	const m = JSON.parse(p.get_metrics());
	console.log(
		`clean sine at ${bpm} bpm reads ${m.bpm ?? "none"} (confidence ${m.confidence.toFixed(2)})`,
	);
}
