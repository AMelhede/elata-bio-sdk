> Note for readers of this copy (2026-10-12): this plan predates the final verdicts. It still lists fix 12 in the
> merge order (fix 12 is now an issue only) and its title still says ten fixes. The conflict notes are current.
> `wip/all-fixes` is a local branch and is not on the fork.

# Merging the ten SDK fixes together

**Bottom line.** The ten fixes work together. Merged one after another onto Elata's main (49fdb41) and tested as one tree, every suite they touch passes, nothing fails that passes on main, and each fix's own test still catches its bug when that fix is removed from the merged tree. Three PRs need a small update when the PR before them lands: 8 conflict spots in all, each one "keep both sides". Every merge order gives the same 8 (measured), so the order below follows what the fixes need from each other. It swaps fix 3 and fix 4 from the draft order, because fix 3 itself asks for fix 4 first, and the merged tree shows why (table in section 4).

The merged branch is local only: `wip/all-fixes` in the upstream-tracking checkout, tip 5874216 (ten merges plus one new test) for the ten fixes, then 5e03d70 with fix 11 merged on top (section 1). Nothing was pushed, opened or published.

## 1. Recommended order

| # | fix | branch (tip) | conflicts when it lands |
|---|---|---|---|
| 1 | Fix 1, no face means no reading | `fix/no-face-no-reading` (21b7326; one-commit `pr/no-face-no-reading`) | none |
| 2 | Fix 2, Rust colour projection sign | `fix/rust-colour-projection-sign` (06f93f6; one-commit `pr/rust-colour-projection-sign`) | none |
| 3 | Fix 4, POS in the fuser | `fix/pos-in-fuser` (564d589; one-commit `pr/pos-in-fuser`) | 2 hunks with fix 1 |
| 4 | Fix 3, real frame rate | `fix/real-frame-rate` (bd72c7e; one-commit `pr/real-frame-rate`) | 5 hunks (3 with fix 1, 2 with fix 4), plus 3 wording edits git does not flag |
| 5 | Fix 5, no rate doubling | `fix/no-rate-doubling` (ea12c6b) | none |
| 6 | Fix 6, starter maker crash | `fix/create-elata-demo-starts` (fef0a51) | none |
| 7 | Fix 7, starters build and install | `fix/starters-build-and-install` (b94551e) | none |
| 8 | Fix 8, peer ranges | `fix/eeg-web-ble-peer-range` (1c4d1fe) | 1 hunk with fix 6 |
| 9 | Fix 9, app monitor timers | `fix/app-monitor-timers` (93db1f3) | none |
| 10 | Fix 10, WASM load failure | `fix/report-wasm-load-failure` (82ff7e0) | none |
| 11 | Fix 11, processor colour path (opt-in `rgbPulse: "pos"`) | `fix/processor-colour-pulse` (b748546) | none from git; one line git does not flag, after fix 1 (below) |
| 12 | Fix 12, the processor's refusal can hold (opt-in `engineFallback: false`). Recommended after review: file the issue only, do not open the PR (fix12.md, top) | `fix/no-engine-fallback` (6894d3a) | none |
| 13 | Fix 13, `bpm` shows the resolved rate, not the calibration's blend (opt-in `calibrationBlend: false`) | `fix/no-calibration-blend` (608e797) | none |

Fix 11 was added on 2026-10-12, after the ten above were measured together. It goes last because it needs nothing
from fixes 5 to 10 and both things it touches land earlier: fix 4 brings the same `PosPulseModel` (byte-identical,
so it merges once), and fix 1 brings `resetSignal()`, which must also restart fix 11's extractor. Update after fix 1
has merged: add `this.rgbPulseExtractor.reset();` after `this.chromPulse.reset();` in `resetSignal()` and the test
in fix11.md ("Merging with the other fixes"); it is red without the line. On the merged tree with fix 11
(`wip/all-fixes` at 5e03d70): rppg-web jest 53 suites, 441 tests; `tsc` and Biome lint clean; breaking fix 11's
parts there turns its tests red. Fix 11 is opt-in, so nothing measured in sections 3 to 5 changes with its default.
After review (2026-10-12) fix 11 gained two commits (a grey sample after colour gives 0; tests read every 5 s), tip
b748546, pr/ ref 9828923. Merged onto a scratch copy of `wip/all-fixes` (32ce8b1): clean, rppg-web jest 55 suites
and 463 tests pass, `tsc` and Biome lint clean. `wip/all-fixes` itself was not moved.

