// check-test-release.mjs runs before every pack and publish of this test build. Its scrub rules are
// pinned in releaseScrub.test.ts, but nothing proved the script applies them: with its scrub loop
// deleted, every test stayed green and the script said "ready". Here the script itself, copied
// unchanged, runs as a child process on a throwaway package that has every file it requires, once
// clean and then with one sentence in dist that may not ship.

// A module, so its declarations below do not meet another test file's in the global scope.
export {};

// Jest provides require and __dirname; this package's tests carry no Node type declarations.
declare const require: (id: string) => any;
declare const __dirname: string;
declare const process: { execPath: string };

const fs = require("fs") as {
	mkdtempSync: (prefix: string) => string;
	mkdirSync: (p: string, o?: { recursive: boolean }) => void;
	copyFileSync: (a: string, b: string) => void;
	writeFileSync: (p: string, data: string) => void;
	appendFileSync: (p: string, data: string) => void;
	rmSync: (p: string, o: { recursive: boolean; force: boolean }) => void;
};
const path = require("path") as { join: (...p: string[]) => string };
const os = require("os") as { tmpdir: () => string };
const { spawnSync } = require("child_process") as {
	spawnSync: (cmd: string, args: string[], o: { cwd: string; encoding: string }) => { status: number | null; stdout: string; stderr: string };
};

const pkgRoot = path.join(__dirname, "..", "..");
const VERSION = "0.0.0-test.1";

/** A package laid out as this one is (packages/<name> under a repo root holding LICENSE), with the real scripts. */
function throwawayPackage(): { root: string; top: string } {
	const top = fs.mkdtempSync(path.join(os.tmpdir(), "rppg-web-check-"));
	const root = path.join(top, "packages", "rppg-web");
	for (const d of ["scripts", "dist", "pkg", "src/__tests__"]) fs.mkdirSync(path.join(root, d), { recursive: true });
	for (const f of ["check-test-release.mjs", "release-scrub.cjs", "source-stamp.cjs", "stamp-source.mjs"])
		fs.copyFileSync(path.join(pkgRoot, "scripts", f), path.join(root, "scripts", f));
	fs.copyFileSync(path.join(pkgRoot, "LICENSE"), path.join(root, "LICENSE"));
	fs.copyFileSync(path.join(pkgRoot, "LICENSE"), path.join(top, "LICENSE"));
	fs.writeFileSync(
		path.join(root, "package.json"),
		JSON.stringify({
			name: "@amelhede/rppg-web",
			version: VERSION,
			license: "MIT",
			type: "module",
			files: ["dist", "pkg", "README.md", "LICENSE"],
			publishConfig: { tag: "test" },
		}),
	);
	fs.writeFileSync(path.join(root, "README.md"), "# A test build\n");
	for (const f of ["index", "fixSwitches", "pulseCheck"]) {
		fs.writeFileSync(path.join(root, "dist", `${f}.js`), "export {};\n");
		fs.writeFileSync(path.join(root, "dist", `${f}.d.ts`), "export {};\n");
	}
	fs.writeFileSync(path.join(root, "dist", "buildInfo.js"), `export const RPPG_WEB_BUILD_VERSION = "${VERSION}";\n`);
	fs.writeFileSync(path.join(root, "dist", "buildInfo.d.ts"), "export declare const RPPG_WEB_BUILD_VERSION: string;\n");
	fs.writeFileSync(path.join(root, "pkg", "rppg_wasm.js"), "export function set_colour_projection_fix() {}\n");
	fs.writeFileSync(path.join(root, "pkg", "rppg_wasm_bg.wasm"), "\0asm");
	fs.writeFileSync(path.join(root, "src", "index.ts"), "export const a = 1;\n");
	for (const f of ["buildInfo", "fixSwitches", "pulseCheck"]) fs.writeFileSync(path.join(root, "src", `${f}.ts`), "export {};\n");
	fs.writeFileSync(path.join(root, "src", "__tests__", "a.test.ts"), "test.todo('a');\n");
	stamp(root);
	return { root, top };
}

/** What the build does last: record which source and README dist was built from. */
const stamp = (root: string) =>
	spawnSync(process.execPath, [path.join(root, "scripts", "stamp-source.mjs")], { cwd: root, encoding: "utf8" });

