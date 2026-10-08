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
	for (const d of ["scripts", "dist", "pkg"]) fs.mkdirSync(path.join(root, d), { recursive: true });
	for (const f of ["check-test-release.mjs", "release-scrub.cjs"])
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
	for (const f of ["index.js", "index.d.ts", "fixSwitches.js", "pulseCheck.js"])
		fs.writeFileSync(path.join(root, "dist", f), "export {};\n");
	fs.writeFileSync(path.join(root, "dist", "buildInfo.js"), `export const RPPG_WEB_BUILD_VERSION = "${VERSION}";\n`);
	fs.writeFileSync(path.join(root, "pkg", "rppg_wasm.js"), "export function set_colour_projection_fix() {}\n");
	fs.writeFileSync(path.join(root, "pkg", "rppg_wasm_bg.wasm"), "\0asm");
	return { root, top };
}

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
