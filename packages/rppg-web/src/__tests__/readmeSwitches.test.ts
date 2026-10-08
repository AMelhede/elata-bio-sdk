import { FIX_SWITCH_NAMES } from "../fixSwitches";
import { HEAD_LANDMARKS, PULSE_CHECK_RULE_NAMES, headCentre } from "../pulseCheck";

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
const llms = fs.readFileSync(path.join(__dirname, "..", "..", "llms.txt"), "utf8");
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

	it.each([...PULSE_CHECK_RULE_NAMES])("llms.txt, read by tools and agents, names pulse-check rule %s", (name) => {
		expect(llms).toMatch(new RegExp(`\`${name}\``));
	});

	it("does not count the switches in words a new one would make wrong", () => {
		expect(switches).not.toMatch(/\ball (two|three|four|five|six|seven|eight|nine|ten)\b/);
	});
});

// The movement rule reads the head's bone landmarks by MediaPipe face-mesh index. 0.15.0-test.6's
// README said only that frames need "face landmarks", but a 68-point detector's landmarks give
// headCentre no head (it needs every index up to the highest in HEAD_LANDMARKS), so every window is
// blind and no rate shows. The README names the mesh and the cut-off, and the cut-off is the code's.
describe("README Things to know", () => {
	const things = readme.slice(readme.indexOf("Things to know"), readme.indexOf("## What the original package is"));
	const highest = Math.max(...HEAD_LANDMARKS);
	const mesh = (n: number) => Array.from({ length: n }, () => ({ x: 0.5, y: 0.5 }));

	it("names the face mesh the movement rule needs, and the point count at which there is no head", () => {
		expect(things).toContain("MediaPipe's face mesh (468 points, or 478 with the irises)");
		expect(things).toContain(`${highest} points or fewer`);
		expect(things).toContain("68-point");
		expect(headCentre(mesh(highest), 640, 480)).toBeNull();
		expect(headCentre(mesh(highest + 1), 640, 480)).not.toBeNull();
		expect(headCentre(mesh(468), 640, 480)).not.toBeNull();
	});
});

// npm shows the package.json description beside the name, so it is the first thing a tester reads.
// 0.15.0-test.5's said "five heart-rate fixes and a real-pulse check" while the build had seven
// switches (five fixes, two speed changes) and a check with five rules. Its counts are read from the
// same lists, and the speed changes from the README rows that say "Speed.".
describe("package.json description", () => {
	const pkg = require("../../package.json") as { description: string };
	const words = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
	const speed = FIX_SWITCH_NAMES.filter((name) =>
		new RegExp(`^\\| \`fixes\\.${name}\` \\| Speed\\.`, "m").test(switches),
	).length;

	it("counts the fix switches, the speed changes among them and the check's rules the build has", () => {
		expect(speed).toBeGreaterThan(0);
		expect(pkg.description).toContain(`${words[FIX_SWITCH_NAMES.length]} fix switches`);
		expect(pkg.description).toContain(`${words[speed]} speed changes`);
		expect(pkg.description).toContain(`real-pulse check with ${words[PULSE_CHECK_RULE_NAMES.length]} rules`);
	});

	it("is one sentence", () => {
		expect(pkg.description.trim().split(/[.!?](\s|$)/).filter((s) => s.trim()).length).toBe(1);
	});
});