Fix 12 was added on 2026-10-12, after fix 11. It needs nothing from the others and conflicts with none: `git
merge-tree` is clean against each of the eleven branches and against `wip/all-fixes` (its third commit moved its
option, field, session line and lifecycle test a few lines away from where fix 1 and fix 11 add theirs; the first
layout conflicted with both, keep-both hunks). It goes last only because it is the newest. It has no state, so
fix 1's `resetSignal()` needs nothing for it: after a reset the processor has under 24 samples, and with
`engineFallback: false` those reads are empty, which is what the option is for. On the merged tree with fix 12
(`wip/all-fixes` at 4471632): rppg-web jest 54 suites, 451 tests; `tsc` both configs and Biome lint clean;
with the processor made to ignore the option there, its 8 tests that depend on it turn red (the same 8 as on the branch). Fix 12 is opt-in, so nothing measured in sections 3 to 5 changes with its default.

Fix 13 was added on 2026-10-12, after fix 12. It needs nothing from the others and conflicts with none: `git
merge-tree` is clean against each of the twelve branches and against `wip/all-fixes` (its second commit moved its
field away from the spot after `windowSec` where fix 1 adds `trackerSettings`). It has no state, so fix 1's
`resetSignal()` needs nothing for it. One interaction git cannot flag: fix 5 removes the spectral doubling, so on a
tree with fix 5 a 72 bpm pulse no longer makes the estimators disagree; fix 13's default-pin test was narrowed to the
autocorrelation's disagreement (120 and 140) for that reason (608e797). On the merged tree with fix 13
(`wip/all-fixes` at 32ce8b1, two merges of the branch): rppg-web jest 55 suites, 461 tests; `tsc` both configs and
Biome lint clean; with the processor made to ignore the option there, 5 of its tests turn red. Fix 13 is opt-in, so
nothing measured in sections 3 to 5 changes with its default; it and fix 12 act on different reads (passed and
refused).

Fix 5 and fix 13 also interact in what they buy, measured 2026-10-12 on the owner's 50 camera recordings through
main's session path (private, context only): fix 5 alone 1,296 -> 1,289 right seconds of 6,679 (a wash; its lost
seconds are mostly reads where the gate now passes and the calibration blend is shown), fix 13's option alone
1,625, both 1,653. Neither needs the other to merge, and the order above does not change; but fix 5's value on real
camera signals shows only with fix 13's option on, and fix5.md now says so.

**Why this order.**

- Pairwise, only four pairs conflict: fix 1 with fix 3, fix 1 with fix 4, fix 3 with fix 4 (all in `packages/rppg-web/src/demoRunner.ts`, plus `rppgSession.ts` and the rppg-web README), and fix 6 with fix 8 (one import line). The other six fixes merge cleanly with every other fix (all 45 pairs checked with `git merge-tree`) and in both full sequences that were run (draft order and recommended order); no conflict appears beyond these four pairs.
- Fixes 1, 3 and 4 conflict with each other, so whichever lands second and third carries the resolution. Measured: the second merge conflicts in 3 hunks (fix 1 and fix 3 first), 2 (fix 1 and fix 4) or 2 (fix 4 and fix 3), and the third merge then in 4, 5 or 5. Always 7, whichever of the six orders (swapping the first two changes neither count). Fix 6 and fix 8: 1 either way. So no order saves work; the order follows dependencies.
- Fix 3 says "Land fix 4 first, or with this one": the grid on its own, with CHROM still in the fuser, reads resting rates wrong more often on slow cameras. On the merged tree that is 39 of 60 windows right at 15 fps against 60 of 60 with POS (section 4).
- Fix 1 first: it is the most visible bug, and it leaves fix 4's update at two keep-both hunks.
- Fix 6 before fix 8: fix 8's release docs then describe fix 6's release order (create-elata-demo last), and fix 8 carries the one-line conflict.

