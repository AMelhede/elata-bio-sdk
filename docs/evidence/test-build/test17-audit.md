# test17-audit: publish readiness of @amelhede/rppg-web 0.15.0-test.17 and @amelhede/create-elata-demo 0.12.2-test.1

Date 2026-10-11. Branch release/test-1, audited at ba382d9, fixed and pushed fast-forward as ba382d9..f01f828 (five commits; both release checks printed ready right before the push; `git ls-remote` shows f01f828).
Work clones scratch/t17-clone (audit of ba382d9, untouched), scratch/t17-fix (fixes), scratch/t17-crlf
(Windows line-ending simulation); all deleted at the end. Node 22.22.2, npm 10.9.7, npm 11.21.0 (npx),
pnpm 9.15.9, 10.33.2 (corepack), 12.11.2 (current `latest` on npm today), tsc 5.9.3, publint 0.3.25,
attw 0.18.5, Chromium 1194 (one page, for the app monitor). Nothing was published, nothing opened on Elata.

## Verdict

Ready to publish: yes, both, after the commits below (the release checks print ready on the pushed tip).
Order stays as PUBLISHING.md says: rppg-web first, then create-elata-demo (its --publish check refuses
until rppg-web 0.15.0-test.17 is on npm, which is correct and was re-checked against the live registry).

One thing would have blocked the documented publish: the create-elata-demo publish check could never pass
on Windows (fixed, below).

## What ran, and the result (audit of ba382d9 unless marked "final")

rppg-web
- `pnpm run build`: exit 0, and the rebuilt dist is byte-identical to the committed one (`git status` clean).
- jest, whole suite: 79 suites, 722 tests pass (ba382d9); 722 pass on the final tip too.
- tsc: src clean; tests clean when actually included (tsconfig.test.json inherits the `__tests__` exclude, so
  it checks no test file; a temporary config that includes all 80 test files: 0 errors, strict). biome lint clean.
- `scripts/check-test-release.mjs`: ready (162 files). Also ready on a CRLF checkout (`core.autocrlf=true`),
  which is what a default Git for Windows clone gives.
- `scripts/verify-test-release.mjs` (packs, installs under both names, WASM switch, known answers 60/72/120,
  pulse check scenes, chest motion, steady analysis), final tip: passes; with BREAK=1: fails, as it should.
- npm pack: 162 files, 275,130 B packed, 971,197 unpacked (final: 275,450 / 972,265). Same 162 paths as
  test.16. Versus test.16 the WASM is unchanged; 21 files differ (README, llms.txt, package.json, the test.17
  dist modules). LICENSE byte-identical to the repo root (MIT, Copyright (c) 2024 Elata). No src, tests or
  stray files. Scan of every file plus WASM strings: no dataset names, no person IDs, no emails, no local paths
  in text; the WASM still carries one `the Rust toolchain folder/registry/...` string (as test.16; 0.14.0 carries a
  `/Users/...` one). `PREFIX_PROXY_INPUT_V1_PROFILE` / `prefix-proxy-input-v1` are Elata's own identifiers.
- publint --strict: All good (both tarballs, final). attw: same single warning as published 0.14.0
  (CJSResolvesToESM, exit 1 for both); `--profile esm-only` incl. `./pkg/rppg_wasm.js`: exit 0.
- npm audit --omit=dev in a clean consumer: 0 vulnerabilities; no dependencies, no install scripts.
- Node consumer smoke from the tarball (alias install): imports, 125 exports, RPPG_WEB_BUILD_VERSION
  0.15.0-test.17, WASM backend loads in Node, `resetSignal()` empties the window (bpm null, 0 samples),
  safe after dispose.
- README: all 19 TypeScript blocks compile against the shipped types (strict, skipLibCheck false, lib
  ESNext+DOM), with only the app's own variables declared; the harness goes red on a wrong call. Option A
  and Option B Vite configs build with Vite 7.1.12 from the tarball (worker and WASM emitted). The README
  claim "with every fix and the check off, the rate matched 0.14.0 second by second" holds: 80 of 80 seconds
  identical (final tarball). The claim "with pulseCheck false and no WASM, the JavaScript estimators still
  give a rate" holds: 67 for a true 66 (0.14.0 gives sporadic 52 to 56 there).