const check = (root: string) =>
	spawnSync(process.execPath, [path.join(root, "scripts", "check-test-release.mjs")], { cwd: root, encoding: "utf8" });

describe("check-test-release.mjs applies the release scrub to what ships", () => {
	let made: { root: string; top: string } | null = null;
	afterEach(() => {
		if (made) fs.rmSync(made.top, { recursive: true, force: true });
		made = null;
	});

	it("says ready for a package with nothing in it that may not ship", () => {
		made = throwawayPackage();
		const r = check(made.root);
		expect(r.stderr).toBe("");
		expect(r.stdout).toContain(`@amelhede/rppg-web@${VERSION}: ready`);
		expect(r.status).toBe(0);
	});

	it("refuses one banned sentence in dist, naming the file and the rule", () => {
		made = throwawayPackage();
		fs.appendFileSync(path.join(made.root, "dist", "pulseCheck.js"), "// Set on the owner's recordings.\n");
		const r = check(made.root);
		expect(r.status).toBe(1);
		expect(r.stderr).toContain("NOT ready");
		expect(r.stderr).toContain("dist/pulseCheck.js: personal reference");
	});

	it("refuses a file from another codebase named in a shipped comment", () => {
		made = throwawayPackage();
		fs.appendFileSync(path.join(made.root, "dist", "index.js"), "// see otherApp.ts\n");
		const r = check(made.root);
		expect(r.status).toBe(1);
		expect(r.stderr).toContain("dist/index.js: file not in this package (otherApp.ts)");
	});

	// 0.15.0-test.6 shipped this sentence in dist/pulseCheck.d.ts and the script said "ready".
	it("refuses a measurement of recorded people in a shipped type declaration", () => {
		made = throwawayPackage();
		fs.appendFileSync(
			path.join(made.root, "dist", "index.d.ts"),
			"/**\n * At both bars no real-pulse window was carried and every nod window was.\n */\nexport {};\n",
		);
		const r = check(made.root);
		expect(r.status).toBe(1);
		expect(r.stderr).toContain("dist/index.d.ts: measurement of recorded people");
	});
});

// The check compared version strings only, so a checkout whose source or README had moved on
// since dist was built (the README describing an option the built code lacks) said "ready".
describe("check-test-release.mjs refuses a dist built from other source", () => {
	let made: { root: string; top: string } | null = null;
	afterEach(() => {
		if (made) fs.rmSync(made.top, { recursive: true, force: true });
		made = null;
	});

	it("refuses when a source file changed after dist was built", () => {
		made = throwawayPackage();
		fs.appendFileSync(path.join(made.root, "src", "index.ts"), "export const b = 2;\n");
		const r = check(made.root);
		expect(r.status).toBe(1);
		expect(r.stderr).toContain("dist was built from other source");
	});

	it("refuses when the README changed after dist was built", () => {
		made = throwawayPackage();
		fs.appendFileSync(path.join(made.root, "README.md"), "A new option.\n");
		expect(check(made.root).stderr).toContain("dist was built from other source");
	});

	it("refuses a dist with no record of its source", () => {
		made = throwawayPackage();
		fs.rmSync(path.join(made.root, "dist", "source-stamp.json"), { recursive: true, force: true });
		const r = check(made.root);
		expect(r.status).toBe(1);
		expect(r.stderr).toContain("dist has no record of the source it was built from");
	});

	it("ignores test files, and Windows line endings (a checkout there has them)", () => {
		made = throwawayPackage();
		fs.appendFileSync(path.join(made.root, "src", "__tests__", "a.test.ts"), "test.todo('b');\n");
		fs.writeFileSync(path.join(made.root, "src", "index.ts"), "export const a = 1;\r\n");
		const r = check(made.root);
		expect(r.stderr).toBe("");
		expect(r.status).toBe(0);
	});
});

// tsc writes dist but never deletes from it, so a module removed from the source (four reverted
// speed-ups took landmarkStats.ts out) left its old build in dist, where it would ship.
describe("check-test-release.mjs refuses a built module with no source", () => {
	let made: { root: string; top: string } | null = null;
	afterEach(() => {
		if (made) fs.rmSync(made.top, { recursive: true, force: true });
		made = null;
	});

	it("refuses a dist module whose source file is gone, naming it", () => {
		made = throwawayPackage();
		fs.writeFileSync(path.join(made.root, "dist", "gone.js"), "export {};\n");
		const r = check(made.root);
		expect(r.status).toBe(1);
		expect(r.stderr).toContain("dist/gone.js has no source");
	});
});

