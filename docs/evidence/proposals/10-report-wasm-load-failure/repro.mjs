// Fix 10, a failed engine load leaves no clue why. Node 20 or later; no data, no WASM needed (Node cannot load the
// WASM from the default browser URLs, which is exactly the failure being reported on).
//
//   node repro.mjs <pkgDir>     <pkgDir> holds dist/ (published 0.14.0, a fix-branch build, or packages/rppg-web here)
//
// On 0.14.0 the error detail is one fixed 85-character sentence and backendLoadError is undefined. Good is a message
// that names each URL tried and its own error.
// Self-check: before the failing load, the script checks the package exports what it calls, so a wrong folder
// fails loudly instead of looking like the defect. SELFCHECK_BREAK=1 asks for a missing export on purpose.
import { pathToFileURL } from "node:url";
const PKG = process.argv[2];
if (!PKG) {
	console.error("usage: node repro.mjs <pkgDir>");
	process.exit(2);
}
globalThis.document = { createElement: () => ({ getContext: () => ({}) }) };
const sdk = await import(pathToFileURL(`${PKG}/dist/index.js`).href);
for (const name of [
	"createRppgSession",
	"normalizeRppgError",
	process.env.SELFCHECK_BREAK ? "noSuchExport" : null,
]) {
	if (name && typeof sdk[name] !== "function")
		throw new Error(`self-check failed: ${name} is not exported by ${PKG}`);
}
console.log(
	`self-check ok: createRppgSession and normalizeRppgError found (${sdk.RPPG_WEB_BUILD_VERSION ?? "published"})`,
);
const onErrorCalls = [];
const session = await sdk.createRppgSession({
	video: {},
	backend: "auto",
	faceMesh: "off",
	autoStart: false,
	onError: (error) => onErrorCalls.push(error.code),
});
const diagnostics = session.getDiagnostics();
console.log("backendMode:", session.backendMode);
console.log("backendLoadError.message:", diagnostics.backendLoadError?.message);
const normalized = sdk.normalizeRppgError(session.lastError, diagnostics);
console.log(
	`normalized detail (${normalized.detail.length} characters):`,
	normalized.detail.replace(/(imported from )\S*\/dist\//g, "$1.../dist/"),
);
await session.dispose();
