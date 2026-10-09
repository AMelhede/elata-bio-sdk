// Which source a build of dist came from: a hash over every shipped TypeScript source file (tests
// left out) and the README, which ships beside dist and describes it. The build writes it to
// dist/source-stamp.json (stamp-source.mjs); check-test-release.mjs recomputes it from the checkout
// and refuses a dist built from other source. Line endings are normalised, so a Windows checkout
// (git turns LF into CRLF there) gives the same hash. CommonJS, Node only: publishing needs no
// toolchain.
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const STAMP_FILE = "dist/source-stamp.json";

function sourceFiles(root) {
	const out = [];
	const walk = (dir) => {
		for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
			const p = path.join(dir, e.name);
			if (e.isDirectory()) {
				if (e.name !== "__tests__") walk(p);
			} else if (/\.ts$/.test(e.name) && !/\.test\.ts$/.test(e.name)) {
				out.push(p);
			}
		}
	};
	walk(path.join(root, "src"));
	out.push(path.join(root, "README.md"));
	return out
		.map((p) => path.relative(root, p).split(path.sep).join("/"))
		.sort();
}

function sourceStamp(root) {
	const hash = crypto.createHash("sha256");
	for (const rel of sourceFiles(root)) {
		const text = fs.readFileSync(path.join(root, rel), "utf8").replace(/\r\n/g, "\n");
		hash.update(`${rel}\0${text}\0`);
	}
	return hash.digest("hex");
}

module.exports = { STAMP_FILE, sourceStamp };
