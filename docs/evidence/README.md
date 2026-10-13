# Evidence for the proposed changes to rppg-web and the starter tools

This folder lets anyone check, from first principles, each change we propose to Elata's SDK. It is for Elata's
maintainers, the outside reviewer and the testers. Nothing here has been
sent to Elata yet. Written 2026-10-12, brought up to date 2026-10-13 (test.21, the replayable demo file, why
the pulse check is slow or silent on the owner's recordings, fix 1 at 2 s).

## How to read it

- **One folder per change** under [proposals/](proposals/). Each holds a short `README.md` (problem, fix, verdict,
  strongest evidence, cost, what is still open, where the code is), the full PR text (`pr.md`), and small scripts
  that reproduce the problem on the published package and show the change.
- **Audits** under [audits/](audits/): a reviewer playing an Elata maintainer, looking for reasons not to merge.
  Each audit covers several changes and ends with a "Closed" section: every objection raised, what was done about
  it, and whether it closed. Audits are dated records; where a later measurement moved a verdict, the proposal's
  README, its `pr.md` and [open-gaps.md](open-gaps.md) carry the current state. Fixes 1, 3 and 4 share `runner.md`; 2 and the issue `core.md`; 5 and 13
  `estimators.md`; 11 and 12 `processor.md`; 6, 7 and 8 `tooling.md` and `cross-os.md`; 9 and 10 `runtime.md`.
- **The test build** under [test-build/](test-build/): the audits and build notes of `@amelhede/rppg-web`
  0.15.0-test.17 to test.21 (the build testers install), the behaviour difference against 0.14.0, and the
  package-tool checks.
- [methods.md](methods.md): how the pulse check works, every constant and its source.
- [open-gaps.md](open-gaps.md): everything not yet evidenced, what would close it, and who can.
- [tools/strap-score/](tools/strap-score/): scores the demo page's "Save readings" file against a chest strap
  (Polar, HRV Logger, Elite HRV, Kubios or a plain RR list), with self-checks and synthetic examples. Since test.21
  that file is JSON and also holds what the pulse check was fed, so `--replay` scores every dim-light rule on the
  same seconds.

Labels on every number:

- **[synthetic]**: generated input with a known answer. Anyone can rerun it with the named script.
- **[owner]**: private, owner recordings. One person's own webcam captures, each with one typed reference rate. The
  recordings are not in this repository. Scripts that use them take a `RECORDINGS_DIR` argument.
- Some PR texts and audits mention **private** context: recordings whose licence does not allow us to share them or
  any number from them. Those numbers are removed from this copy. A private appendix holds them: ask Andreas
  Melhede.

Words: **0.14.0** is the published `@elata-biosciences/rppg-web`; **main** is Elata's main at 49fdb41; **right**
means within 5 bpm unless a row says otherwise; **red on main, green on the branch** means a test that fails on
Elata's code and passes with the change. `S/` in the audits is the private working folder; files there are not in
this repository unless copied here. Paths like `scratch/...` were temporary work folders, since deleted. One
upstream identifier prefix is written `PREFIX_` in quoted error messages.

## The release path

Every change goes through the same steps, in this order, and none is skipped:

1. **Fork.** Build it in the fork (`AMelhede/elata-bio-sdk`), one change per commit, each with a test that fails
   without it.
2. **npm test build.** Publish the fork as `@amelhede/rppg-web` with a `-test.N` version, every change behind its own
   on/off switch, so a tester can turn one off and compare.
3. **Testers in live apps.** Swap the test build into real apps with a one-line package alias, test with real people
   and a reference sensor, and log each result against the exact version.
4. **Outside review.** The outside reviewer checks the method ([methods.md](methods.md)).
5. **Then one PR per change into Elata's SDK**, opened from a clean one-commit `pr/*` ref, only once the whole team
   has tested it and decided together.

Today we are between steps 2 and 3. test.21 is built, audited and pushed (`release/test-1` 84ff8b2, tarball sha256
b5a6bd5e...; create-elata-demo 0.12.2-test.4 at e3e44c3 pins it); nothing is published. The demo page testers use runs test.21 from its tarball, so the strap study does not wait
for npm.

## The changes at a glance

Verdict words: **strong** = beats leaving the code alone on evidence anyone can rerun; **narrow** = true but smaller
than first claimed; **withdrawn** = do not send the code.

| Change | Verdict | Strongest evidence | Cost | Still open | Branch, one-commit ref |
|---|---|---|---|---|---|
| [1. No face, no reading](proposals/01-no-face-no-reading/) | strong | wall gap: a number in 10 of 10 s on 0.14.0; with the fix 2 held readings, then nothing (1 in the test build, which holds 1 s) [synthetic] | no number while no face is in view | real moving people not measured; on a synthetic head (180 runs) the 2 s hold shows 388 wrong seconds against 539 for 1 s and 1083 on main, so the PR now holds 2 s; the test build still holds 1 s (test.21) | `fix/no-face-no-reading` 55de1a7, `pr/no-face-no-reading` 8dde554 |
| [2. Core colour projection sign](proposals/02-rust-colour-projection-sign/) | strong | true 90 under a lamp at 60 reads 67 on 0.14.0, about 90 with the fix [synthetic] | camera-colour path shows more numbers; the wrong share of them falls from 85 to 71 in 100, but the count of wrong seconds rises (issue 1) | no shareable real-capture check | `fix/rust-colour-projection-sign` 06f93f6, `pr/...` b527385 |
| [3. Real frame rate](proposals/03-real-frame-rate/) | narrow, **held** from the first round | quality at 15 fps 0.19 of its 30 fps value with fix 4 alone, 1.00 with fix 3 [synthetic] | `getMetrics()` 142 against 57 ms at 15 fps | changes no rate once fix 4 is in; comes back only with a pre-registered test on unseen recordings | `fix/real-frame-rate` bd72c7e, `pr/...` ff1cc00 |
| [4. POS in the fuser](proposals/04-pos-in-fuser/) | strong | true 120 right in 0 of 150 s on 0.14.0, 150 of 150 with POS [synthetic] | default output of every face-mesh session changes | breathing under POS not measured | `fix/pos-in-fuser` 564d589, `pr/...` deca8d7 |
| [5. No rate doubling](proposals/05-no-rate-doubling/) | keep, narrower | 105 clean resting pulses: 69 right on 0.14.0, 105 with the fix [synthetic] | 10 more no-pulse seconds with a number of 432 | no measured gain on real captures, with or without fix 13's option, on Elata main with fix 4 [owner] | `fix/no-rate-doubling` ea12c6b, `pr/...` 1a73b09 |
| [6. Maker crashes](proposals/06-create-elata-demo-starts/) | strong | 11 published versions crash; fixed on Windows, macOS, Linux | about 1 s more to pack | CI green only with fix 7; Windows, macOS and Linux closed ([cross-os.md](audits/cross-os.md)) | `fix/create-elata-demo-starts` fef0a51, `pr/...` 8b8ecad |
| [7. Starters build](proposals/07-starters-build-and-install/) | strong | 19 of 25 tool and starter pairs fail on main, 3 with the fix (all fix 8's npm problem); none newly broken | pnpm 9 needs `-w` | other awk versions, Intel macOS, PowerShell (Windows, macOS arm64, Linux closed) | `fix/starters-build-and-install` b94551e, `pr/...` aeb6d5b |
| [8. Peer ranges](proposals/08-eeg-web-ble-peer-range/) | strong | npm install fails today, packed fix installs clean | one manual release check | provable on npm only after publishing | `fix/eeg-web-ble-peer-range` 1c4d1fe, `pr/...` 2d3d672 |
| [9. Monitor timers](proposals/09-app-monitor-timers/) | strong | `start()` throws in 8 of 8 browser setups on 0.14.0 | none | Firefox, Safari not run | `fix/app-monitor-timers` 93db1f3, `pr/...` 9132e83 |
| [10. Engine load errors](proposals/10-report-wasm-load-failure/) | strong | one fixed 85-character sentence on 0.14.0; each URL and its error with the fix | longer message, carries host names | docs correction bundled | `fix/report-wasm-load-failure` 82ff7e0, `pr/...` 962299d |
| [11. Processor colour path](proposals/11-processor-colour-pulse/) | strong | spectral 84.0 for every true rate on 0.14.0; right with the option [synthetic] | opt-in, so nobody benefits by default | band-pass corner near 50 bpm | `fix/processor-colour-pulse` b748546, `pr/...` 9828923 |
| [12. Engine fallback](proposals/12-no-engine-fallback/) | withdrawn, issue only ([issue.md](proposals/12-no-engine-fallback/issue.md)) | `fused_bpm` already gives the checked rate in 5,440 of 5,440 reads | none (not sent) | file the issue at step 5 | `fix/no-engine-fallback` 6894d3a, `pr/...` 13793e5 |
| [13. Calibration blend](proposals/13-no-calibration-blend/) | modest | real engine, grey pulses: right in 1,813 of 2,592 s on 0.14.0, 2,053 with the option [synthetic] | one more option forever | shows the engine's octave when the engine has one; on Elata main with fix 4 a clear gain on real captures, 1,895 to 2,282 right seconds (37 recordings better, 8 worse) [owner]; fix 3 (held) takes that gain away, which is why our test build showed none | `fix/no-calibration-blend` 608e797, `pr/...` c4f98c2 |
| [Issue 1. Harmonic picker](proposals/issue-harmonic-picker/) | strong, as a report | clean 72 reads 48 at confidence 0.88 [synthetic] | none (no patch) | removing it does not help real captures yet | issue only |
| [Pulse check](proposals/pulse-check/) | strong on known answers, not ready | no pulse: a number in 44 of 60 s on 0.14.0, 0 with the check [synthetic] | first number after 18 to 22 s in Node, 24 to 29 s in a browser [synthetic], median 48.6 s [owner]; no number in 5,680 of 6,457 s, none at all in 10 of 50 recordings, and fewer right seconds than 0.14.0 (650 against 848) [owner]; HRV, breathing withheld. Why [owner, described, not tuned]: the 10 are mostly dim captures whose windows pointed at the right rate only 9 times in 100; of the 48.6 s wait, 18.6 s is the method itself and the rest is windows the rules refused, which were mostly wrong | failed its 10% bar on owner recordings (16.3%), and those are in-sample (its constants were tuned on them); with no wall in view, lamps whose colour change looks like blood get through (a stated limit: timing rules were tested and none can work, see open-gaps); needs a re-cut, real footage, a chest strap; four dim-light rules are built, off, waiting for the strap study | method on `release/test-1` 6084d8d (test.21) |
| [test.21's own changes](test-build/test21-build.md) | built and audited ([test21-audit.md](test-build/test21-audit.md)) | with the four dim-light rules off, every read identical to test.20 [synthetic], and the check's state equal at all 7,555 evaluations on 51 owner files [owner]; a saved recording replays to every number shown (6,340 of 6,340 reads; the demo page's saved file on the final tarball, 77 of 77 seconds) [synthetic] | none while the recording is off; on, about 7 MB held for 5 minutes | a real camera; no tester file replayed yet | `release/test-1` 84ff8b2 |

The `fix/*` branches are on the fork (`github.com/AMelhede/elata-bio-sdk`). The `pr/*` refs carry the same tree as
the branch tip on a single commit on 49fdb41; they are local until Andreas pushes them. Merge order, holds and the known
conflicts: [proposals/merge-plan.md](proposals/merge-plan.md). The first round is eleven PRs (fixes 1, 2, 4 to 11 and
13); fix 3 is held and fix 12 goes as an issue. Merged together onto 49fdb41 the eleven pass every rppg-web check
(53 suites, 437 tests).

## REPRODUCE

You need Node 20 or later and this branch checked out. Every script prints a self-check line first: it checks its
own generated input against the known answer with a separate DFT (or checks its folder or the registry), and throws
if that fails. To watch a self-check throw: `SELFCHECK_BREAK=1` for the single-check Node scripts;
`BREAK=rate|window|nogate` for `05-no-rate-doubling/grey-suite.mjs` and `SELFCHECK_BREAK=rate|window|nogate` for
`11-processor-colour-pulse/owner-recordings.mjs`; the bash scripts have no break switch. In `no-pulse-session.mjs` the
self-check always checks the 72 bpm generator, also on a no-pulse run, because the no-pulse input is the same face
with the pulse set to 0.

```
git clone https://github.com/AMelhede/elata-bio-sdk && cd elata-bio-sdk && git checkout docs/evidence
mkdir -p /tmp/p14 && (cd /tmp/p14 && npm init -y >/dev/null && npm install @elata-biosciences/rppg-web@0.14.0)
P14=/tmp/p14/node_modules/@elata-biosciences/rppg-web     # the published package
T=packages/rppg-web                                         # the test build (test.19), built files committed here
E=docs/evidence/proposals

node $E/pulse-check/no-pulse-session.mjs $P14               # no pulse: a number in 44 of 60 s
node $E/pulse-check/no-pulse-session.mjs $T 0 check         # with the check: 0 of 60
node $E/01-no-face-no-reading/face-gap.mjs $P14 gap 10      # a number in 10/10 s of a wall gap
node $E/01-no-face-no-reading/face-gap.mjs $T gap 10        # 1/10, then right 65/65
node $E/02-rust-colour-projection-sign/lamp.mjs $P14 90 60  # lamp wins: 67
node $E/02-rust-colour-projection-sign/lamp.mjs $T 90 60    # pulse wins: about 90
node $E/03-real-frame-rate/grid-amp.mjs $P14                # 0.48, 0.63, 6.93 s
node $E/04-pos-in-fuser/fuser.mjs $P14                      # 99, 50, 67, 109, 63 for a true 72
node $E/04-pos-in-fuser/fuser.mjs $T                        # 72 five times
node $E/05-no-rate-doubling/doubling.mjs $P14               # 132 for a true 65
node $E/10-report-wasm-load-failure/repro.mjs $P14          # 85 characters, no URLs
node $E/11-processor-colour-pulse/colour-path.mjs $P14      # spectral 84.0 for 50, 72, 120
node $E/12-no-engine-fallback/fallback.mjs $P14             # bpm 88 with no pulse, fused_bpm null
node $E/13-no-calibration-blend/blend.mjs $P14              # 95.7 rising to 116.4 for a true 120
node $E/issue-harmonic-picker/picker.mjs $P14               # 72 reads 48
bash $E/06-create-elata-demo-starts/repro.sh                # exit 1, missing app-metrics metadata
bash $E/08-eeg-web-ble-peer-range/repro.sh                  # ERESOLVE, ETARGET, ETARGET
SELFCHECK_BREAK=1 node $E/04-pos-in-fuser/fuser.mjs $P14    # must throw "self-check failed"
```

Fixes 12 and 13 are not in the test build, and the `fix/*` branches do not commit their built files. To see a fix
branch's own "with" numbers: check it out, run `pnpm install && pnpm --filter @elata-biosciences/rppg-web build`,
and pass `packages/rppg-web`. A source build has no `pkg/` (the WASM): copy it from 0.14.0, except for fix 2,
which changes the WASM and needs a wasm-bindgen build of `crates/elata-rppg-wasm` (its PR text, "Package-level
script", says how).

The scripts were run as written from a clean checkout of this branch on 2026-10-12; the outputs matched the comments
above.

## What this folder does not contain

No recordings, no video, nothing that identifies a person, and no number from recordings we may not share. No
dataset names. The full methods packet with the private evaluation is kept outside any repository.

## Where each proposal's code lives

Each proposal folder holds its code as one file, `fix.patch`: one commit on top of
Elata's `main` at 49fdb41, so there is no branch per proposal to keep. To rebuild a
proposal as a branch on the day its pull request is opened:

    git checkout -b fix/<name> 49fdb41 && git am docs/evidence/proposals/NN-<name>/fix.patch

Each file was checked to rebuild exactly the code of its former branch (same tree).
The full working history of every former branch stays reachable from `archive/2026-10`.
