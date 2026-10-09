#!/usr/bin/env node
// The last step of the build: record which source and README dist was built from (source-stamp.cjs),
// so check-test-release.mjs can refuse a dist that the checkout has moved on from.
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sourceStamp from "./source-stamp.cjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
writeFileSync(
	path.join(root, sourceStamp.STAMP_FILE),
	`${JSON.stringify({ sha256: sourceStamp.sourceStamp(root) })}\n`,
);
