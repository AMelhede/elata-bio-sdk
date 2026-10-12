// Fix 3, feed the fuser at the speed it was built for. Synthetic input only, Node 20 or later, no WASM needed
// (the processor is a stub that records what the runner pushes).
//
//   node grid-amp.mjs <pkgDir>     <pkgDir> holds dist/ (published 0.14.0, a fix-branch build, or packages/rppg-web here)
//
// Prints how much of the pulse's 30 fps amplitude survives at 15 fps (160 bpm) and at 60 fps (72 bpm), and when the
// first fused quality score arrives. Good is 1.00 and the same time at every frame rate.
// SELFCHECK_BREAK=1 makes the self-check throw on purpose.
import { pathToFileURL } from "node:url";
const PKG = process.argv[2];
if (!PKG) {
	console.error("usage: node grid-amp.mjs <pkgDir>");
	process.exit(2);
}
const { DemoRunner } = await import(
	pathToFileURL(`${PKG}/dist/demoRunner.js`).href
);
function rng(seed) {
	let s = seed >>> 0;
	return () => {
		s = (s * 1664525 + 1013904223) >>> 0;
		return s / 4294967296;
	};
}
function gauss(r) {
	const u = Math.max(1e-12, r());
	return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r());
}
const SIDE = 24;
function pulseFrame(t, bpm, r) {
	const width = SIDE * 3,
		height = SIDE,
		data = new Uint8ClampedArray(width * height * 4);
	const s = Math.sin(2 * Math.PI * (bpm / 60) * (t / 1000));
	const base = [200, 150, 120],
		depth = [0.33, 0.77, 0.53];
	for (let i = 0; i < data.length; i += 4) {
		for (let c = 0; c < 3; c++)
			data[i + c] = Math.round(base[c] * (1 - 0.01 * depth[c] * s) + gauss(r));
		data[i + 3] = 255;
	}
	return {
		data,
		width,
		height,
		timestampMs: t,
		rois: [0, 1, 2].map((k) => ({ x: k * SIDE, y: 0, w: SIDE, h: SIDE })),
	};
}
const framesAt = (fps, n, start = 0) =>
	Array.from({ length: n }, (_, i) => start + i * (1000 / fps));
async function film(fps, bpm, seconds, seed = 1) {
	const src = { onFrame: null, async start() {}, async stop() {} };
	const pushes = [];
	const proc = {
		pushFusedSample: (t, value, snr) => pushes.push({ t, value, snr }),
		getMetrics() {},
	};
	const runner = new DemoRunner(src, proc, {
		useSkinMask: true,
		sampleRate: 30,
	});
	await runner.start();
	const r = rng(seed);
	for (const t of framesAt(fps, Math.floor(seconds * fps) + 1))
		src.onFrame(pulseFrame(t, bpm, r));
	await runner.stop();
	return pushes;
}
function amp(p, bpm) {
	const m = p.reduce((a, x) => a + x.value, 0) / p.length;
	let re = 0,
		im = 0;
	for (const x of p) {
		const ph = 2 * Math.PI * (bpm / 60) * (x.t / 1000);
		re += (x.value - m) * Math.cos(ph);
		im += (x.value - m) * Math.sin(ph);
	}
	return (2 * Math.hypot(re, im)) / p.length;
}
const settled = (x) => x.t > 8000;
const firstQ = (p) => p.find((x) => x.snr > 0)?.t;
const a30 = await film(30, 160, 20),
	a15 = await film(15, 160, 20);
const b30 = await film(30, 72, 20),
	b60 = await film(60, 72, 20);
// Self-check: the 30 fps run must carry the pulse (amplitude well above zero) or the ratios mean nothing.
if (
	!(amp(a30.filter(settled), 160) > (process.env.SELFCHECK_BREAK ? 1e9 : 1e-4))
)
	throw new Error("self-check: no pulse at 30 fps");
console.log("self-check ok: the 30 fps run carries the pulse");
console.log(
	`160 bpm 15/30 ${(amp(a15.filter(settled), 160) / amp(a30.filter(settled), 160)).toFixed(2)}; 72 bpm 60/30 ${(amp(b60.filter(settled), 72) / amp(b30.filter(settled), 72)).toFixed(2)}; first quality 30 fps ${(firstQ(a30) / 1000).toFixed(2)} s, 15 fps ${(firstQ(a15) / 1000).toFixed(2)} s`,
);
