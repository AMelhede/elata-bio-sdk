# Fix 10. Keep why the WASM engine failed to load

- **Problem.** When the engine fails to load, the only message is one fixed 85-character sentence; which URLs were
  tried and why each failed is lost.
- **Fix.** Record each URL tried and its own error.
- **Verdict.** Strong.
- **Strongest evidence.** Four broken server setups in Chromium give the same sentence on 0.14.0; with the fix each
  URL is named with its error (for example "expected magic word 00 61 73 6d" for a single-page-app fallback).
- **Cost.** The detail is about 5 times longer (434 to 446 characters) and carries host names. Codes and states are
  unchanged.
- **Still open.** A docs correction is bundled (a split is offered). Root-relative default URLs are a follow-up.
- **Where.** Branch `fix/report-wasm-load-failure` 82ff7e0; `pr/report-wasm-load-failure` 962299d (local).

Files: [pr.md](pr.md), audit [../../audits/runtime.md](../../audits/runtime.md), [repro.mjs](repro.mjs).

```
node repro.mjs <0.14.0 dir>         # 85 characters, no URLs
node repro.mjs packages/rppg-web    # each URL with its error
```
