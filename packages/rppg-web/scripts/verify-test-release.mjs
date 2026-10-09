#!/usr/bin/env node
// Packs this package exactly as npm would publish it, installs the tarball into a throwaway app
// under BOTH names (its own, @amelhede/rppg-web, and the official name an app aliases it to,
// @elata-biosciences/rppg-web), and checks, in that app, with only Node:
//   1. both names import, and report the same build version;
//   2. the `pkg/` subpath resolves through the package's exports under both names;
//   3. the packed WASM loads, and the colour-projection switch reaches it (on by default);
//   4. known answers: a clean colour pulse at 60, 72 and 120 bpm reads within 2 bpm with every
//      fix on; with `colourProjectionFix: false` the 120 does not (the published core), which
//      proves the switch changes what the WASM does;
//   5. the packed file list holds only dist/, pkg/, README.md, llms.txt, LICENSE and package.json,
//      and LICENSE is the repo root's MIT notice, byte for byte;
//   6. the packed PulseCheck on generated scenes with known answers: a pulse at 72 shows 72; no
//      pulse, a light on the face and the wall, and a nod with no pulse show nothing (the nod shows
//      its 60 with headMotion off, which proves the scene tests the rule); a pulse at 70 under a
//      nod at 90, and under a light at 96, shows 70;
//   7. the packed ChestMotion (chestBreathing) on generated frames: a chest moving 15 times a minute
//      reads 15 within 1, a still one gives no clear line;
//   8. the packed processor with the real WASM core, read on every frame for 60 s at 30 fps: the
//      analysis runs at most once per 250 ms of samples (at 30 fps the first frame 250 ms on is the 8th,
//      so 225 times) with steadyAnalysis on, and on every read (1,800 times) with it off, and the known
//      72 still reads 72.
// BREAK=3 makes check 7 expect 20 breaths a minute instead of 15; BREAK=4 makes check 8 expect 1,800
// analyses with the switch on.
// BREAK=1 makes check 4 expect 90 bpm instead of 72, to see it go red; BREAK=2 makes check 6
// expect the nod's 60 to show with headMotion on.
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tmp = mkdtempSync(path.join(tmpdir(), "rppg-web-test-release-"));
const run = (cmd, args, cwd) => {
	const r = spawnSync(cmd, args, { cwd, encoding: "utf8", shell: process.platform === "win32" });
	if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")} failed:\n${r.stdout}\n${r.stderr}`);
	return r.stdout;
};

