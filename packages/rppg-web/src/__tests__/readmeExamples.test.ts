// Developers copy the first example they see. The quick start, the diagnostics example, both managed
// examples and the app-adapter examples in the README and the browser guide all set
// `faceMesh: "off"`, while the pulse check is on by default and needs face regions to check. Copied
// as written, each one runs, finds no face to check and never shows a heart rate, with no error. An
// example that turns the face finder off must also turn the pulse check off, or it cannot work.

// Jest provides require and __dirname; this package's tests carry no Node type declarations. The
// export makes this file a module, so these declarations stay its own when ts-jest checks several
// test files in one program.
export {};
declare const require: (id: string) => any;
declare const __dirname: string;
const fs = require("fs") as { readFileSync: (p: string, enc: string) => string };
const path = require("path") as { join: (...p: string[]) => string };

const docs: Array<[string, string]> = [
	["README.md", path.join(__dirname, "..", "..", "README.md")],
	["docs/guides/using-rppg-in-a-browser-app.md", path.join(__dirname, "..", "..", "..", "..", "docs", "guides", "using-rppg-in-a-browser-app.md")],
];

/** Each fenced code block that builds a session, as its text. */
function sessionExamples(text: string): string[] {
	const blocks = text.match(/```[a-z]*\r?\n[\s\S]*?```/g) ?? [];
	return blocks.filter((b) => /create(Managed)?RppgSession\(/.test(b));
}

describe.each(docs)("%s examples", (_name, file) => {
	const examples = sessionExamples(fs.readFileSync(file, "utf8"));

	it("has session examples to check", () => {
		expect(examples.length).toBeGreaterThan(0);
	});

	it("never turns the face finder off while the pulse check is on", () => {
		const dead = examples.filter((b) => /faceMesh:\s*"off"/.test(b) && !/pulseCheck:\s*false/.test(b));
		expect(dead).toEqual([]);
	});
});

// The quick start is the one example written as a whole program (it opens the camera itself), so a
// new developer pastes it as is. `npm create vite@latest -- --template vanilla-ts` (create-vite
// 9.2.1, Vite 8, TypeScript 6) builds with `tsc && vite build` and turns on noUnusedLocals and
// noUnusedParameters. The quick start kept `const interval` only for a commented-out cleanup, so
// pasted into that app, `npm run build` stopped at TS6133 before Vite ran, on test.18 and on the
// published 0.14.0 alike (fresh-app check, 2026-10-11). Imports are left unresolved here on purpose:
// only the unused-code checks are asked for, and they need no types from the package.
const ts = require("typescript") as typeof import("typescript");

/** The fenced TypeScript blocks that open the camera themselves. */
function wholePrograms(text: string): string[] {
	return [...text.matchAll(/```(?:ts|typescript)\r?\n([\s\S]*?)```/g)]
		.map((m) => m[1])
		.filter((b) => /getUserMedia\(/.test(b));
}

/** TS6133 and its kin, under the unused-code flags of Vite's TypeScript starter. */
function unusedCodeErrors(source: string): string[] {
	const options = {
		noUnusedLocals: true,
		noUnusedParameters: true,
		strict: true,
		noEmit: true,
		target: ts.ScriptTarget.ES2022,
		module: ts.ModuleKind.ESNext,
		moduleResolution: ts.ModuleResolutionKind.Bundler,
		lib: ["lib.es2022.d.ts", "lib.dom.d.ts"],
		types: [],
	};
	const name = "/quick-start.ts";
	const host = ts.createCompilerHost(options);
	const readSource = host.getSourceFile.bind(host);
	const exists = host.fileExists.bind(host);
	host.getSourceFile = (file, lang, ...rest) =>
		file === name ? ts.createSourceFile(file, source, lang) : readSource(file, lang, ...rest);
	host.fileExists = (file) => file === name || exists(file);
	const program = ts.createProgram([name], options, host);
	const unused = new Set([6133, 6138, 6192, 6196, 6198, 6199, 6205]);
	return ts
		.getPreEmitDiagnostics(program, program.getSourceFile(name))
		.filter((d) => unused.has(d.code))
		.map((d) => `TS${d.code}: ${ts.flattenDiagnosticMessageText(d.messageText, " ")}`);
}

describe("README whole-program examples", () => {
	const programs = wholePrograms(fs.readFileSync(docs[0][1], "utf8"));

	it("has the quick start to check", () => {
		expect(programs.length).toBeGreaterThan(0);
	});

	// Git for Windows checks text files out with CRLF line ends by default (core.autocrlf), and this repo
	// has no .gitattributes to stop it. On such a checkout a fence read as "```ts\n" matched nothing, so
	// "has session examples to check" and "has the quick start to check" failed and the examples went
	// unchecked (test.19 audit, a CRLF clone of release/test-1).
	it("finds the same examples when the files have Windows line ends", () => {
		for (const [, file] of docs) {
			const text = fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");
			const crlf = text.replace(/\n/g, "\r\n");
			expect(sessionExamples(crlf).length).toBe(sessionExamples(text).length);
			expect(wholePrograms(crlf).length).toBe(wholePrograms(text).length);
		}
	});

	it("the checker catches a variable kept only for commented-out code", () => {
		expect(unusedCodeErrors("const kept = 1;\n// console.log(kept);\nexport {};\n")).toEqual([
			"TS6133: 'kept' is declared but its value is never read.",
		]);
	});

	it.each(programs.map((p, i) => [i, p]))("example %i builds under Vite's unused-code checks", (_i, program) => {
		expect(unusedCodeErrors(program as string)).toEqual([]);
	});
});
