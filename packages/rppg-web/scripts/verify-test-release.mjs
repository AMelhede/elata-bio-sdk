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
//      and LICENSE is the repo root's MIT notice, byte for byte.
// BREAK=1 makes check 4 expect 90 bpm instead of 72, to see it go red.
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
assert.deepEqual(Object.values(sdk.resolveFixSwitches()), [true, true, true, true, true]);
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
const off = read(120, { colourProjectionFix: false });
assert.ok(off == null || Math.abs(off - 120) > 2, "colourProjectionFix:false should give the published core's answer, read " + off);
console.log("[rppg-web test release] packed " + ${JSON.stringify(info.filename)} + ": imports under both names, pkg/ resolves, WASM switch works, known answers pass (on: 60/72/120 read right; core switch off: 120 read " + off + ").");
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
