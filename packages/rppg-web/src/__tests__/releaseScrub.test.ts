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
		["a count of people with a word between", "within 3 breaths a minute in 24 of 29 windows on 16 still people", "measured count"],
		["a count of recordings with a word between", "read on 18 locked-away recordings", "measured count"],
		["a percentile of a measured set", "at most 2.6 dB (p99 2.2)", "percentile"],
	])("catches %s", (_what, text, label) => {
		expect(scrub(text).join(" | ")).toContain(label);
	});

	// 0.15.0-test.6's dist carried measurements of recorded people in the head rule's comments
	// (pulseCheck.js and pulseCheck.d.ts: HEAD_MIN_SNR_DB, HEAD_MIN_SIZE, HEAD_MAX_GAP_MS) and the
	// scrub said "ready": no rule knew a "real-pulse window", or a real pulse said to stand at some
	// dB or per cent. Each of the first four is a sentence as it shipped, line wraps included; the
	// fifth is the same measurement as pulseCheckHead.test.ts words it ("a real head"); the last
	// puts the number first.
	it.each([
		[
			"a real-pulse window's dominance (HEAD_MIN_SNR_DB)",
			"every\n * real-pulse window whose movement at the rate was 0.3% of the face's width or more stood at most\n * 2.4 dB above the rest (fidgeting), and the weakest nod 5.4 dB (8.5 dB with a sway).",
		],
		[
			"a real-pulse window's size (HEAD_MIN_SIZE)",
			"rhythm, but it is tiny: every real-pulse window whose movement at the rate dominated (2.5 dB and\n * up) moved at most 0.13% of the face's width; the nods moved 0.69% and more.",
		],
		[
			"what the bars did to real-pulse windows (HEAD_MIN_SIZE)",
			"At both bars no real-pulse window was carried and every nod window was.",
		],
		[
			"real-pulse windows with gaps (HEAD_MAX_GAP_MS)",
			"Measured on nod and real-pulse\n * windows with rows cut out: with a 1 s gap the statistic still finds 99.7% of nod windows (2 s:\n * 92.4%, 3 s: 78.9%), and no real-pulse window was carried with gaps up to 3 s.",
		],
		[
			"a real head at some dB and per cent, with no 'real-pulse window' in it",
			"// - a real head that moved 0.3% or more at the rate was at most 2.4 dB dominant (fidgeting); the\n//   nods stood 5.4 dB and more above the rest, 8.5 dB with a sway.",
		],
		["a real pulse at some dB, the number first", "the bar is 2.4 dB, which every real pulse stayed under."],
	])("catches a measurement of recorded people: %s", (_what, text) => {
		expect(scrub(text).join(" | ")).toContain("measurement of recorded people");
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
		// The check's own name, a claim with no number, and a number only in the next sentence.
		" * Real-pulse check (`createRppgSession({ pulseCheck })`, ON by default in this test build;",
		"line dips. Its cost on real pulses was measured on recorded captures against a reference\n\t\t// pulse before it was added. A light 25 dB above its noise is withheld.",
		"with seven fix switches (five heart-rate fixes and two speed changes) and a real-pulse check with six rules",
		"a pulse at 70 under a nod at 90 still shows 70",
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
