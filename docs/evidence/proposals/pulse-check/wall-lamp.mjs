// The wall bar (WALL_MIN_SNR_DB, 12 dB): how strongly a flickering lamp shows on the wall beside the face, through the
// package's own PulseCheck. Synthetic input only, Node 20 or later, no WASM needed.
//
//   node wall-lamp.mjs <pkgDir> [lamp depth, default 0.03] [lamp per minute, default 72] [noise sd DN, default 1] [seeds, default 3]
//   e.g. node wall-lamp.mjs node_modules/@elata-biosciences/rppg-web
//
// The wall is a grey patch at 100 DN per channel whose light swings by `depth` (0.03 = 3%) at the lamp's rate, plus
// independent sensor noise on each channel every frame (30 frames a second, 30 s). The face regions carry no pulse.
// Prints the wall line the check finds (getState().wallLine) at 20 s and 30 s for each seed, against the 12 dB bar.
// The input is checked first: the wall's brightness must carry the lamp's rate (tools/selfcheck.mjs).
import { pathToFileURL } from "node:url";
import { checkRate } from "../../tools/selfcheck.mjs";

const [DIR, DEPTH = "0.03", LAMP = "72", NOISE = "1", SEEDS = "3"] = process.argv.slice(2);
if (!DIR) {
	console.error("usage: node wall-lamp.mjs <pkgDir> [depth] [lamp per minute] [noise sd] [seeds]");
	process.exit(2);
}
const sdk = await import(pathToFileURL(`${DIR}/dist/index.js`).href);
const FS = 30;
const SECS = 30;

function rng(seed) {
	let s = seed >>> 0;
	return () => {
		s = (s * 1664525 + 1013904223) >>> 0;
		return s / 4294967296;
	};
}
function gauss(r) {
	return Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r());
}

for (let seed = 1; seed <= Number(SEEDS); seed++) {
	const r = rng(seed);
	const n = FS * SECS;
	const wall = [];
	for (let i = 0; i < n; i++) {
		const k = 1 + Number(DEPTH) * Math.sin((2 * Math.PI * Number(LAMP) * i) / FS / 60);
		wall.push({ r: 100 * k + Number(NOISE) * gauss(r), g: 100 * k + Number(NOISE) * gauss(r), b: 100 * k + Number(NOISE) * gauss(r) });
	}
	checkRate(`seed ${seed} wall`, wall.map((w) => w.r + w.g + w.b), FS, Number(LAMP), n);
	const check = new sdk.PulseCheck();
	const face = () => ({ r: 150 + gauss(r), g: 110 + gauss(r), b: 90 + gauss(r) });
	const out = [];
	for (let i = 0; i < n; i++) {
		check.push((i * 1000) / FS, [face(), face(), face()], wall[i]);
		if (i === 20 * FS - 1 || i === n - 1) {
			const line = check.getState().wallLine;
			out.push(line ? `${line.bpm.toFixed(1)} bpm at ${line.snrDb.toFixed(1)} dB` : "none");
		}
	}
	console.log(`seed ${seed}: wall line at 20 s ${out[0]}, at 30 s ${out[1]} (bar 12 dB; lamp ${LAMP}/min, depth ${DEPTH}, noise ${NOISE} DN)`);
}