Known answers for the test.17 changes (repo-external harness, real WASM in Node, the build's own DemoRunner,
RppgSession and processorWorker.js):
- 66 bpm face, 10 s without a face, face back: test.16 read 51 to 53 for the 25 s after; test.17 reads
  66 to 68. Pulse check on: 66 from 18 s, and 66 again 18 s after the face returns.
- Engine that throws on its 120th push: main thread and (now) worker both stop the runner and report
  `processor_error` to runner and session; test.16's worker kept running with no error event.
- App monitor in real Chromium: 0.14.0 throws "Illegal invocation" at start(); test.17 ticks 8 times in
  400 ms at 50 ms and stops cleanly.

create-elata-demo
- `scripts/check-test-release.mjs`: ready (5 templates). `--publish` against the live registry: refuses only
  because rppg-web 0.15.0-test.17 is not on npm yet (correct).
- node:test suite, whole: 28 of 28 pass at ba382d9, incl. the npm and pnpm (10.33.2) smoke on all five
  templates against the locally packed rppg-web; 29 of 29 on the final tip (one new test).
- Scaffold from the PACKED tarball, no monorepo siblings, literal user commands
  (`npx @amelhede/create-elata-demo@test <app> --template <t>`, then install and build) against a GET-only
  stub that serves only the @amelhede scope from the two final tarballs; everything else from npmjs.org:

```
             rppg-demo eeg-demo eeg-ble ppg-demo pulse-game   (generate / install / build)
npm 10.9.7     0/0/0    0/0/0   0/0/0   0/0/0    0/0/0     npm audit: 0 vulnerabilities in all five
pnpm 12.11.2   0/0/0    0/0/0   0/0/0   0/0/0    0/0/0
pnpm 9.15.9    0/0/0    0/0/0   0/0/0   0/0/0    0/0/0
```
  rppg-web installed in rppg-demo, ppg-demo and pulse-game is the final test.17 (source stamp 9af0492e).
  npm installs print no warnings. pnpm prints only the known peer warnings of ppg-web 0.12.0 as published
  (eeg-web ^0.2.1, rppg-web ^0.3.0); no build-script warnings on pnpm 12.
- The packed create-elata-demo tarball is byte-identical before and after my commits
  (sha256 5ed6139b...), since only its unshipped scripts and tests changed.
- CRLF checkout (Windows default): both checks ready; the CRLF-packed generator runs via npx, pnpm 10 dlx and
  pnpm 9 dlx on Linux (its `#!/usr/bin/env node\r` shebang is handled by all three).

## What I fixed (new commits on release/test-1, on top of ba382d9)

1. `b150807 fix(rppg-web): worker trace reports the duration of the points it returns`.
   With the analysis worker (default), `getTraceSnapshot(n)` for n under 300 kept the 300-point trace's
   `durationSec` / `windowDurationMs`: 100 points said 9.97 s instead of 3.30 s, and the app adapter's
   default 120-point trace said about 10 s for 4. Test first: the worker equivalence test now also compares a
   120-point trace (red: durationSec 4 against 3.97; green after). README's analysisWorker row and the
   defaults changeset now say the worker trace holds at most 300 points (an app-visible change from 0.14.0
   no changeset mentioned).
2. `43248cc fix(rppg-web): release check prints its success line on stderr`. prepack's "ready" line went to
   stdout, so `npm pack --json` output did not parse (JSON.parse error, reproduced). Test first (red, then
   green); final `npm pack --json` parses.
3. `0529f3d fix(create-elata-demo): publish check runs npm through npm_execpath`. The `--publish` check
   (prepublishOnly) called `spawnSync("npm")`. On Windows npm is npm.cmd, which Node starts only through a
   shell (Node docs, "Spawning .bat and .cmd files on Windows"), so every version read "not on npm" and the
   PowerShell publish in PUBLISHING.md would always be refused. Now it runs npm's own CLI script
   (`npm_execpath`, which npm 10 and 11 set to `.../npm/bin/npm-cli.js` for lifecycle scripts, checked) with
   this Node, and cmd.exe when run by hand on Windows. Test first: the check run with no npm on PATH and a
   stand-in CLI (red: all five versions "not on npm", even the four that are on npm; green after). End to end
   with real npm 11 `publish --dry-run`, no npm on PATH, stub registry holding all five versions: refused
   before, ready and published (dry) after; still refuses the `latest` tag.
