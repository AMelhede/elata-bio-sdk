#!/usr/bin/env node

// Publish check, run by verify:publish (so by release-check and by prepack): the CLI must
// scaffold every template from its packed files alone. npm installs this package with no SDK
// package beside it, so every version a template needs has to come from the packaged
// elataSdkVersions. 0.3.1 to 0.12.1 shipped without appMetrics and crashed on start, which a
// files-exist check cannot see.
//
// Usage: node scripts/verify-packed-cli.mjs [package-dir]   (default: this package)

import { spawnSync } from "node:child_process";
import {
	cpSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync,
	statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageDir = path.resolve(
	process.argv[2] ??
		path.join(path.dirname(fileURLToPath(import.meta.url)), ".."),
);
const manifest = JSON.parse(
	readFileSync(path.join(packageDir, "package.json"), "utf8"),
);
const placeholder = /__[A-Z][A-Z0-9_]*__/;

function* filesUnder(dir) {
	for (const entry of readdirSync(dir)) {
		const file = path.join(dir, entry);
		if (statSync(file).isDirectory()) {
			yield* filesUnder(file);
		} else {
			yield file;
		}
	}
}

const work = mkdtempSync(path.join(tmpdir(), "create-elata-demo-verify-"));
const problems = [];
let templates = [];
try {
	// What npm installs: package.json plus the entries in "files", with nothing beside it.
	const packed = path.join(work, "package");
	mkdirSync(packed);
	for (const entry of ["package.json", ...manifest.files]) {
		if (existsSync(path.join(packageDir, entry))) {
			cpSync(path.join(packageDir, entry), path.join(packed, entry), {
				recursive: true,
			});
		}
	}

	const cli = path.join(packed, manifest.bin["create-elata-demo"]);
	templates = readdirSync(path.join(packed, "templates"));
	for (const template of templates) {
		const app = `app-${template}`;
		const run = spawnSync(
			process.execPath,
			[cli, app, "--template", template],
			{ cwd: work, encoding: "utf8", timeout: 60_000 },
		);
		if (run.status !== 0) {
			problems.push(
				`${template}: the CLI exited with ${run.status ?? run.signal}\n${run.stderr}`,
			);
			continue;
		}
		for (const file of filesUnder(path.join(work, app))) {
			const left = readFileSync(file, "utf8").match(placeholder);
			if (left) {
				problems.push(
					`${template}: ${left[0]} left in ${path.relative(path.join(work, app), file)}`,
				);
			}
		}
	}
} finally {
	rmSync(work, { recursive: true, force: true });
}

if (templates.length === 0) {
	problems.push("no templates found in the packed files");
}
if (problems.length > 0) {
	console.error(
		`${manifest.name} cannot scaffold from its packed files:\n${problems.join("\n")}`,
	);
	process.exit(1);
}
console.log(
	`Packed CLI verified: ${templates.length} templates scaffold with no sibling packages`,
);
