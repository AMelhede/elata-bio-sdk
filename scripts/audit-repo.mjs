#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const repoRoot = process.cwd();
const errors = [];

function readText(relPath) {
	return fs.readFileSync(path.join(repoRoot, relPath), "utf8");
}

function exists(relPath) {
	return fs.existsSync(path.join(repoRoot, relPath));
}

function readWorkspacePatterns() {
	if (!exists("pnpm-workspace.yaml")) return [];
	return readText("pnpm-workspace.yaml")
		.split(/\r?\n/)
		.map((line) => line.match(/^\s*-\s*"([^"]+)"\s*$/)?.[1] ?? null)
		.filter((value) => typeof value === "string");
}

function matchesWorkspacePattern(relDir, pattern) {
	const relParts = relDir.split("/").filter(Boolean);
	const patternParts = pattern.split("/").filter(Boolean);
	if (relParts.length !== patternParts.length) return false;
	for (let i = 0; i < patternParts.length; i += 1) {
		if (patternParts[i] === "*") continue;
		if (patternParts[i] !== relParts[i]) return false;
	}
	return true;
}

function isWorkspaceDir(relDir, workspacePatterns) {
	return workspacePatterns.some((pattern) =>
		matchesWorkspacePattern(relDir, pattern),
	);
}

function isAllowedStandaloneLockfile(relPath, workspacePatterns) {
	const relDir = path.posix.dirname(relPath);
	if (relDir === "." || relDir === "") return false;
	if (!exists(path.posix.join(relDir, "package.json"))) return false;
	return !isWorkspaceDir(relDir, workspacePatterns);
}

function walk(dirRel, visit) {
	const dirAbs = path.join(repoRoot, dirRel);
	if (!fs.existsSync(dirAbs)) {
		return;
	}

	for (const entry of fs.readdirSync(dirAbs, { withFileTypes: true })) {
		if (
			entry.name === ".git" ||
			entry.name === "node_modules" ||
			entry.name === "target" ||
			entry.name === "dist"
		) {
			continue;
		}

		const relPath = path.join(dirRel, entry.name);
		if (entry.isDirectory()) {
			walk(relPath, visit);
		} else {
			visit(relPath.replaceAll("\\", "/"));
		}
	}
}

function assert(condition, message) {
	if (!condition) {
		errors.push(message);
	}
}

const rootPackage = JSON.parse(readText("package.json"));
const workspacePatterns = readWorkspacePatterns();
assert(
	typeof rootPackage.packageManager === "string" &&
		rootPackage.packageManager.startsWith("pnpm@"),
	"package.json must declare pnpm in packageManager",
);
assert(
	exists("pnpm-workspace.yaml"),
	"pnpm-workspace.yaml must exist at the repo root",
);
assert(exists("pnpm-lock.yaml"), "pnpm-lock.yaml must exist at the repo root");
assert(
	exists("rust-toolchain.toml"),
	"rust-toolchain.toml must exist at the repo root",
);
const disallowedLockfiles = [];
walk(".", (relPath) => {
	if (relPath === "pnpm-lock.yaml") {
		return;
	}
	if (
		relPath.endsWith("package-lock.json") ||
		relPath.endsWith("pnpm-lock.yaml")
	) {
		if (isAllowedStandaloneLockfile(relPath, workspacePatterns)) {
			return;
		}
		disallowedLockfiles.push(relPath);
	}
});
assert(
	disallowedLockfiles.length === 0,
	`remove non-root lockfiles: ${disallowedLockfiles.join(", ")}`,
);

const eegWebSrc = path.join(repoRoot, "packages/eeg-web/src");
if (fs.existsSync(eegWebSrc)) {
	const generatedSourceArtifacts = fs
		.readdirSync(eegWebSrc)
		.filter(
			(name) =>
				name.endsWith(".js") ||
				name.endsWith(".d.ts") ||
				name.endsWith(".d.ts.map"),
		)
		.map((name) => `packages/eeg-web/src/${name}`);
	assert(
		generatedSourceArtifacts.length === 0,
		`remove generated artifacts from packages/eeg-web/src: ${generatedSourceArtifacts.join(", ")}`,
	);
}

const cargoTomls = ["Cargo.toml"];
walk("crates", (relPath) => {
	if (relPath.endsWith("/Cargo.toml")) {
		cargoTomls.push(relPath);
	}
});

for (const cargoToml of cargoTomls) {
	const manifest = readText(cargoToml);
	assert(
		/^\s*rust-version\s*=\s*"[^"]+"/m.test(manifest),
		`${cargoToml} must declare rust-version`,
	);
}

