import { FIX_SWITCH_NAMES } from "../fixSwitches";
import { PULSE_CHECK_RULE_NAMES } from "../pulseCheck";

// Testers log every result against the switches the README lists. In 0.15.0-test.5 the README
// still listed five fix switches ("`fixes: false` turns all five off") while the build had seven
// (analysisWidth and analysisWorker, both on by default), so a tester could not know two of the
// things that changed. Read from the package's own lists, so a new switch cannot be missed again.

// Jest provides require and __dirname; this package's tests carry no Node type declarations.
declare const require: (id: string) => any;
declare const __dirname: string;
const fs = require("fs") as { readFileSync: (p: string, enc: string) => string };
const path = require("path") as { join: (...p: string[]) => string };

const readme = fs.readFileSync(path.join(__dirname, "..", "..", "README.md"), "utf8");
const switches = readme.slice(readme.indexOf("## Switches"), readme.indexOf("## What the original package is"));
const example = switches.slice(switches.indexOf("```ts"), switches.indexOf("```", switches.indexOf("```ts") + 5));

describe("README Switches section", () => {
	it("is where it is expected", () => {
		expect(switches.length).toBeGreaterThan(0);
		expect(example.length).toBeGreaterThan(0);
	});

	it.each([...FIX_SWITCH_NAMES])("has a row for fixes.%s and shows it in the example", (name) => {
		expect(switches).toMatch(new RegExp(`^\\| \`fixes\\.${name}\` \\|`, "m"));
		expect(example).toMatch(new RegExp(`\\b${name}: true,`));
	});

	it.each([...PULSE_CHECK_RULE_NAMES])("names pulse-check rule %s in the table and the example", (name) => {
		expect(switches).toMatch(new RegExp(`^\\| \`pulseCheckRules\` \\|.*\`${name}\``, "m"));
		expect(example).toMatch(new RegExp(`\\b${name}: true,`));
	});

	it("does not count the switches in words a new one would make wrong", () => {
		expect(switches).not.toMatch(/\ball (two|three|four|five|six|seven|eight|nine|ten)\b/);
	});
});
