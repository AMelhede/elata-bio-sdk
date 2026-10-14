// Rule screenLight, no data: a still face with NO pulse, lit only by a screen showing video, fed to the
// pulse check at the two value scales callers use (0 to 255, and 0 to 1 as the session's skin-masked
// region mean sends it). Node 20+.
//   node screen-light.mjs <rppg-web dir>      a built package dir with dist/pulseCheck.js (tsc -p . is enough)
// Expected on this proposal's tree: rule off shows a made-up rate, rule on shows none, at both scales.
// On the base (release/test-1 e3e44c3) the rule does not exist, so "on" behaves as "off".
// Self-check first: a 70 bpm chromatic pulse in steady light must read within 3 bpm with the rule on.
//   BREAK=pulse   breaks the self-check on purpose (expects 60), so it must throw.
import { pathToFileURL } from "node:url";
const dir = process.argv[2] ?? ".";
const { PulseCheck } = await import(pathToFileURL(`${dir}/dist/pulseCheck.js`).href);

// Every 0.3 to 1.5 s the light's level jumps x0.85 to x1.15 and its tint by up to 6 levels, the same on
// all three regions, plus sensor noise. Rows: [t ms, forehead rgb, left cheek rgb, right cheek rgb].
function screenRows(seconds, seed) {
	let r = seed >>> 0;
	const rng = () => (r = (r * 1664525 + 1013904223) >>> 0) / 4294967296;
	const steps = [];
	let next = 0;
	for (let t = 0; t < 24; t += 1 / 30)
		if (t >= next) {
			next = t + 0.3 + rng() * 1.2;
			steps.push([t, 0.85 + rng() * 0.3, (rng() - 0.5) * 12, (rng() - 0.5) * 12]);
		}
	let s = 5;
	const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647 - 0.5) * 0.6;
	const out = [];
	for (let t = 0; t <= seconds * 1000; t += 1000 / 30) {
		const lt = (t / 1000) % 24;
		let c = steps[0];
		for (const x of steps) if (x[0] <= lt) c = x;
		const [, k, du, dv] = c;
		const reg = () => [150 * k + 1.596 * dv + rnd(), 120 * k - 0.392 * du - 0.813 * dv + rnd(), 100 * k + 2.017 * du + rnd()];
		out.push([Math.round(t), ...reg(), ...reg(), ...reg()]);
	}
	return out;
}
function pulseRows(seconds, bpm) {
	let s = 7;
	const noise = () => ((s = (s * 16807) % 2147483647) / 2147483647 - 0.5) * 0.3;
	const out = [];
	for (let t = 0; t <= seconds * 1000; t += 1000 / 30) {
		const p = 0.008 * Math.sin((2 * Math.PI * bpm * t) / 60000);
		const reg = () => [150 * (1 - 0.3 * p) + noise(), 120 * (1 - p) + noise(), 100 * (1 - 0.6 * p) + noise()];
		out.push([Math.round(t), ...reg(), ...reg(), ...reg()]);
	}
	return out;
}
function run(rows, screenLight) {
	const check = new PulseCheck({ rules: { screenLight } });
	const shown = [];
	let steps = 0;
	let next = 1000;
	for (const x of rows) {
		const rgb = (i) => ({ r: x[1 + 3 * i], g: x[2 + 3 * i], b: x[3 + 3 * i] });
		check.push(x[0], [rgb(0), rgb(1), rgb(2)]);
		if (x[0] >= next) {
			const st = check.getState();
			if (st.verdict === "measured" && st.bpm != null) shown.push(st.bpm);
			steps = Math.max(steps, st.windowScreenSteps ?? 0);
			next += 1000;
		}
	}
	return { shown, steps };
}
const want = process.env.BREAK === "pulse" ? 60 : 70;
const k = run(pulseRows(45, 70), true).shown;
if (k.length < 10 || k.some((b) => Math.abs(b - want) > 3)) throw new Error(`self-check: a known 70 read ${k.join(" ")}`);
console.log(`self-check ok: known 70 shown in ${k.length} s, ${Math.min(...k).toFixed(1)} to ${Math.max(...k).toFixed(1)}`);
for (const [scale, f] of [["0 to 255", 1], ["0 to 1", 1 / 255]])
	for (const seed of [2, 4, 6, 7, 8]) {
		const rows = screenRows(90, seed).map((x) => [x[0], ...x.slice(1).map((v) => v * f)]);
		const off = run(rows, false);
		const on = run(rows, true);
		console.log(`no pulse, screen seed ${seed}, ${scale}: rule off a rate in ${off.shown.length} of 90 s; rule on ${on.shown.length} (most steps in a window ${on.steps})`);
	}
