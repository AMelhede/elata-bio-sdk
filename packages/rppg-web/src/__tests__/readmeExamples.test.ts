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
	const blocks = text.match(/```[a-z]*\n[\s\S]*?```/g) ?? [];
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
