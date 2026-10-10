#!/usr/bin/env node
// Runs before `npm pack` / `npm publish` / `npm stage publish` of the starter maker's test build (prepack,
// prepublishOnly). Fails loudly instead of publishing something that cannot work.
//   node scripts/check-test-release.mjs            name, version, licence, templates, version map
//   node scripts/check-test-release.mjs --publish  the same, plus: the npm tag is not 'latest', and every package
//                                                  version a starter installs is on npm (a starter that cannot
//                                                  install is the defect this build exists to fix)
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
const problems = [];

if (pkg.name !== "@amelhede/create-elata-demo") problems.push(`name is ${pkg.name}`);
if (!/-test\.\d+$/.test(pkg.version)) problems.push(`version ${pkg.version} is not a -test.N version`);
if (pkg.publishConfig?.tag !== "test") problems.push("publishConfig.tag is not 'test'");
if (pkg.license !== "MIT") problems.push(`license field is ${pkg.license}, not MIT`);
// The npm page's Repository, Homepage and Issues links: the fork this build comes from, so its bugs
// are not filed on Elata's tracker.
const fork = /github\.com\/AMelhede\/elata-bio-sdk/;
for (const [field, value] of [["repository", pkg.repository?.url], ["homepage", pkg.homepage], ["bugs", typeof pkg.bugs === "string" ? pkg.bugs : pkg.bugs?.url]])
	if (!fork.test(value ?? "")) problems.push(`${field} is ${value}, not the AMelhede/elata-bio-sdk fork`);

// Licence: the starter maker is Elata's, under MIT, which lets a copy be shared only with its copyright and
// permission notice; npm packs a top-level LICENSE whenever the file is there.
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
if (!pkg.files?.includes("LICENSE")) problems.push("package.json files does not list LICENSE");

// Every template the CLI offers is shipped, with the files a starter needs. The list is the CLI's own
// (index.mjs's templates map), so a missing starter folder fails here instead of crashing the CLI.
const templatesDir = path.join(root, "templates");
const offered = [...readFileSync(path.join(root, "index.mjs"), "utf8").matchAll(/\bdir: '([^']+)'/g)].map((m) => m[1]);
const templates = existsSync(templatesDir) ? readdirSync(templatesDir) : [];
if (offered.length === 0) problems.push("no templates found in index.mjs");
for (const t of offered) {
	if (!templates.includes(t)) problems.push(`templates/${t} is missing (the CLI offers it)`);
}
for (const t of templates) {
	for (const f of ["package.json", "index.html", "vite.config.ts", "README.md", "_gitignore"]) {
		if (!existsSync(path.join(templatesDir, t, f))) problems.push(`templates/${t}/${f} is missing`);
	}
}

// The version map a starter's package.json is filled from: every entry set, and a renamed sibling written as an
// npm alias (npm:<name>@<version>) so imports keep the published name.
const versions = pkg.elataSdkVersions ?? {};
for (const key of ["eegWeb", "eegWebBle", "rppgWeb", "ppgWeb", "appMetrics"]) {
	if (!versions[key]) problems.push(`elataSdkVersions.${key} is not set`);
}

if (process.argv.includes("--publish")) {
	const tag = process.env.npm_config_tag ?? "latest";
	if (tag === "latest") problems.push("npm tag is 'latest': publish with --tag test (see PUBLISHING.md)");
	const names = {
		eegWeb: "@elata-biosciences/eeg-web",
		eegWebBle: "@elata-biosciences/eeg-web-ble",
		rppgWeb: "@elata-biosciences/rppg-web",
		ppgWeb: "@elata-biosciences/ppg-web",
		appMetrics: "@elata-biosciences/app-metrics",
	};
	for (const [key, spec] of Object.entries(versions)) {
		const alias = /^npm:(@?[^@]+)@(.+)$/.exec(spec);
		const name = alias ? alias[1] : names[key];
		const version = alias ? alias[2] : spec;
		if (!name) continue;
		const r = spawnSync("npm", ["view", `${name}@${version}`, "version", "--json"], { encoding: "utf8", timeout: 60_000 });
		let found = null;
		try {
			found = JSON.parse(r.stdout || "null");
		} catch {
			found = null;
		}
		if (r.status !== 0 || found == null || (Array.isArray(found) ? !found.includes(version) : found !== version))
			problems.push(`${name}@${version} (elataSdkVersions.${key}) is not on npm: a starter could not install it; publish it first`);
	}
}

if (problems.length) {
	console.error(`[create-elata-demo test release] NOT ready:\n  ${problems.join("\n  ")}`);
	process.exit(1);
}
// stderr, so `npm pack --json` output (prepack runs this) stays parseable.
console.error(`[create-elata-demo test release] ${pkg.name}@${pkg.version}: ready (${templates.length} templates).`);
