#!/usr/bin/env node
// Runs before `npm pack` / `npm publish` / `npm stage publish` (prepack, prepublishOnly).
// Needs only Node: the built files are committed on this branch, so publishing needs no
// Rust or TypeScript toolchain. Fails loudly instead of publishing something wrong.
//   node scripts/check-test-release.mjs            files, version, licence, switch in the WASM, scrub
//   node scripts/check-test-release.mjs --publish  the same, plus: the npm tag is not 'latest'
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
const problems = [];

for (const f of [
	"dist/index.js",
	"dist/index.d.ts",
	"dist/buildInfo.js",
	"dist/fixSwitches.js",
	"dist/pulseCheck.js",
	"pkg/rppg_wasm.js",
	"pkg/rppg_wasm_bg.wasm",
]) {
	if (!existsSync(path.join(root, f))) problems.push(`missing ${f}`);
}

if (pkg.name !== "@amelhede/rppg-web") problems.push(`name is ${pkg.name}`);
if (!/-test\.\d+$/.test(pkg.version))
	problems.push(`version ${pkg.version} is not a -test.N version`);
if (pkg.publishConfig?.tag !== "test")
	problems.push("publishConfig.tag is not 'test'");

const built = path.join(root, "dist/buildInfo.js");
if (existsSync(built)) {
	const m = readFileSync(built, "utf8").match(/RPPG_WEB_BUILD_VERSION = "([^"]+)"/);
	if (m?.[1] !== pkg.version)
		problems.push(`dist says ${m?.[1]}, package.json says ${pkg.version}: rebuild dist`);
}
// Licence: the SDK is Elata's, under MIT, and MIT lets a copy be shared only with its
// copyright and permission notice. npm always packs a top-level LICENSE, so the notice ships
// as long as this file is here, unedited.
const licence = path.join(root, "LICENSE");
if (!existsSync(licence)) {
	problems.push("missing LICENSE: copy the repo root LICENSE (MIT, Copyright (c) 2024 Elata) here");
} else {
	const text = readFileSync(licence, "utf8");
	if (!text.includes("Copyright (c) 2024 Elata") || !text.includes("Permission is hereby granted"))
		problems.push("LICENSE is not Elata's MIT notice");
	const rootLicence = path.join(root, "../../LICENSE");
	if (existsSync(rootLicence) && readFileSync(rootLicence, "utf8") !== text)
		problems.push("LICENSE differs from the repo root LICENSE");
}
if (!pkg.files.includes("LICENSE")) problems.push("package.json files does not list LICENSE");
if (pkg.license !== "MIT") problems.push(`license field is ${pkg.license}, not MIT`);

const glue = path.join(root, "pkg/rppg_wasm.js");
if (existsSync(glue) && !readFileSync(glue, "utf8").includes("set_colour_projection_fix"))
	problems.push("pkg/ WASM has no set_colour_projection_fix: rebuild the WASM from this branch");

// Scrub: nothing that would ship may name a dataset used in testing, a person's own
// readings or captures, or a local path.
const banned = [
	// Dataset names (the upstream API's own MCD_* identifiers are not mentions: no word boundary).
	[/\bMCD\b(?!_)|MCD-rPPG|mcd_rppg/, "dataset name (MCD)"],
	[/UBFC/i, "dataset name (UBFC)"],
	[/\bMPU\b|MPU-rPPG/, "dataset name (MPU)"],
	[/\bOura\b/i, "personal reference (Oura)"],
	[/\b[Oo]wner'?s\b|\bsandbox\b|\bBrave\b/, "personal reference"],
	[/\/home\/|\/tmp\/|\/root\/|\/Users\/|[A-Za-z]:\\{1,2}Users/, "absolute path"],
];
const shipped = [];
const walk = (d) => {
	for (const e of readdirSync(d)) {
		const p = path.join(d, e);
		if (statSync(p).isDirectory()) walk(p);
		else shipped.push(p);
	}
};
for (const f of pkg.files) {
	const p = path.join(root, f);
	if (!existsSync(p)) continue;
	if (statSync(p).isDirectory()) walk(p);
	else shipped.push(p);
}
for (const p of shipped) {
	if (p.endsWith(".wasm")) continue;
	const text = readFileSync(p, "utf8");
	for (const [re, what] of banned) {
		if (re.test(text)) problems.push(`${path.relative(root, p)}: ${what}`);
	}
}

if (process.argv.includes("--publish")) {
	const tag = process.env.npm_config_tag ?? "latest";
	if (tag === "latest")
		problems.push("npm tag is 'latest': publish with --tag test (see PUBLISHING.md)");
}

if (problems.length) {
	console.error(`[rppg-web test release] NOT ready:\n  ${problems.join("\n  ")}`);
	process.exit(1);
}
console.log(`[rppg-web test release] ${pkg.name}@${pkg.version}: ready (${shipped.length} files checked).`);
