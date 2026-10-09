#!/usr/bin/env node
// The first step of the build: delete tsc's record of the last compile (tsconfig.tsbuildinfo, kept
// outside dist because the project is composite). With it, tsc skips files it thinks are current,
// so a dist restored from an older build stayed old while the stamp was rewritten from the new
// source. Without it, every file is emitted again from the source in the checkout.
import { rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
rmSync(path.join(root, "tsconfig.tsbuildinfo"), { force: true });
