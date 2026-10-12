# test18-audit: publish readiness of @amelhede/rppg-web 0.15.0-test.18 and @amelhede/create-elata-demo 0.12.2-test.2

Date 2026-10-11. Branch release/test-1, candidate e96816a..6349a5e (twelve local commits by a colleague),
audited at 6349a5e. One docs commit added on top (8d2c928), pushed fast-forward e96816a..8d2c928 after both
release checks printed ready; `git ls-remote` shows 8d2c928. Nothing published, no PR, nothing sent to Elata.
Work clones under scratch/ (t18-clone audit copy, t18-rev revert experiments and the fix, t18-crlf Windows line
endings), all deleted at the end. Node 22.22.2, npm 10.9.7 and 11.21.0, pnpm 9.15.9, 10.33.2 and 12.11.2
(npm `latest` today), tsc 5.9.3, publint 0.3.25, attw 0.18.5, Vite 7.1.12.

## Verdict

Ready to publish: yes, both. Order as PUBLISHING.md says: rppg-web first, then create-elata-demo (its
`--publish` check refuses today only because rppg-web 0.15.0-test.18 is not on npm, checked live).

The ported code is correct and every ported change is proven by a test that goes red when that change alone is
reverted. Against test.17, only the fields the four changes are meant to touch move. One wording fix (the test.18
changeset said results measured on test.17 hold without exception; they do not after a NaN frame timestamp).

Tarball for the Peak swap test: amelhede-rppg-web-0.15.0-test.18.tgz, packed from 8d2c928,
sha256 b746f0c1ec1623e0d6667028e9b4f6d5712d7e7e1dd5045d6c938da202692d76, byte-identical to the tarball every gate below ran on.

## The four ports, read against the reviewed fix-branch commits

1. Fusion grid NaN rule (c80ce57, guards 9f481ed) -> dee642c. Code identical in meaning to c80ce57. The NaN test
   is c80ce57's. The 9f481ed guards: restart and stop/start are 9f481ed's tests; the framesWithFusion guard is
   rewritten as its own test, since test-1 lacks the fallback-chain describe it sat in (9cb925b, not ported).
   Nothing dropped.
2. No-face reading shape (3ffa8e6, 7f3a8c2, 0af0102, 7053302) -> da8e441, 1dabaa5, 345ac3a, 9c83b8e, 43c9a89.
   `withoutReading()` is 3ffa8e6's, word for word. Differences: test-1 clears through one function for both
   no_face and processor_failed, so a failed engine now gets the same shape (deliberate, in the changeset, and
   tested); the requireFace wiring and the roiSource-null line from 3353da8 were missing on test-1 and are now
   in, each with a test. 0af0102's tests are byte-identical. 7053302's docs are adapted to test-1's switch table.
   Not ported, correctly: 7053302's removal of a measurement from FACE_GONE_RESET_MS's comment (test-1's comment
   carries none).
