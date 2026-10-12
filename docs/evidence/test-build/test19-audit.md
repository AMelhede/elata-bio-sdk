# test19-audit: publish readiness of @amelhede/rppg-web 0.15.0-test.19 and @amelhede/create-elata-demo 0.12.2-test.3

Date 2026-10-12. Branch release/test-1, candidate 8d2c928..788779b (seven local commits by a colleague), audited
at 788779b. Four commits added on top (c36bb1e, 5fe6ba8, 866c408, c85bc9b). Pushed fast-forward 8d2c928..c85bc9b after both release checks printed ready; `git ls-remote` shows c85bc9b.
Nothing published, no PR, nothing sent to Elata. Work under scratch/t19 (fresh clone and fresh pnpm install of
the candidate, a revert copy, a fix copy, a fresh clone of the final tip, a CRLF clone), deleted at the end.
Node 22.22.2, npm 10.9.7 and 11.21.0, pnpm 9.15.9, 10.33.2 and 12.11.2, tsc 5.9.3, publint 0.3.25, attw 0.18.5,
Vite 7.1.12, create-vite 9.2.1 (Vite 8, TypeScript 6). Harness: publishaudit/bin19 (bin18 plus FPS, a no-region
spell, end-of-run runner diagnostics, a raw-processor probe and the revert battery); outputs in
publishaudit/test19-out.

## Verdict

Ready to publish: yes, both, from the final tip. Order as before: rppg-web first, then create-elata-demo (its
`--publish` check refuses today only because rppg-web 0.15.0-test.19 is not on npm).