**How a later PR updates.** Merge main into the PR branch (one commit on top; the fork's branches only move forward, no rebase or force push) and resolve as below. The PRs ask to be squash-merged, so that commit does not reach main's history.

## 2. Conflicts and their resolutions

**Fix 4 (`fix/pos-in-fuser`), after fix 1 has landed.** Two hunks, keep both sides:

- `packages/rppg-web/src/demoRunner.ts`, `DemoRunnerOptions`: main adds `requireFace` right after `multiRoiFusion`, where fix 4 adds `fusionProjection`. Keep both options with their doc comments, `requireFace` first.
- `packages/rppg-web/src/rppgSession.ts`, the options `createRppgSession` passes to `new DemoRunner`: same place. Keep `requireFace: options.requireFace ?? (faceTrackingMode === "face_mesh" && options.roi === undefined),` then `fusionProjection: options.fusionProjection,`.

**Fix 3 (`fix/real-frame-rate`), after fixes 1 and 4 have landed.** Five hunks:

- `demoRunner.ts`, above `export class DemoRunner`: main's `FACE_GONE_RESET_MS` and fix 3's grid types and helpers (`FusionSamples`, `GridSample`, `ProcessorSample`, `GRID_MAX_GAP_MS`, `pushToProcessor`, `interpolateGrid`). Keep both.
- `demoRunner.ts`, class fields: keep main's `noFaceSinceMs` and `noFaceLastMs` and fix 3's `gridPrev`, `gridNextT` and `gridFused`.
- `demoRunner.ts`, `stop()`: keep both `this.noFaceSinceMs = null;` and `this.gridPrev = null;`.
- `demoRunner.ts`, the push in `onFrame`: keep fix 3's version (`pushOnGrid` for frames with fusion regions, `pushToProcessor` otherwise). Fix 4's rewording of the fused-branch comment moves into `pushOnGrid`: "Fused pulse already carries the per-region projection + SNR-weighted blending; feed it straight to spectral BPM/HRV, with the fused SNR as quality."
- `packages/rppg-web/README.md`, the multi-ROI fusion paragraph: keep fix 4's paragraph (POS, `fusionProjection: "chrom"`) and append fix 3's sentences about the grid.

Not flagged by git, still needed: once POS is the default, the fuser's 45-sample window belongs to whichever projection is chosen. Write "projection window" for "CHROM window" in `pushOnGrid`'s doc comment, in the `pushFrame` doc comment fix 3 adds to `multiRoiFusion.ts`, and in the header comment of `demoRunnerFrameGrid.test.ts`. Also add `demoRunnerFaceGapGrid.test.ts` from the merged branch (section 4).

**Fix 8 (`fix/eeg-web-ble-peer-range`), after fix 6 has landed.** One hunk: in `packages/create-elata-demo/index.test.mjs`, the `node:fs` import list, both add `readdirSync` after `readFileSync` and fix 6 also adds `statSync`. Keep `readdirSync,` once, then `statSync,`. `docs/releasing.md` and `scripts/run-lib.sh` merge on their own.

Each resolution was cross-checked by building the same three-way merge in a second order (fix 4 and fix 3 first, fix 1 last): the result differs only in the order of declarations. Merging in the draft order (3 before 4) and in the recommended order gives byte-identical final trees.

## 3. Test results on the merged tree

Every suite the branches touch, on the merged tree and on main. "Pass" counts are tests.

| suite | merged tree | main (49fdb41) |
|---|---|---|
| rppg-web jest | 421 of 421, 52 suites | 350 of 350, 43 suites |
| rppg-web `tsc` (build config, and test config) | clean, clean | clean, clean |
| rppg-web Biome lint | clean | clean |
| create-elata-demo `node --test` (five-template smoke included) | 25 of 25 (2026-10-12, with fixes 6, 7 and 8 at the tips above merged on top of wip/all-fixes 32ce8b1; merges clean, the fix 6 / fix 8 import hunk already resolved there) | 15 of 17 (packaged-contents scaffold and smoke fail) |
| eeg-web-ble jest | 53 of 53 | 53 of 53 |
| ppg-web jest | 8 of 8 | 8 of 8 |
| eeg-web-ble Biome lint | 1 error (`src/browserCheck.ts:18`) | the same error |
| `./run.sh test run-sh` | ok | ok |
| `scripts/audit-repo.mjs` | passes | passes |
| `cargo test -p elata-rppg --all-targets`, plus doctest | 29 of 29, doctest 1 of 1 | 25 of 25 |
| `cargo clippy -p elata-rppg --all-targets -D warnings` | clean | clean |

New failures against main: none. Biome format on the 27 files the fixes change: no file has more findings than the worst single branch that touches it (`index.test.mjs` carries exactly the three branches' own additions, 334 on main, 677 merged; `demoRunner.ts` 14 merged against 18 on main).

**Each fix's own test still means what it claims.** Each fix was broken on the merged tree, its tests run, then restored:

| fix | broken on the merged tree | red |
|---|---|---|
| 1 | frames without a face read from the centre square | 7 |
| 1 | no restart when the face returns | 3 |
| 1 | session reports the last number with no face | 2 |
| 1 | `requireFace` never set | 4 |
| 1 | `resetSignal()` keeps the old window | 3 |
| 2 | main's sign (X + alpha Y) | 3 |
| 2 | no bypass for fused windows | 3 |
| 2 | bypass decided per sample | 1 |
| 3 | grid never bridges (fuser fed per frame) | 7 |
| 3 | no grid restart after a frame without regions; NaN timestamp bridged; `stop()` keeps the grid; stall rule removed | 1 each |
| 4 | CHROM default again | 5 |
| 4 | POS output not negated; `DemoRunner` ignores `fusionProjection`; session does not pass it | 1 each |
| 5 | production change reverted | 8 of 9 |
| 6 | `appMetrics` dropped | 4 |
| 6 | scaffolder published before app-metrics; release-check skips the check; `verify:publish` without the packed check; stray file counted as a template | 1 each |
| 6 | sync knows only the four old keys | 2 |
| 7 | rppg-demo back on `vite-plugin-top-level-await` | guard red, and the smoke fails at install (pnpm refuses the unreviewed `@swc/core` build script) |
| 7 | eeg-ble starter without `allowBuilds` | guard red |
| 7 | unlink leaves workspace link overrides | run-sh tests fail |
| 8 | ppg-web or eeg-web-ble peers back to main's | audit fails (3 and 1 findings) |
| 8 | no range sync on a bump; release commit takes only the release set | release test red, each |
| 9 | production change reverted | 2 |
| 10 | production change reverted | wasmBackend 2 red, session suite fails to compile |
| 10 | the reason not reported in diagnostics | 4 of 7 |

With every fix in place again, all of these are green.

## 4. Interactions with no textual conflict

**The frame grid (fix 3) and the no-face restart (fix 1).** Both act on DemoRunner's multi-region frames. They work together: when the face returns after 1 s or more, fix 1 resets the fuser and the processor, and fix 3's 250 ms stall rule restarts the grid, so no sample is interpolated across the gap. That relies on the stall limit (250 ms) staying below the hold (1 s). New test `demoRunnerFaceGapGrid.test.ts` (3 tests, at 15 fps so the grid fills in samples): no sample is drawn across a 1.5 s gap and the first sample after it is the returning frame's own; a 120 ms miss (200 ms between face frames) is filled in, a 600 ms miss is not, and neither restarts the signal; a 66 bpm pulse reads within 3 of 66 before and after a 10 s gap. Red when the stall limit is raised to 5 s (2 tests), when the restart is removed (2), when the grid never bridges (1). One consequence for fix 1's text: on the multi-region path a face-finder miss of 250 ms or less between face frames is now filled in rather than left as a hole.

**POS in the fuser (fix 4), the Rust sign fix (fix 2) and the fuser's zero-mean output.** The WASM core was built twice from the merged tree, with fix 2 and with main's `pipeline.rs`, and driven through the merged DemoRunner and RppgProcessor: synthetic face frames, a chromatic pulse 0.4% deep with one grey level of sensor noise, 54 to 140 bpm, POS and CHROM, three seeds; 144 runs at 30 and 15 fps read at 15, 20 and 25 s, and 72 runs at 30 fps read every second from 5 to 12 s, across the switch from camera RGB to fused samples.

- The core's rate is identical with and without fix 2 in all 216 runs. Fix 2 changes the camera-RGB paths and leaves the default fused path as it was, as its PR says.
- The core's rate within 5 bpm, POS against CHROM in the fuser: 77 of 108 against 14 of 108 at 15 to 25 s; 93 of 144 against 7 of 144 at 5 to 12 s.
- Why the switch moment did not matter: each 1.6 s window of the fuser's zero-mean values is divided by its own near-zero mean inside the core, which makes those samples far larger than the camera RGB beside them. Fix 2 already names this as a separate issue.
- Reported rate: in these runs it moved about 3 to 4 bpm per `getMetrics()` call (read every 5 s, 114 bpm climbed from 90 to 104 over six reads), so the 5 s reads above understate it. Polled once a second, as apps do, it is within 5 bpm in 113 of 120 seconds from 20 to 39 s at 114 and 140 bpm (POS, three seeds each).

**The frame grid (fix 3) with POS (fix 4).** Fix 3's own trade-off probe, run on the merged tree: the SDK's `analyzePulseWindow` on the fused output, 8 s windows ending every 2 s from 12 to 30 s, six seeds, so 60 windows per cell; a window is right within 5 bpm. The merged tree includes fix 5, so its numbers differ slightly from fix 3's text. Columns: no grid with CHROM (main's runner), grid with CHROM (fix 3 alone), no grid with POS (fix 4 alone), grid with POS (both).

| true rate, sensor noise | 30 fps | 24 fps | 20 fps | 15 fps |
|---|---|---|---|---|
| 66 bpm, 1 grey level | 59 / 59 / 60 / 60 | 53 / 53 / 60 / 60 | 54 / 52 / 60 / 60 | 56 / 39 / 60 / 60 |
| 96 bpm, 1 grey level | 57 / 57 / 60 / 60 | 52 / 42 / 60 / 60 | 56 / 42 / 60 / 60 | 58 / 28 / 60 / 60 |
| 150 bpm, 1 grey level | 51 / 51 / 60 / 60 | 55 / 57 / 60 / 60 | 43 / 51 / 60 / 60 | 29 / 29 / 60 / 60 |
| 66 bpm, 3 grey levels | 22 / 22 / 60 / 60 | 7 / 18 / 60 / 60 | 23 / 15 / 60 / 60 | 25 / 20 / 60 / 60 |
| 96 bpm, 3 grey levels | 9 / 9 / 60 / 60 | 12 / 9 / 60 / 60 | 22 / 18 / 60 / 60 | 16 / 4 / 60 / 60 |
| 150 bpm, 3 grey levels | 7 / 7 / 60 / 60 | 3 / 5 / 60 / 60 | 6 / 3 / 60 / 60 | 1 / 4 / 60 / 60 |

With POS every cell is 60 of 60, at both noise levels, with and without the grid. Grid with CHROM falls to 39, 28 and 4 of 60 at 15 fps, which is the loss fix 3 reports; POS removes it. On this fixture the grid neither helps nor hurts the rate read once POS is in; its own gains are amplitude and warm-up at the camera's real rate (fix 3's text).