3. WASM load errors per URL (2821356) -> ea36238. Loader change identical. The session reads the error by shape,
   not instanceof (test-1's design). One deviation: `formatErrorDetail` now leaves out a cause whose message the
   error's own message already contains, for every error, not only WASM. It can drop no text by construction
   (the dropped string is inside the message). Docs updated; no stale wording left.
4. create-elata-demo stray files (1da927f, 36caa88, b3e6d6f) -> c9b8a42, 34373b3, 54da86c, bae2a4a. The
   directories-only rule is applied to test-1's check-test-release.mjs (test-1 has no verify-packed-cli.mjs).
   New beyond the review: templates/.npmignore, since npm packs Thumbs.db and desktop.ini (checked). The
   b3e6d6f sentence describes Elata's preflight, which test-1 lacks; a matching sentence went into PUBLISHING.md.

Revert proofs (each change removed alone from the final tip, its tests run; all went red as they should):

```
grid: old bridge condition                 RED  NaN test
grid: no restart on a non-increasing time  RED  clock-restart test
grid: stop() keeps gridPrev                RED  stop/start test
grid: framesWithFusion counts fuser output RED  framesWithFusion test
shape: old clearedMetrics                  RED  sessionNoFace + failedSession (2)
shape: baseline_bpm not kept               RED  same 2
shape: no reason de-duplication            RED  rppgSession backend_failed test
requireFace wiring removed                 RED  "honours a caller's requireFace"
roiSource null line removed                RED  "does not report a face ROI once the face has left"
restart: fuser reset / processor restart   RED  multi-region gap test / both gap tests
resetSignal: window, free, tracker, guard  RED  each of the 4 processor tests
loader: errors not passed / no-pipeline    RED  5 / 1 tests
session: describeWasmLoadFailure removed   RED  2 tests
normaliser: old cause rule                 RED  "said once"
check: every entry taken as a template     RED  stray-file test
templates/.npmignore deleted               RED  npm pack test
prepack without check / no --publish /
verify:publish without rppg-demo           RED  publish-lines test, each
```

## Behaviour against test.17 (same harness as the test.17 audit: the build's own DemoRunner, RppgProcessor and RppgSession, real WASM in Node, synthetic chromatic face)

Five scenarios (66 bpm with a 10 s face gap, steady 72, a face with no pulse, the same with a gap, steady 72
with one NaN frame timestamp at 10 s) in five modes (published options, fixes off, defaults, defaults plus pulse
check, fixes off plus pulse check), plus no fusion and no WASM. Every field of every per-second read compared:

- `bpm` identical in all 80 seconds of every run, except the NaN-timestamp runs with the fixes on.
- Fixes off, steady, no pulse: identical outputs, identical digests.
- Face gap, defaults: only the no-reading fields move, in seconds 46 to 54 (signal_quality, agreement, snr,
  winning_sources, alias_flag, the means, resolved and bayes confidence, bayes_ambiguity, fused_source,
  baseline_delta, baseline_bpm now kept) and roiSource in seconds 45 to 54. Nothing else.
- NaN timestamp, defaults: test.17's engine received 0 samples after the frame (300 at 10 s, still 300 at 79 s)
  and froze its estimates; with the true rate falling from 72 to 56 at 30 s, test.17 kept 72 and test.18
  followed to 56. With the pulse check on, its `bpm` followed in both.

No other difference.

## Gates (6349a5e; the final tip differs only by one changeset)

rppg-web: build reproduces the committed dist byte for byte; jest whole suite on one worker 80 suites, 741 tests
pass; tsc src 0 errors, all 80 test files under a strict temporary config 0 errors (seen red on an injected
error); `pnpm run lint` clean; release check ready (162 files), also on a CRLF checkout; verify-test-release
passes (known answers 60/72/120, switch off reads 120 as 73.8) and fails with BREAK=1; npm pack 162 files, the
same paths as test.17, WASM unchanged, 18 files differ (README, llms.txt, package.json, 15 dist files); `npm
pack --json` parses; npm 11 `publish --dry-run --tag test` ready, without the tag refused; publint --strict
All good; attw the same single CJS warning as 0.14.0 and test.17, esm-only profile exit 0; consumer install 0
vulnerabilities, no dependencies, no install scripts; Node smoke from the tarball (alias install: 125 exports,
version test.18, WASM loads, resetSignal empties the window, safe after dispose, `errors` per URL in order,
withoutReading not exported); all 19 README TypeScript blocks compile (harness seen red); Option A and B Vite
builds emit the worker and WASM; scans: no dataset names, IDs, emails or local paths beyond test.17's one WASM
string; repo `audit-repo.mjs` passes.

create-elata-demo: release check ready (5 templates), also on CRLF; `--publish` refuses only for rppg-web
test.18 missing on npm; node:test suite 32 of 32 (incl. npm and pnpm 10.33.2 smoke on all five templates);
packed tarball 72 files, same as test.1, only package.json differs; publint All good; npm 10, npm 11, pnpm 9 and
pnpm 10 pack none of Thumbs.db, desktop.ini, .DS_Store or the ignore file, LF and CRLF.

Scaffold from the PACKED tarballs (test.18 is not on npm, so as in the test.17 audit a GET-only stub serves only
the @amelhede scope from the two tarballs, everything else from npmjs.org), literal commands
`npx @amelhede/create-elata-demo@test <t> --template <t>`, install, build:

```
             rppg-demo eeg-demo eeg-ble ppg-demo pulse-game   (generate/install/build)
npm 10.9.7     0/0/0    0/0/0   0/0/0   0/0/0    0/0/0     npm audit: 0 vulnerabilities in all five
pnpm 12.11.2   0/0/0    0/0/0   0/0/0   0/0/0    0/0/0
pnpm 9.15.9    0/0/0    0/0/0   0/0/0   0/0/0    0/0/0
```
rppg-web installed is test.18 (source stamp matches). pnpm prints only the known peer warnings of the published
ppg-web and eeg-web-ble 0.12.0.

## What I changed

`8d2c928 docs(rppg-web): the test.18 changeset names the one case where test.17 results do not hold`. The
changeset said none of the changes alters how a rate is computed, so test.17 results hold. True for frames with
a valid timestamp; after a NaN timestamp test.17 froze the engine's estimates (measured above). Docs only, no
package file changed (the tarball is byte-identical).

## Left, and why

- Not in test.18, needs a real-people evaluation first: fix 2's Rust per-window bypass
  (fix/rust-colour-projection-sign f7abd08), which changes the engine's own numbers.
- Worker trace fix b150807 (on test-1) still to port to the sdk-up branches that carry workerRppgProcessor.ts:
  feat/pulse-check-on-main, feat/pulse-check-wall, feat/small-finder-input (no fix/* branch has the file).
  Not done here.
- Pre-existing since test.17, not a test.18 change (fix/real-frame-rate 9cb925b, not ported): with the default
  `realFrameRate`, an app's own processor that has neither pushFusedSample nor pushSampleRgbMeta gets no samples
  on the multi-region path, silently (pushSampleRgb only: 0 of 60 calls, samplesPushed 60, no error; fixes off:
  60 of 60). The SDK's own processors are not affected. Also framesWithFusion counts grid samples, so it can
  exceed framesWithMultiRoi on a slow camera.
- The "same reason code is not added twice" half of the de-duplication has no test (as on test.17).
- `RppgWasmLoadError` is not exported from the package root (as on Elata main and the fix branch): the docs name
  it, apps read `errors` from the caught error or `session.lastError.cause`.
- Nit in the shipped requireFace comment: "Otherwise" now follows the createRppgSession sentence and reads as if
  it meant "unless the caller sets it". Left, to keep the audited tarball.
- Unchanged from earlier audits: attw CJS warning, `devDependencies` workspace:* kept literally, the WASM's one
  `the Rust toolchain folder` path string, biome format debt and one lint finding in create-elata-demo index.mjs (both at
  test.17 too).
- Not run: Windows itself (simulated with a CRLF checkout), a real camera or face, the Peak swap test (next,
  with the tarball above).

## Housekeeping

Deleted scratch/t18-clone, t18-rev, t18-crlf, t18-work and t18-msgs.txt; the stub registry was stopped by PID.
Kept the shared caches (scratch/npm-cache, scratch/pnpm-store, scratch/.pnpm-store). Harness scripts are in
publishaudit/bin18 (revert runners, drive3 with NaN and rate-switch options, per-second compare, README block
compiler, Node smoke, custom-processor probe, matrix runner); the test.16 shim in publishaudit/bin was reused.