// The orphan check went one way only. A new module whose build was never committed (dist/ is
// gitignored, so a new built file stays untracked unless force-added) is absent from a fresh clone,
// while the committed dist/index.js imports it: the check said "ready" and every consumer would
// have failed to import the package.
describe("check-test-release.mjs refuses a source module with no build", () => {
	let made: { root: string; top: string } | null = null;
	afterEach(() => {
		if (made) fs.rmSync(made.top, { recursive: true, force: true });
		made = null;
	});

	it("refuses a source module with no built file in dist, naming it", () => {
		made = throwawayPackage();
		fs.writeFileSync(path.join(made.root, "src", "newThing.ts"), "export const n = 1;\n");
		stamp(made.root);
		const r = check(made.root);
		expect(r.status).toBe(1);
		expect(r.stderr).toContain("src/newThing.ts has no build (dist/newThing.js)");
		expect(r.stderr).toContain("src/newThing.ts has no build (dist/newThing.d.ts)");
	});

	it("refuses a built file that git does not track, inside a git checkout", () => {
		made = throwawayPackage();
		const git = (...args: string[]) => spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd: made!.top, encoding: "utf8" });
		git("init", "-q");
		fs.writeFileSync(path.join(made.top, ".gitignore"), "dist/\n");
		git("add", "-A");
		git("add", "-f", "packages/rppg-web/dist");
		git("commit", "-q", "-m", "a");
		expect(check(made.root).status).toBe(0);
		fs.writeFileSync(path.join(made.root, "src", "newThing.ts"), "export const n = 1;\n");
		fs.writeFileSync(path.join(made.root, "dist", "newThing.js"), "export const n = 1;\n");
		fs.writeFileSync(path.join(made.root, "dist", "newThing.d.ts"), "export declare const n: number;\n");
		stamp(made.root);
		git("add", "-A");
		git("commit", "-q", "-m", "b");
		const r = check(made.root);
		expect(r.status).toBe(1);
		expect(r.stderr).toContain("dist/newThing.js is not committed");
	});
});

// The stamp hashed the source only, and tsc builds incrementally from a record kept outside dist:
// after dist was restored to an older build, a rebuild emitted nothing, the stamp was rewritten
// from the new source, and the old code would have shipped as "ready". Hand edits to dist passed too.
describe("check-test-release.mjs refuses a dist that is not what the build wrote", () => {
	let made: { root: string; top: string } | null = null;
	afterEach(() => {
		if (made) fs.rmSync(made.top, { recursive: true, force: true });
		made = null;
	});

	it("refuses a built file changed after the build", () => {
		made = throwawayPackage();
		fs.writeFileSync(path.join(made.root, "dist", "index.js"), "export const old = 1;\n");
		const r = check(made.root);
		expect(r.status).toBe(1);
		expect(r.stderr).toContain("dist changed after it was built");
	});

	it("the build always re-emits every file (no incremental skip)", () => {
		const pkg = JSON.parse(require("fs").readFileSync(path.join(pkgRoot, "package.json"), "utf8"));
		expect(pkg.scripts.build).toMatch(/^node \.\/scripts\/clean-build-record\.mjs && tsc -p \. /);
	});
});

// npm always packs package.json, whose description is rewritten by hand for every build, and the
// scrub walked only the files listed in "files".
describe("check-test-release.mjs scrubs package.json", () => {
	let made: { root: string; top: string } | null = null;
	afterEach(() => {
		if (made) fs.rmSync(made.top, { recursive: true, force: true });
		made = null;
	});

	it("refuses a banned sentence in the package description", () => {
		made = throwawayPackage();
		const p = path.join(made.root, "package.json");
		const pkg = JSON.parse(require("fs").readFileSync(p, "utf8"));
		pkg.description = "Set on the owner's recordings.";
		fs.writeFileSync(p, JSON.stringify(pkg));
		const r = check(made.root);
		expect(r.status).toBe(1);
		expect(r.stderr).toContain("package.json: personal reference");
	});
});
