// Fix 1, no face means no reading. Synthetic input only, real WASM engine, Node 20 or later.
//
//   node face-gap.mjs <pkgDir> gap <seconds> [seed]   the person leaves for <seconds> at 45 s (the camera sees a wall)
//   node face-gap.mjs <pkgDir> miss <ms> [seed]       the face stays, but the face finder loses it for <ms> at 15 s
//
// <pkgDir> is a built rppg-web package: a folder holding dist/ and pkg/, for example
// node_modules/@elata-biosciences/rppg-web (published 0.14.0) or packages/rppg-web on this branch (the test build).
// The true rate is 66 bpm. It prints what an app polling session.getMetrics() once a second would show.
// SELFCHECK_BREAK=1 breaks the self-check on purpose (it must then throw).
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const [PKG, mode = "gap", len = "30", seedArg = "1"] = process.argv.slice(2);
if (!PKG || !["gap", "miss"].includes(mode)) {
	console.error("usage: node face-gap.mjs <pkgDir> gap|miss <len> [seed]");
	process.exit(2);
}
const at = (f) => pathToFileURL(`${PKG}/${f}`).href;
const { DemoRunner } = await import(at("dist/demoRunner.js"));
const { RppgProcessor } = await import(at("dist/rppgProcessor.js"));
const { RppgSession } = await import(at("dist/rppgSession.js"));
const { initSync, WasmRppgPipeline } = await import(at("pkg/rppg_wasm.js"));
initSync({ module: readFileSync(`${PKG}/pkg/rppg_wasm_bg.wasm`) });

const TRUE = 66;
const START = mode === "gap" ? 45000 : 15000;
const LEN = mode === "gap" ? Number(len) * 1000 : Number(len);
const END = mode === "gap" ? START + LEN + 65000 : 60000;
let s = Number(seedArg) >>> 0;
const dither = () => {
	s = (s * 1664525 + 1013904223) >>> 0;
	return s / 2 ** 32 - 0.5;
};
const rois = [
	{ x: 35, y: 15, w: 30, h: 20 },
	{ x: 15, y: 50, w: 25, h: 25 },
	{ x: 60, y: 50, w: 25, h: 25 },
];
function frame(t, face, found) {
	const data = new Uint8ClampedArray(100 * 100 * 4);
	const p = Math.sin((2 * Math.PI * TRUE * t) / 60000);
	const a = 0.03;
	for (let i = 0; i < data.length; i += 4) {
		const c = face
			? [200 * (1 - 0.33 * a * p), 140 * (1 - a * p), 110 * (1 - 0.5 * a * p)]
			: [150, 145, 140];
		for (let k = 0; k < 3; k++) data[i + k] = c[k] + dither();
		data[i + 3] = 255;
	}
	return found
		? { data, width: 100, height: 100, timestampMs: t, rois }
		: { data, width: 100, height: 100, timestampMs: t };
}

// Self-check: an independent DFT of the generated face's mean green over 20 s must find the set rate within 2 bpm,
// and 20 s at 30 fps must be 600 frames. If either fails, the numbers below would mean nothing.
{
	const g = [];
	for (let i = 0; i < 600; i++) {
		const f = frame((i * 1000) / 30, true, true).data;
		let sum = 0;
		for (let k = 1; k < f.length; k += 4) sum += f[k];
		g.push(sum / (f.length / 4));
	}
	const mean = g.reduce((x, y) => x + y, 0) / g.length;
	let best = 0;
	let bestBpm = 0;
	for (let bpm = 40; bpm <= 180; bpm += 0.25) {
		let re = 0;
		let im = 0;
		g.forEach((v, i) => {
			const ph = (2 * Math.PI * bpm * i) / 30 / 60;
			re += (v - mean) * Math.cos(ph);
			im += (v - mean) * Math.sin(ph);
		});
		if (re * re + im * im > best) {
			best = re * re + im * im;
			bestBpm = bpm;
		}
	}
	const want = process.env.SELFCHECK_BREAK ? TRUE + 10 : TRUE;
	if (Math.abs(bestBpm - want) > 2 || g.length !== 600)
		throw new Error(
			`self-check failed: input reads ${bestBpm} bpm over ${g.length} frames, expected ${want} over 600`,
		);
	console.log(
		`self-check ok: the generated face carries ${bestBpm} bpm (set ${TRUE}), 600 frames in 20 s`,
	);
}

// What createRppgSession builds in face_mesh mode with no roi, minus the camera and the face finder.
// requireFace is what the fixed createRppgSession passes; 0.14.0 ignores it.
const source = { onFrame: null, async start() {}, async stop() {} };
const processor = new RppgProcessor(
	{ newPipeline: (fs, w) => new WasmRppgPipeline(fs, w) },
	30,
	10,
	{},
);
processor.enableTracker(55, 150, 200);
const runner = new DemoRunner(source, processor, {
	sampleRate: 30,
	roiSmoothingAlpha: 0.25,
	useSkinMask: true,
	requireFace: true,
});
const session = new RppgSession(source, processor, runner, "wasm", "face_mesh");
await runner.start();
const shown = [];
for (let i = 0; i < (END * 30) / 1000; i++) {
	const t = (i * 1000) / 30;
	const out = t >= START && t < START + LEN;
	source.onFrame(frame(t, mode === "miss" || !out, !out));
	if ((i + 1) % 30 === 0) {
		const b = session.getMetrics().bpm;
		shown.push({
			t: (i + 1) / 30,
			bpm: typeof b === "number" ? Math.round(b) : null,
		});
	}
}
const right = (x) => x.bpm != null && Math.abs(x.bpm - TRUE) <= 5;
const during = shown.filter(
	(x) => x.t * 1000 > START && x.t * 1000 <= START + LEN,
);
const after = shown.filter((x) => x.t * 1000 > START + LEN);
const first = after.find(right);
console.log(
	`${mode} ${len}, seed ${seedArg}:`,
	mode === "gap"
		? `a number in ${during.filter((x) => x.bpm != null).length}/${during.length} s of the gap,`
		: "",
	`after it right ${after.filter(right).length}/${after.length} s, wrong number ${after.filter((x) => x.bpm != null && !right(x)).length},`,
	`first right ${first ? Math.round(first.t - (START + LEN) / 1000) : "never"} s after; first 8 s after: ${after
		.slice(0, 8)
		.map((x) => x.bpm)
		.join(" ")}`,
);