4. `cbcabcd docs(rppg-web): experimentalVitals row and defaults changeset match the build`. The README still
   said HRV waits while the engine keeps the previous face's samples for up to 45 s (removed in test.17).
   The defaults changeset now also lists the `FACE_ROI_FRACTIONS` type change (from Elata's unreleased ROI
   profiles), which breaks 0.14.0-era TypeScript reading a region (tsc TS2488, checked against both builds).
5. `f01f828 docs(rppg-web): say the pulse check holds back only bpm`. With the check on, `getMetrics()`
   withholds `bpm` but passes the engine's `*_bpm` estimates and `confidence` through, while the README said a
   heart rate is reported only once proven. On a generated face with no pulse: `bpm` empty for 35 s while
   `fused_bpm` read 43 to 123 at confidence up to 0.69. README row and session comment now say so. No
   behaviour change.

Version stays 0.15.0-test.17: it is not on npm, nothing was measured against it (its changeset says test.16
results hold), and no reported number changed (the 66 bpm gap run gives the identical digest before and after).

## Left, and why

- The pulse check passes `*_bpm` and `confidence` through while `bpm` is withheld (now documented). Whether
  the session should clear them too (as the no-face path does) is a product decision, not a bug fix: apps that
  follow the docs read `bpm`, and `createRppgAppAdapter().canPublish` stays false while unproven.
- Raw `RppgProcessor` without the runner (one colour signal through `pushSampleRgb`), synthetic 72 bpm:
  0.14.0 reads 105 to 115, test.16 and test.17 read 126 to 136 (60 bpm: 0.14.0 54 to 110, test.17 54 to 65).
  Wrong in both; unchanged since test.16; `createRppgSession` (multi-region) reads right. Needs its own
  investigation on that path; not a publish blocker for this build.
- `amelhede-rppg-web-0.15.0-test.17.tgz` (Oct 10 16:27) is stale: its README differs from
  ba382d9 and its worker trace and docs from the final tip. Do not test or log results against it; repack.
- `the fork checkout` is a worktree of `the upstream-tracking checkout` with release/test-1 checked out at ba382d9.
  Git refuses to move a checked-out branch from outside (`refusing to fetch into branch ... checked out`), and
  I did not touch that working tree, so the local release/test-1 ref is still ba382d9 while origin is at
  f01f828 (now in that repo's FETCH_HEAD; `git -C the fork checkout merge --ff-only FETCH_HEAD`
  brings it level, which updates that working tree).
- The worker trace fix applies to `feat/pulse-check-on-main` and the other sdk-up branches that carry
  `workerRppgProcessor.ts`; not ported (not in this task's scope).
- Unchanged from the test.16 audit and not test.17 changes: attw's CJS-only warning (same as 0.14.0),
  `devDependencies "@elata-biosciences/ppg-web": "workspace:*"` kept literally by npm publish (consumers do
  not install devDependencies; npm, pnpm and yarn installs work), the WASM's one `the Rust toolchain folder` path string,
  `npm publish` without `--tag` failing safe with "tag is 'latest'".
- Not run: Windows itself (simulated: CRLF checkout, and no npm on PATH for the spawn), a real face or a
  camera, a managed-session restart after a worker engine error (the error events that trigger it were
  checked), pnpm 10 below 10.31.

## Housekeeping

Deleted scratch/t17-clone, t17-crlf, t17-fix, t17-tmp, t17-work and my scratch/pnpm-cache; removed the two
pnpm dlx folders this audit had made under the user cache/pnpm/dlx. Kept the shared caches (scratch/npm-cache,
scratch/pnpm-store) and scratch/.pnpm-store, the store pnpm falls back to when it cannot hard-link from the
main disk (a cache). Main disk free: 2.5 GB, as at the start. The harness scripts (raw-processor probe,
scope-only stub registry, matrix runner, Chromium monitor probe, compat file) are in publishaudit/bin17; the
test.16 harness in publishaudit/bin was reused unchanged.
