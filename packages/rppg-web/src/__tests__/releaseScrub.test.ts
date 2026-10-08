// The release scrub (scripts/release-scrub.cjs), run by check-test-release.mjs before every pack
// and publish of this test build. Comments are copied unchanged from src into dist, and dist
// ships, so nothing in them may name a person's own captures, a private app or its files and
// commits, or numbers derived from a dataset used in testing.
//
// 0.15.0-test.5's dist carried three such comments (pulseCheck.js) and the scrub said "ready":
// it matched "owner's" and "owners" but not "owner", and had no rule for an app name, a file
// from another codebase, a commit hash or a measured count. Each case below is one of those
// sentences, so each rule is pinned by the text it once missed.

// Jest provides require and __dirname; this package's tests carry no Node type declarations.
declare const require: (id: string) => any;
declare const __dirname: string;

const { scrub, ownFileNames, shippedSourceFiles } = require("../../scripts/release-scrub.cjs") as {
	scrub: (text: string, opts?: { code?: boolean; ownFiles?: ReadonlySet<string> }) => string[];
	ownFileNames: (packageRoot: string) => Set<string>;
	shippedSourceFiles: (packageRoot: string) => string[];
};
const path = require("path") as { join: (...p: string[]) => string; relative: (a: string, b: string) => string };
const fs = require("fs") as { readFileSync: (p: string, enc: string) => string };

const root = path.join(__dirname, "..", "..");
const own = ownFileNames(root);

describe("release scrub", () => {
	it.each([
		["the owner's own captures", "(owner recordings plus a public dataset, within 5 bpm of truth)", "personal reference"],
		["a private app by name", "MediaPipe face mesh indices; the same set Peak records", "private app"],
		["a private app's commit", "line dips. Peak 570365a; measured there", "commit hash"],
		["a dataset", "owner recordings plus a public dataset", "dataset"],
		["a count of measured seconds", "Set in Peak on 2,196 real-pulse seconds", "measured count"],
		["a count of measured seconds, short form", "measured there to cost 8 of 9,087 real seconds and 0 readings", "measured count"],
		["a percentile of a measured set", "at most 2.6 dB (p99 2.2)", "percentile"],
	])("catches %s", (_what, text, label) => {
		expect(scrub(text).join(" | ")).toContain(label);
	});

	it("catches a file from another codebase named in a comment, not this package's own files", () => {
		const said = (text: string) => scrub(text, { code: true, ownFiles: own });
		expect(said("/** Set in Peak (motionVeto.ts, 2026-10-08) */").join(" | ")).toContain("file not in this package");
		expect(said("/** see pulseCheckCore.ts */")).toEqual([]);
		// Code, not a comment: a property named `ts`.
		expect(said("points.filter((point) => point.ts >= event.ts)")).toEqual([]);
	});

	it("reads line comments for file names as well as block comments", () => {
		const said = (text: string) => scrub(text, { code: true, ownFiles: own });
		expect(said("const keep = 22; // see otherApp.ts").join(" | ")).toContain("file not in this package (otherApp.ts)");
		expect(said("const keep = 22; // see pulseCheckCore.ts")).toEqual([]);
	});

	it.each([
		"SDNN and mean NN. Peak times are already sub-sample refined by",
		"level API when you want full lifecycle ownership.",
		"export type PulsePeak = { t: number };",
		"export const MCD_PROXY_INPUT_V1_PROFILE = fractionalProfile(",
		'ctx.strokeStyle = "rgba(34,197,94,0.9)";',
		"(27 of 41 seconds on real wall footage, demo settings)",
		"breathing read 14 to 21 in 42 of 42 seconds",
		"a light folded to 180 a minute, 25 dB above its noise",
	])("leaves the package's own words alone: %s", (text) => {
		expect(scrub(text, { code: true, ownFiles: own })).toEqual([]);
	});

	it("passes every source file that ships (its comments reach dist unchanged)", () => {
		const found = shippedSourceFiles(root).flatMap((file) =>
			scrub(fs.readFileSync(file, "utf8"), { code: true, ownFiles: own }).map(
				(what) => `${path.relative(root, file)}: ${what}`,
			),
		);
		expect(found).toEqual([]);
	});
});