const rootCargo = readText("Cargo.toml");
const workspaceMembersMatch = rootCargo.match(
	/members\s*=\s*\[(?<body>[\s\S]*?)\]/m,
);
const workspaceMembers = new Set(
	[...(workspaceMembersMatch?.groups?.body.matchAll(/"([^"]+)"/g) ?? [])].map(
		(match) => match[1],
	),
);

const crateDirs = fs
	.readdirSync(path.join(repoRoot, "crates"), { withFileTypes: true })
	.filter(
		(entry) =>
			entry.isDirectory() &&
			fs.existsSync(path.join(repoRoot, "crates", entry.name, "Cargo.toml")),
	)
	.map((entry) => `crates/${entry.name}`);

for (const crateDir of crateDirs) {
	assert(
		workspaceMembers.has(crateDir),
		`${crateDir} must be listed in workspace members`,
	);
}

for (const member of workspaceMembers) {
	if (member.startsWith("crates/")) {
		assert(
			exists(path.join(member, "Cargo.toml")),
			`workspace member ${member} is missing Cargo.toml`,
		);
	}
}

const workspacePackagesDir = path.join(repoRoot, "packages");
const workspacePackages = new Map();

if (fs.existsSync(workspacePackagesDir)) {
	for (const entry of fs.readdirSync(workspacePackagesDir, { withFileTypes: true })) {
		if (!entry.isDirectory()) continue;
		const packageJsonRel = path.posix.join("packages", entry.name, "package.json");
		if (!exists(packageJsonRel)) continue;
		const manifest = JSON.parse(readText(packageJsonRel));
		if (typeof manifest.name === "string" && manifest.name.length > 0) {
			workspacePackages.set(manifest.name, {
				manifest,
				relPath: packageJsonRel,
			});
		}
	}
}

// Whether a caret range takes a version, as npm's semver does for x.y.z versions: ^1.2.3 takes
// >=1.2.3 <2.0.0, ^0.2.3 takes >=0.2.3 <0.3.0, ^0.0.3 takes 0.0.3 only. Null for any other range.
function caretTakes(range, version) {
	const r = /^\^(\d+)\.(\d+)\.(\d+)$/.exec(range);
	const v = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
	if (!r || !v) return null;
	const [r0, r1, r2] = r.slice(1).map(Number);
	const [v0, v1, v2] = v.slice(1).map(Number);
	const atLeast = v0 !== r0 ? v0 > r0 : v1 !== r1 ? v1 > r1 : v2 >= r2;
	if (!atLeast) return false;
	if (r0 > 0) return v0 === r0;
	if (r1 > 0) return v0 === 0 && v1 === r1;
	return v0 === 0 && v1 === 0 && v2 === r2;
}

for (const { manifest, relPath } of workspacePackages.values()) {
	const peerDependencies = manifest.peerDependencies ?? {};
	const devDependencies = manifest.devDependencies ?? {};

	// A workspace package named as a peer must be installable at its current version: npm refuses a
	// peer outside its range (ERESOLVE), and pnpm warns, or fails when it has to install the peer
	// itself. A semver release moves these ranges (sync_workspace_peer_ranges in scripts/run-lib.sh);
	// this catches any version or range changed another way.
	for (const [depName, range] of Object.entries(peerDependencies)) {
		const sibling = workspacePackages.get(depName);
		if (!sibling) continue;
		const takes = caretTakes(range, sibling.manifest.version);
		assert(
			/^\^\d+\.\d+\.\d+$/.test(range),
			`${relPath} names workspace peer '${depName}' with '${range}'; use a caret range (^x.y.z) the audit can check`,
		);
		assert(
			/^\d+\.\d+\.\d+$/.test(sibling.manifest.version),
			`${relPath} names workspace peer '${depName}', whose version ${sibling.manifest.version} is not x.y.z (a prerelease?); the audit cannot check it`,
		);
		assert(
			takes !== false,
			`${relPath} names workspace peer '${depName}' ${range}, which does not take its current version ${sibling.manifest.version}`,
		);
	}

	for (const depName of Object.keys(peerDependencies)) {
		if (!workspacePackages.has(depName)) continue;
		const devSpecifier = devDependencies[depName];
		assert(
			typeof devSpecifier === "string" && devSpecifier.startsWith("workspace:"),
			`${relPath} lists workspace peer '${depName}' but is missing a matching devDependency with a workspace: specifier`,
		);
	}
}

if (errors.length > 0) {
	console.error("Repository audit failed:");
	for (const error of errors) {
		console.error(`- ${error}`);
	}
	process.exit(1);
}

console.log("Repository audit passed.");
