// The release scrub: what no file that ships in the package may say. Used by
// check-test-release.mjs (before every pack and publish) and by the unit test
// src/__tests__/releaseScrub.test.ts. CommonJS so both can load it.
//
// Nothing that ships may name a dataset used in testing or carry numbers derived from one,
// name a person's own readings or captures, a private app or its files and commits, or a
// local path. Each rule's test is the sentence it was written for (releaseScrub.test.ts).
const fs = require("node:fs");
const path = require("node:path");

const BANNED = [
	// Dataset names (the upstream API's own MCD_* identifiers are not mentions: no word boundary).
	[/\bMCD\b(?!_)|MCD-rPPG|mcd_rppg/, "dataset name (MCD)"],
	[/UBFC/i, "dataset name (UBFC)"],
	[/\bMPU\b|MPU-rPPG/, "dataset name (MPU)"],
	[/\bOura\b/i, "personal reference (Oura)"],
	// "owner", "owners", "owner's" (not "ownership"): 0.15.0-test.5 shipped "owner recordings".
	[/\b[Oo]wner(?:s|'s)?\b|\bsandbox\b|\bBrave\b/, "personal reference"],
	[
		/\/home\/|\/tmp\/|\/root\/|\/Users\/|[A-Za-z]:\\{1,2}Users/,
		"absolute path",
	],
	// The private apps this build is tested in. "Peak times" is upstream's own (a signal peak),
	// the one capitalised "Peak" in the published 0.14.0 that is not the app.
	[
		/\bPeak\b(?! times\b)|peak-app|\bVitality\b|vitality-app/,
		"private app name",
	],
	// Another codebase's history: a 7 to 40 character hex word with a letter and a digit.
	[/\b(?=[0-9a-f]*[a-f])(?=[0-9a-f]*\d)[0-9a-f]{7,40}\b/, "commit hash"],
	[/\bdatasets?\b/i, "dataset mention"],
	// "2,196 real-pulse seconds", "9,087 real seconds", "255 real recordings", "19 people".
	[
		/\b\d[\d,]*\s+(?:(?:real|real-pulse|held-out|recorded)[ -]+)?(?:people|participants|subjects|recordings|captures)\b|\b\d[\d,]*\s+(?:real|real-pulse|held-out)[ -]?(?:pulse\s+)?seconds\b/,
		"measured count (a dataset-derived number)",
	],
	[
		/\bp(?:50|9[059])\b/,
		"percentile of a measured set (a dataset-derived number)",
	],
];

/** Comments in JS or TS source: block and line comments (a "//" inside a string counts too). */
const COMMENT = /\/\*[\s\S]*?\*\/|\/\/[^\n]*/g;
/** A TypeScript file named in prose: `motionVeto.ts`, `buildInfo.test.ts`. */
const TS_FILE = /\b[A-Za-z_][\w.-]*\.tsx?\b/g;

/**
 * What `text` says that may not ship: one label per rule it breaks.
 * `ownFiles` with `code`: the text is source (JS or TS), and a TypeScript file named in its
 * comments must be one of this package's own (ownFileNames). Not for prose such as the README,
 * which rightly names an app's own files (`vite.config.ts`).
 */
function scrub(text, opts = {}) {
	const found = [];
	for (const [re, what] of BANNED) if (re.test(text)) found.push(what);
	if (opts.code && opts.ownFiles) {
		// A file named in a shipped comment must be this package's own: another codebase's file
		// names its structure, and a file that no longer exists sends the reader nowhere.
		const comments = (text.match(COMMENT) ?? []).join("\n");
		const foreign = [...new Set(comments.match(TS_FILE) ?? [])].filter(
			(f) => !opts.ownFiles.has(f),
		);
		if (foreign.length)
			found.push(`file not in this package (${foreign.join(", ")})`);
	}
	return found;
}

/** Base names of every file in the package (its source, tests, scripts and built output), not its dependencies. */
function ownFileNames(packageRoot) {
	const names = new Set();
	const skip = new Set(["node_modules"]);
	const walk = (d) => {
		for (const e of fs.readdirSync(d, { withFileTypes: true })) {
			if (e.isDirectory()) {
				if (!skip.has(e.name)) walk(path.join(d, e.name));
			} else names.add(e.name);
		}
	};
	walk(packageRoot);
	return names;
}

/** The TypeScript sources tsc compiles into dist (src/*.ts, not the tests). */
function shippedSourceFiles(packageRoot) {
	const src = path.join(packageRoot, "src");
	return fs
		.readdirSync(src)
		.filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
		.map((f) => path.join(src, f));
}

module.exports = { BANNED, scrub, ownFileNames, shippedSourceFiles };
