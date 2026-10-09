#!/usr/bin/env node
// Runs before `npm pack` / `npm publish` / `npm stage publish` (prepack, prepublishOnly).
// Needs only Node: the built files are committed on this branch, so publishing needs no
// Rust or TypeScript toolchain. Fails loudly instead of publishing something wrong.
//   node scripts/check-test-release.mjs            files, version, licence, switch in the WASM, scrub
//   node scripts/check-test-release.mjs --publish  the same, plus: the npm tag is not 'latest'
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import releaseScrub from "./release-scrub.cjs";
import sourceStamp from "./source-stamp.cjs";

const { scrub, ownFileNames } = releaseScrub;

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
// tsc writes dist but never deletes from it: a module taken out of the source keeps its old build
// in dist, and it would ship. Every built module needs its source file.
const distDir = path.join(root, "dist");
if (existsSync(distDir)) {
	for (const f of readdirSync(distDir)) {
		const m = f.match(/^(.+?)\.(?:js|d\.ts)(?:\.map)?$/);
		if (m && !existsSync(path.join(root, "src", `${m[1]}.ts`)))
			problems.push(`dist/${f} has no source (src/${m[1]}.ts): delete it and rebuild dist`);
	}
}
// And the other way: every source module needs its build. dist/ is gitignored, so a new module's
// built files stay untracked unless force-added, and a fresh clone would ship a dist/index.js that
// imports a file it does not have.
const srcDir = path.join(root, "src");
if (existsSync(srcDir)) {
	for (const f of readdirSync(srcDir)) {
		const m = f.match(/^(.+?)(?<!\.d|\.test)\.ts$/);
		if (!m) continue;
		for (const out of [`${m[1]}.js`, `${m[1]}.d.ts`])
			if (!existsSync(path.join(distDir, out))) problems.push(`src/${f} has no build (dist/${out}): rebuild dist`);
	}
}
// Inside a git checkout, every built file that ships must be committed (git add -f, dist/ is
// gitignored), or the fresh clone PUBLISHING.md publishes from lacks it.
const inGit = spawnSync("git", ["rev-parse", "--is-inside-work-tree"], { cwd: root, encoding: "utf8" });
if (inGit.status === 0 && inGit.stdout.trim() === "true") {
	const tracked = new Set(
		spawnSync("git", ["ls-files", "-z", "--", "dist", "pkg"], { cwd: root, encoding: "utf8" })
			.stdout.split("\0")
			.filter(Boolean),
	);
	const built = [];
	const walkBuilt = (d) => {
		if (!existsSync(d)) return;
		for (const e of readdirSync(d)) {
			const p = path.join(d, e);
			if (statSync(p).isDirectory()) walkBuilt(p);
			else if (e !== ".gitignore") built.push(path.relative(root, p).split(path.sep).join("/"));
		}
	};
	walkBuilt(distDir);
	walkBuilt(path.join(root, "pkg"));
	for (const f of built)
		if (!tracked.has(f)) problems.push(`${f} is not committed: git add -f it (dist/ is gitignored)`);
}
// The version alone cannot tell a dist built from this checkout from one built before its source
// or README moved on (a README describing an option the built code lacked said "ready"), nor a
// dist that changed after the build wrote it.
const stampFile = path.join(root, sourceStamp.STAMP_FILE);
if (!existsSync(stampFile)) {
	problems.push("dist has no record of the source it was built from: rebuild dist (pnpm run build)");
} else {
	const record = JSON.parse(readFileSync(stampFile, "utf8"));
	if (record.sha256 !== sourceStamp.sourceStamp(root))
		problems.push(
			"dist was built from other source or another README than this checkout: rebuild dist (pnpm run build)",
		);
	if (record.dist !== sourceStamp.distStamp(root))
		problems.push(
			"dist changed after it was built (edited by hand, or restored from another build): rebuild dist (pnpm run build)",
		);
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
// readings or captures, a private app or its files and commits, or a local path (the rules,
// and the sentences each was written for, are in release-scrub.cjs and releaseScrub.test.ts).
const ownFiles = ownFileNames(root);
const shipped = [];
const walk = (d) => {
	for (const e of readdirSync(d)) {
		const p = path.join(d, e);
		if (statSync(p).isDirectory()) walk(p);
		else shipped.push(p);
	}
};
// npm always packs package.json, whatever "files" says.
for (const f of [...pkg.files, "package.json"]) {
	const p = path.join(root, f);
	if (!existsSync(p)) continue;
	if (statSync(p).isDirectory()) walk(p);
	else shipped.push(p);
}
for (const p of shipped) {
	if (p.endsWith(".wasm")) continue;
	const text = readFileSync(p, "utf8");
	// The file rule reads code comments only: source maps are generated, and the README rightly
	// names an app's own files.
	const opts = /\.[cm]?[jt]s$/.test(p) ? { code: true, ownFiles } : {};
	for (const what of scrub(text, opts))
		problems.push(`${path.relative(root, p)}: ${what}`);
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