The colleague's code is right: each port is the source commit's change (the rgbPulse, release-check and README
commits are byte for byte their night/* sources apart from line offsets and one added changeset sentence), and at
the defaults no session or runner number moves against test.18. What I found was in the docs and tests, not the
code: a README figure that its own test contradicts, a measured condition the rgbPulse row left out, four rgbPulse
lines that no test covered, and a test file that fails on a Windows checkout. All fixed, test first.

Tarball: amelhede-rppg-web-0.15.0-test.19.tgz, sha256 75b6ce0631f5a3e78e87271f17f8e2cee3ff056213066a65b227add96999ed2b
packed from the pushed tip, byte-identical to the tarball every gate below ran on
(replaces the colleague's 6072e56b...). It differs from 788779b's tarball only in README.md and
dist/source-stamp.json: every dist JavaScript and type file and the WASM are byte-identical, so every behaviour
result below holds for it. create-elata-demo: amelhede-create-elata-demo-0.12.2-test.3.tgz, sha256 de8c51ba...,
byte-identical to the colleague's (no create-elata-demo file changed).

## The changes, read against their sources, each proven red when taken out alone

1. Fusion grid fallback chain and frame counts (9cb925b) -> 8580dcf, dist 0cdc65a. Code identical in meaning to
   9cb925b, adapted to test-1's realFrameRate switch. Reverts on 788779b, each alone, grid tests:
   ```
   grid ticks without the fallback chain (rgb_meta only)  RED  pushSampleRgb only, pushSample only, no push method
   framesWithFusion counted per grid sample               RED  frame counts at 15 and 60 fps
   framesWithFusion counted without the fused check       RED  3 tests
   intensity not interpolated on the grid                 RED  pushSample only
   ```
2. rgbPulse (night/processor-local f2eda6f, 3370deb) -> 20b7d2e, 762764a. Reverts, rgbPulse tests:
   ```
   switch branch removed                RED 9    grey passthrough removed      RED 1
   default on                           RED 3    raw green in the warm-up      RED 12
   no reset in resetSignal              RED 1    median interval for the rate  RED 1
   no stall rule                        RED 1    no band-pass                  RED 1
   CHROM in place of POS                RED 8    redesign on any rate change   RED 2
   README example default true          RED 1
   no reset in resetCalibration         green    (now RED, 866c408)
   band-pass always designed for 30     green    (now RED, 866c408)
   never redesigned after the first     green    (now RED, 866c408)
   getBuildSwitches ignores processor   green    (now RED, 866c408)
   ```
3. README quick start (febdb33) -> f5dd899: old block RED. Checked end to end too: the quick start pasted into a
   fresh `npm create vite@9.2.1 -- --template vanilla-ts` app builds with test.19's README; test.18's fails at
   TS6133 'interval'.
4. README low band (2ec1c80) -> ea8bae7: line removed RED. The rule matches the code (pulseCheckCore `counts` and
   `countsInDark`: below 58 every region). Re-run in Node: a true 50 with no pulse on the forehead showed nothing in
   120 s; with it, 48.5 to 50.0 from 22 s; a true 70 showed from 18 s either way.

## Behaviour against test.18 (packed test.18 and packed 788779b, real WASM in Node, synthetic chromatic face)

48 pairs: gap 66, steady 72, no pulse, no pulse with a gap, NaN timestamp, each with the published options, fixes
off, defaults, defaults plus pulse check, fixes off plus pulse check; a 10 s spell where the fuser has no region
(new: 72 at 30 fps, 50 at 15 fps); 15, 20, 24 and 60 fps; no fusion; no engine. Every field of every per-second
read and the digest of every read are identical in all 48. The one difference: runner `framesWithFusion` off 30
fps (15 fps 2096 -> 1050, 20 fps 2399 -> 1600, 24 fps 2399 -> 1920, 60 fps 2400 -> 4800), as the colleague named.

rgbPulse on (off by default) against test.19 at the defaults: only runs where the processor's colour path is fed
move (no fusion, and the no-region spell); runs where the fuser always has a region are identical.

## What the measurements say that the docs did not

- The rgbPulse row's 50/72/120 are reads once a second. Read only once after 30 s, with no rate history, a 120
  gave bpm 95.7 (calibrated 95.7, acf 60, resolved 120), 110 gave 88, 140 gave 114, with the packed WASM. Now in
  the README row and changeset, pinned by a test (5fe6ba8).
- The realFrameRate row said the 15 fps pulse keeps 0.50 of its fused strength with the switch off; the grid
  test behind it computes 0.4911. Now 0.49, and the test checks the row carries its four figures (c85bc9b).
- readmeExamples.test.ts fails on a CRLF checkout (Git for Windows default, no .gitattributes): 4 of 775 tests on
  788779b (2 since test.15, 2 new in test.19), every other suite green. Fixed and guarded (c36bb1e); 781 of 781
  pass on a CRLF clone of the final tip.
- An independent raw-processor generator (8-30 fps, jittered clock, real WASM, read once a second): rgbPulse on
  read 50/72/120 within 5 in 24 of 24 scored seconds in every cell, down to 8 fps (where its low-pass sits at
  Nyquist and still behaves); off read 0 to 23 of 24 (often wrong at confidence 0.7 or more). No pulse at confidence
  0.7 or more: on 0 seconds in every cell, off up to 24 of 24. Leads for the owner's default decision, not a
  change here.
- Session lead, synthetic only: with the pulse check off, a 10 s spell with no fusion region left the default
  session reading 86 for a true 72 for about 40 s afterwards (15 fps: 57 to 64 for a true 50); with rgbPulse on it
  stayed at 72 (50). With the pulse check on, the shown rate was right either way. Same in test.18 and in the
  published path (fixes off), so not a test.19 change.

## Gates on the final tip c85bc9b

rppg-web: fresh clone and frozen install, build reproduces the committed dist byte for byte; jest on one worker 81
suites, 781 tests pass (788779b: 81, 775); the same on a CRLF clone; tsc src 0 errors, all 81 test files under a
strict temporary config 0 errors (seen red on an injected error); biome lint clean; both release checks ready on
LF and CRLF; verify-test-release passes (60/72/120 right with rgbPulse on too, core switch off reads 120 as 73.8)
and each of BREAK=1..4 fails; npm pack 162 files, the same paths as test.18, WASM unchanged; npm 11 publish
--dry-run --tag test ready, without the tag refused; publint --strict All good; attw the same single CJS warning
as test.18, esm-only exit 0; consumer install 0 vulnerabilities, no dependencies, no install scripts; Node smoke
from the tarball (alias install, 127 exports, the two new ones RgbPulseExtractor and FIX_SWITCHES_OFF_BY_DEFAULT,
WASM loads, resetSignal empties the window, safe after dispose, errors per URL); all 19 README TypeScript blocks
compile (harness red when broken); Option A and B Vite builds emit the worker and the WASM.

create-elata-demo: release check ready (5 templates) on LF and CRLF; `--publish` refuses only for rppg-web
test.19 missing on npm; node:test 32 of 32 (incl. npm and pnpm 10.33.2 smoke on all five templates); npm 10,
npm 11, pnpm 10 and pnpm 9 pack none of Thumbs.db, desktop.ini, .DS_Store or the ignore file, LF and CRLF.

Scaffold from the PACKED final tarballs (GET-only stub serving only the @amelhede scope, everything else from
npmjs.org), literal `npx @amelhede/create-elata-demo@test <t> --template <t>`, install, build:

```
             rppg-demo eeg-demo eeg-ble ppg-demo pulse-game   (generate/install/build)
npm 10.9.7     0/0/0    0/0/0   0/0/0   0/0/0    0/0/0     npm audit: 0 vulnerabilities in all five
pnpm 12.11.2   0/0/0    0/0/0   0/0/0   0/0/0    0/0/0
pnpm 9.15.9    0/0/0    0/0/0   0/0/0   0/0/0    0/0/0
```
The rppg-web installed is the final test.19 (source stamp matches). pnpm prints only the known peer warnings of
the published ppg-web and eeg-web-ble 0.12.0.

## Format note

New code adds a little biome format debt (fixSwitches.ts was clean and now has 2 spots; rppgSignalModel.ts and
rppgProcessor.ts gain one each); the files already carried such debt and `pnpm run lint` (biome lint) is clean.
Left, to keep dist JavaScript identical to the audited 788779b.

## Left, and why

- rgbPulse default: off, as the investigator recommends; the numbers above are for the owner's decision.
- The single-read blend is an estimator-fusion weakness (autocorrelation halves rates of 110 and over, the
  untrained calibration blends); documented, not fixed: it changes how a rate is computed and needs its own
  known-answer work.
- Commit messages already written and not editable: 8580dcf says 0.50 (the code gives 0.49); 762764a says the
  published colour path hid the single-read weakness behind the engine's rate, but with an engine that reports the
  true rate, read once, the published path gave 111 for 110, 120 and 140 (its own estimators read 42 and 180).
- The rgb-pulse changeset quotes numbers from 50 of the owner's own recorded captures (Peak's recordings, no
  third-party dataset); no names or IDs. Left as written.
- Unchanged from earlier audits: attw CJS warning, the WASM's one `the Rust toolchain folder` path string, RppgWasmLoadError not
  exported from the root, no real camera or Windows machine used (CRLF clone instead), no Peak swap test of
  test.19 yet.

## Housekeeping

Deleted scratch/t19 (clones, revert and fix copies, CRLF clone, consumer and Vite apps, scaffold matrix, its own
npm cache); the stub registry was stopped by PID. Kept the shared caches (scratch/npm-cache, scratch/pnpm-store,
scratch/.pnpm-store, scratch/xdg-cache). The colleague's test.19 tarball in sdk-pack was replaced by the final one.