let failed = false;
try {
	const out = run("npm", ["pack", "--ignore-scripts", "--json", "--pack-destination", tmp], root);
	const info = JSON.parse(out)[0];
	const allowed = /^(dist\/|pkg\/|README\.md$|llms\.txt$|LICENSE$|package\.json$)/;
	const stray = info.files.map((f) => f.path).filter((p) => !allowed.test(p) || /\.test\.|__tests__|\.tsbuildinfo$/.test(p));
	if (stray.length) throw new Error(`unexpected files in the package: ${stray.join(", ")}`);
	const tgz = path.join(tmp, info.filename);
	const unpacked = path.join(tmp, "unpacked");
	mkdirSync(unpacked);
	run("tar", ["-xzf", tgz, "-C", unpacked], tmp);
	// The MIT notice must travel with every copy: the packed LICENSE is the repo root's, byte for byte.
	const packedLicence = path.join(unpacked, "package", "LICENSE");
	if (!existsSync(packedLicence)) throw new Error("the package has no LICENSE (MIT requires the notice in every copy)");
	if (!readFileSync(packedLicence).equals(readFileSync(path.join(root, "../../LICENSE"))))
		throw new Error("the packed LICENSE differs from the repo root LICENSE");
	const app = path.join(tmp, "app");
	for (const name of ["@amelhede/rppg-web", "@elata-biosciences/rppg-web"]) {
		const dir = path.join(app, "node_modules", ...name.split("/"));
		mkdirSync(path.dirname(dir), { recursive: true });
		cpSync(path.join(unpacked, "package"), dir, { recursive: true });
	}
	writeFileSync(path.join(app, "package.json"), JSON.stringify({ name: "test-release-consumer", private: true, type: "module" }));
	writeFileSync(
		path.join(app, "app.mjs"),
		`import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
const own = await import("@amelhede/rppg-web");
const aliased = await import("@elata-biosciences/rppg-web");
assert.equal(own.RPPG_WEB_BUILD_VERSION, ${JSON.stringify(info.version)});
assert.equal(aliased.RPPG_WEB_BUILD_VERSION, ${JSON.stringify(info.version)});
for (const name of ["@amelhede/rppg-web", "@elata-biosciences/rppg-web"]) {
  const js = import.meta.resolve(name + "/pkg/rppg_wasm.js");
  const wasm = import.meta.resolve(name + "/pkg/rppg_wasm_bg.wasm");
  assert.ok(js.endsWith("/pkg/rppg_wasm.js") && wasm.endsWith("/pkg/rppg_wasm_bg.wasm"), name);
}
const sdk = aliased;
const bytes = readFileSync(fileURLToPath(import.meta.resolve("@elata-biosciences/rppg-web/pkg/rppg_wasm_bg.wasm")));
const jsUrl = import.meta.resolve("@elata-biosciences/rppg-web/pkg/rppg_wasm.js");
const backend = await sdk.loadWasmBackend(async (url) => { const m = await import(url); m.initSync?.({ module: bytes }); return m; }, { strict: true, jsUrl });
assert.ok(backend, "WASM backend loads");
const glue = await import(jsUrl);
const pipe = new glue.WasmRppgPipeline(30, 10);
assert.equal(pipe.colour_projection_fix(), true, "fix on by default in the core");
pipe.set_colour_projection_fix(false);
assert.equal(pipe.colour_projection_fix(), false, "switch reaches the core");
// Every fix switch on by default except those the package lists as off by default, and every
// pulse-check light rule on by default (read from the package's own lists so a new switch cannot be
// missed the way the count of five once went stale).
assert.deepEqual(Object.keys(sdk.resolveFixSwitches()).sort(), [...sdk.FIX_SWITCH_NAMES].sort());
for (const [name, on] of Object.entries(sdk.resolveFixSwitches()))
  assert.equal(on, !sdk.FIX_SWITCHES_OFF_BY_DEFAULT.includes(name), "default of fix " + name);
assert.deepEqual(Object.keys(sdk.resolvePulseCheckRules()).sort(), [...sdk.PULSE_CHECK_RULE_NAMES].sort());
assert.ok(Object.values(sdk.resolvePulseCheckRules()).every((v) => v === true), "every light rule on by default");
function read(bpm, fixes) {
  const p = new sdk.RppgProcessor(backend, 30, 10, fixes === undefined ? {} : { fixes });
  let seed = 7; const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648) - 0.5;
  for (let i = 0; i < 900; i++) { const t = (i * 1000) / 30; const s = Math.sin((2 * Math.PI * bpm * t) / 60000);
    p.pushSampleRgbMeta(t, 0.62 * (1 - 0.003 * s) + 0.0005 * rnd(), 0.45 * (1 - 0.01 * s) + 0.0005 * rnd(), 0.38 * (1 - 0.002 * s) + 0.0005 * rnd(), 1, 0, 0); }
  return p.getMetrics().bpm;
}
const expect72 = process.env.BREAK === "1" ? 90 : 72;
for (const [bpm, want] of [[60, 60], [72, expect72], [120, 120]]) {
  const got = read(bpm);
  assert.ok(got != null && Math.abs(got - want) <= 2, "true " + bpm + " read " + got + " (fixes on)");
}
// Check 6: the packed PulseCheck on generated scenes. Three regions and the wall, each channel on
// 0..1, 30 frames a second; the head at 190 px between the cheekbones. A pulse and the light both
// carry blood's colour pattern (green dips most), so colour alone cannot tell them apart; a nod
// changes the face's shading in time with it, the same way.
function scene(o) {
  let s = 7; const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647 - 0.5);
  const c = new sdk.PulseCheck({ rules: o.rules ?? {} }); const shown = [];
  for (let i = 0; i <= 60 * 30; i++) {
    const t = (i * 1000) / 30;
    const w = (bpm) => (bpm ? Math.sin((2 * Math.PI * bpm * t) / 60000) : 0);
    const n = w(o.nod);
    const q = 0.01 * w(o.pulse) + (o.nod ? 0.008 * n : 0) + 0.005 * w(o.light);
    const reg = () => ({ r: 0.59 * (1 - 0.3 * q) + 0.0008 * rnd(), g: 0.47 * (1 - q) + 0.0008 * rnd(), b: 0.39 * (1 - 0.6 * q) + 0.0008 * rnd() });
    const l = 0.01 * w(o.light);
    const wall = { r: 0.5 * (1 - 0.15 * l) + 0.0008 * rnd(), g: 0.5 * (1 - 0.5 * l) + 0.0008 * rnd(), b: 0.5 * (1 - 0.3 * l) + 0.0008 * rnd() };
    const head = { x: 320 + 0.6 * n + 0.05 * rnd(), y: 240 + 3 * n + 0.05 * rnd(), faceWidth: 190 };
    c.push(t, [reg(), reg(), reg()], wall, undefined, head);
    if (i % 30 === 0 && i > 0) { const st = c.getState(); if (st.verdict === "measured" && st.bpm != null) shown.push(st.bpm); }
  }
  return shown;
}
const near = (a, bpm) => a.length >= 20 && a.every((b) => Math.abs(b - bpm) <= 2);
assert.ok(near(scene({ pulse: 72 }), 72), "pulse 72 should show 72");
assert.equal(scene({}).length, 0, "no pulse should show nothing");
assert.equal(scene({ light: 72 }).length, 0, "a light on the face and the wall should show nothing");
const nodOn = scene({ nod: 60 });
if (process.env.BREAK === "2") assert.ok(near(nodOn, 60), "BREAK=2: the nod's 60 expected to show");
assert.equal(nodOn.length, 0, "a nod with no pulse should show nothing");
assert.ok(near(scene({ nod: 60, rules: { headMotion: false } }), 60), "with headMotion off the nod should show its 60 (else the scene tests nothing)");
assert.ok(near(scene({ pulse: 70, nod: 90 }), 70), "pulse 70 under a nod at 90 should show 70");
assert.ok(near(scene({ pulse: 70, light: 96 }), 70), "pulse 70 under a light at 96 should show 70");
// Check 7: the packed ChestMotion (chestBreathing) on generated frames: a textured chest under a face,
// moving half a pixel up and down 15 times a minute at 15 frames a second, reads 15; a still one gives
// no clear line.
function chestRate(bpm, ampPx) {
  const FW = 160, FH = 120; const face = [{ x: 0.4, y: 0.1 }, { x: 0.6, y: 0.1 }, { x: 0.5, y: 0.4 }];
  const m = new sdk.ChestMotion();
  for (let i = 0; i < 15 * 36; i++) {
    const t = i / 15; const d = ampPx * Math.sin(2 * Math.PI * (bpm / 60) * t); const data = new Uint8ClampedArray(FW * FH * 4);
    for (let y = 0; y < FH; y++) for (let x = 0; x < FW; x++) { const v = 120 + 50 * Math.sin(0.19 * (y - d) + 0.07 * x) + 20 * Math.cos(0.11 * (y - d)); const k = (y * FW + x) * 4; data[k] = data[k + 1] = data[k + 2] = v; data[k + 3] = 255; }
    m.push({ data, width: FW, height: FH, timestampMs: t * 1000 }, face);
  }
  return m.rate();
}
const breathWant = process.env.BREAK === "3" ? 20 : 15;
const breathing = chestRate(15, 0.5);
assert.ok(breathing && Math.abs(breathing.rate - breathWant) <= 1, "chest moving 15 a minute should read " + breathWant + ", read " + JSON.stringify(breathing));
const stillChest = chestRate(15, 0);
assert.ok(stillChest == null || stillChest.share < 0.5, "a still chest should give no clear line, gave " + JSON.stringify(stillChest));
// Check 8: steadyAnalysis on the packed processor and the real core. Every analysis is a call to the
// core's get_metrics; reading on every frame must not multiply them.
function analysesWhenReadEveryFrame(fixes) {
  let calls = 0;
  const counted = { newPipeline: (sr, ws) => { const p = backend.newPipeline(sr, ws); const g = p.get_metrics.bind(p); p.get_metrics = () => { calls++; return g(); }; return p; } };
  const p = new sdk.RppgProcessor(counted, 30, 10, { fixes });
  let last = null;
  for (let i = 0; i < 1800; i++) { const t = (i * 1000) / 30; const s = Math.sin((2 * Math.PI * 72 * t) / 60000);
    p.pushSampleRgbMeta(t, 0.62 * (1 - 0.003 * s), 0.45 * (1 - 0.01 * s), 0.38 * (1 - 0.002 * s), 1, 0, 0); last = p.getMetrics().bpm; }
  return { calls, last };
}
const steadyOn = analysesWhenReadEveryFrame({});
const steadyOff = analysesWhenReadEveryFrame({ steadyAnalysis: false });
// At 30 fps the first frame at least 250 ms after an analysis is the 8th (267 ms): 1,800 / 8 = 225.
const steadyWant = process.env.BREAK === "4" ? 1800 : Math.ceil(1800 / Math.ceil(250 / (1000 / 30)));
assert.ok(Math.abs(steadyOn.calls - steadyWant) <= 1, "steadyAnalysis on: " + steadyWant + " analyses expected, ran " + steadyOn.calls);
assert.equal(steadyOff.calls, 1800, "steadyAnalysis off: one analysis per read");
assert.ok(steadyOn.last != null && Math.abs(steadyOn.last - 72) <= 2, "steadyAnalysis on: 72 should read 72, read " + steadyOn.last);
const off = read(120, { colourProjectionFix: false });
assert.ok(off == null || Math.abs(off - 120) > 2, "colourProjectionFix:false should give the published core's answer, read " + off);
console.log("[rppg-web test release] packed " + ${JSON.stringify(info.filename)} + ": imports under both names, pkg/ resolves, WASM switch works, known answers pass (on: 60/72/120 read right; core switch off: 120 read " + off + "); pulse check: 72 shown, no pulse / light / nod silent, 70 under a nod and under a light; chest motion: 15 a minute read " + breathing.rate.toFixed(1) + ", a still chest no clear line; steady analysis: " + steadyOn.calls + " analyses read on every frame (off: " + steadyOff.calls + "), 72 read " + steadyOn.last + ".");
`,
	);
	console.log(run(process.execPath, ["app.mjs"], app).trim());
	console.log(`[rppg-web test release] ${info.entryCount} files, ${info.size} bytes packed, ${info.unpackedSize} unpacked.`);
} catch (error) {
	failed = true;
	console.error(`[rppg-web test release] verification FAILED: ${error instanceof Error ? error.message : String(error)}`);
} finally {
	rmSync(tmp, { recursive: true, force: true });
}
process.exitCode = failed ? 1 : 0;