**The peer-range release sync (fix 8), the `elataSdkVersions` sync and the publish order (fix 6).** A minor release was run on the merged tree with npm and `git push` stubbed (`bump_publish_packages minor`, `publish_packages all latest`, then the release commit). Published in this order: eeg-web 0.13.0, eeg-web-ble 0.13.0, rppg-web 0.15.0, rppg-models-web 0.2.0, ppg-web 0.13.0, app-metrics 0.6.0, biosignal-session 0.2.0, then create-elata-demo 0.13.1 with `elataSdkVersions` exactly eeg-web 0.13.0, eeg-web-ble 0.13.0, rppg-web 0.15.0, ppg-web 0.13.0, app-metrics 0.6.0. Every workspace peer range took its sibling's new version (eeg-web-ble, ppg-web, biosignal-session), the audit passed afterwards, and nothing was left uncommitted.

**All eleven changesets together.** `changeset version` on the merged tree (the `./run.sh bump` path): rppg-web 0.15.0, eeg-web-ble 0.12.1, create-elata-demo 0.12.2, rppg-models-web 0.2.0, and ppg-web 1.0.0 (biosignal-session and biosignal-analytics 1.0.0 as on main). Changesets bumps ppg-web to a major because rppg-web, which it peers on, takes a minor. Fix 8's text already warns about this and gives the two ways out (release fix 8's two packages first, or set ppg-web to 0.13.0 when reviewing the bump). No two changesets share a file name.

