# Issue 1. The WASM core's harmonic picker overrides a correct peak (bug report, no patch)

- **Problem.** The engine step that checks for half or double rates overrides correct readings.
- **Verdict.** Strong as a report. No patch, because on the owner's captures removing the step lowers the share right
  (37.5% to 34.4%) [owner]; something else has to change first.
- **Strongest evidence** [synthetic]. Clean sines straight into the core: 60 reads 66 (confidence 0.99), 72 reads 48
  (0.88), 90 reads 90, 140 nothing. A Rust test fails on main at 24 of 46 rates.
- **What a user sees.** Camera-colour path with fix 2, 480 s: picker off moves right seconds from 140 to 232 and
  wrong from 336 to 248.
- The same file carries a second draft issue (the fused pulse divided by its own near-zero mean).

Files: [issue.md](issue.md), audit [../../audits/core.md](../../audits/core.md), [picker.mjs](picker.mjs).

```
node picker.mjs <0.14.0 dir>    # 66, 48, 90, none
```