## 5. Seen along the way, not caused by any fix

- On the fused path at 30 fps the core reads 54 bpm as about 62 and 66 as about 70, with both builds of the core; the reported rate reads them right (54.3 to 55.1, 66.4 to 67.1).
- The per-window division of the fuser's zero-mean output by its own mean (fix 2's "separate issues").
- The eeg-web-ble lint error, on main as well.

## 6. Where things are

- Merged branch: `wip/all-fixes` in the upstream-tracking checkout, never pushed. 5874216 is the ten fixes plus the face-gap
  grid test; 5e03d70, two merges and one commit later, adds fix 11 and its `resetSignal` line with its test.
  4471632 merges fix 12 on top (clean). d7bcce2 and 32ce8b1 merge fix 13 (clean; the second brings its test change).
- The ten fix branches are unchanged by this work.
- Each affected PR text (fix1, fix2, fix3, fix4, fix6, fix8) has a "Merging with the other fixes" section with its update note. Fixes 5, 7, 9 and 10 merge cleanly against every other fix and need no note.

## 7. Re-check after the runner-group gaps were closed (2026-10-12)

Three branches moved forward (new commits on top, pushed fast-forward to the fork): fix 1 to 21b7326 (a `typeof`
check before `resetSignal()` with its test, and the README's account of how soon a reading returns), fix 4 to 564d589
(a test pinning `fusionProjection: "chrom"` to the fuser on 49fdb41), fix 3 to bd72c7e (the 60 fps amplitude test).
Their one-commit `pr/*` refs were regenerated (same trees, parent 49fdb41, local only). All three merged into a scratch
copy of `wip/all-fixes` (32ce8b1) without conflicts, plus one new merged-tree test proposed for fix 3's update,
`demoRunnerFrameGridQuality.test.ts` (same pulse, same fused quality at 15, 30 and 60 fps; red with fix 4 alone, 0.19
and 2.77; green with fix 3 on top). On that tree: rppg-web jest 57 suites, 467 tests; `tsc` and Biome lint clean.
`wip/all-fixes` itself was not changed; the scratch copy (detached, scratch/rc/merge, tip 9bc8d38) was rerun after fix 1's README commit with the same result, and the new test file is in case/rc/.

## 8. Re-check after the core-group gaps were closed (2026-10-12)

Fix 2 moved forward one commit (06f93f6, pushed fast-forward to the fork): a window of R = G = B samples keeps
main's exact expression, so the default fused path is bit for bit unchanged, with a test pinning it (red on
021a870). Its one-commit `pr/rust-colour-projection-sign` ref was regenerated (b527385, same tree as 06f93f6,
parent 49fdb41, local only). Merged into a scratch copy of `wip/all-fixes` (32ce8b1, detached at scratch/c2/merge,
merge 8fdcb11) without conflicts: `cargo test -p elata-rppg --all-targets` 30/30 plus the doctest, clippy with
`-D warnings` clean, elata-rppg-ffi and elata-rppg-wasm pass. `wip/all-fixes` itself was not changed. Section 4's
"identical with and without fix 2 in all 216 runs" holds a fortiori: fused windows are now bit-identical too.

