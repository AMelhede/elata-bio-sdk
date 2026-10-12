# behaviour-diff: what an app sees swapping published rppg-web 0.14.0 for 0.15.0-test.16

Work folder: scratch/behaviour-diff (deleted at the end). Repos only read (git show/diff/log).
Published tarball: `npm pack @elata-biosciences/rppg-web@0.14.0`. Test tarball: amelhede-rppg-web-0.15.0-test.16.tgz.

## 1. What the suggested diff misses
```
$ git -C the fork checkout log --oneline --all -S'"version": "0.14.0"' -- packages/rppg-web/package.json
0d6464a chore(release latest): ... @elata-biosciences/rppg-web@0.14.0 ...
$ git log --oneline 49fdb41 -8 -- packages/rppg-web
123e93b fix(rppg): harden waveform lifecycle and parity
3560030 feat(rppg): add morphology and physiology features
b3650d6 feat(rppg): add waveform reconstruction host
328b33b feat(rppg): harden Bayesian tracker extensions
bf1d588 feat(rppg): add versioned ROI profiles
0d6464a chore(release latest): ... rppg-web@0.14.0 ...
$ git diff --stat 0d6464a..49fdb41 -- packages/rppg-web | tail -1
 32 files changed, 3185 insertions(+), 174 deletions(-)
$ git diff --stat 49fdb41..release/test-1 -- crates | cat
 crates/elata-rppg-wasm/src/lib.rs |  13 ++
 crates/elata-rppg/src/dsp.rs      | 333 ++++++++++++++++++++++++++++++++++----
 crates/elata-rppg/src/pipeline.rs | 186 ++++++++++++++++++++-
```
Published dist has no roiProfile/roiPixelSampler/waveform*/physiologyFeatures modules; test dist does (upstream, unreleased).
`diff <(find pub) <(find test)`: files only ADDED, none removed. `exports` map identical.

## 2. Public API (dist/index.d.ts diff)
Removed/renamed exports: none. Added: fork (PulseCheck + head*/chest*/fix switches, RPPG_WEB_BUILD_VERSION,
createWorkerRppgProcessor/WorkerRppgProcessor, PosPulseModel, FusionProjection, ExperimentalVitals) and upstream-unreleased
(roiProfile, roiPixelSampler, waveform*, physiology*, DEFAULT_BPM_TRACKER_CONFIG_V1, parseBpmTrackerConfigV1, BpmTrackerConfigV1...).
Changed types: `RppgSession.processor: RppgProcessor -> RppgProcessorLike`; `DemoRunnerDropReason` += "no_face";
`FACE_ROI_FRACTIONS` -> Readonly<Partial<Record<..., readonly tuple>>> (upstream bf1d588); `RppgSessionDiagnostics.faceGone` (required);
`DemoRunnerDiagnostics.roiGeometryProfileId/roiPixelSamplerId` (required, upstream); `FaceLandmarkerLike.detectForVideo(HTMLVideoElement|HTMLCanvasElement)`.

## 3. Compile check: code written against 0.14.0 (tsc 5.9.3 --strict)
```
=== tsc-pub   exit 0
=== tsc-test
compat/app014.ts(10,9): error TS2740: Type 'RppgProcessorLike' is missing the following properties from type 'RppgProcessor': backend, pipeline, samples, bpmHistory, and 30 more.
compat/app014.ts(22,22): error TS2322: Type '"no_face"' is not assignable to type 'never'.
compat/app014.ts(26,36): error TS18048: 'FACE_ROI_FRACTIONS.forehead' is possibly 'undefined'.
compat/app014.ts(27,14): error TS2322: Type 'Readonly<Partial<Record<FaceRoiName, FaceRoiFraction>>>' is not assignable to type 'Record<FaceRoiName, [number, number, number, number]>'.
compat/app014.ts(28,29): error TS2540: Cannot assign to '1' because it is a read-only property.
exit 2
```
(a custom FaceLandmarkerLike whose detectForVideo takes HTMLVideoElement still compiles: method bivariance; at runtime it now receives a canvas, mediaPipeFaceFrameSource.js:119.)

## 4. README examples (17 ts blocks; vite.config block skipped) against test.16 types
```
lib ES2022+DOM, skipLibCheck false: pkg/rppg_wasm.d.ts(6,13): error TS2550: Property 'dispose' does not exist on type 'SymbolConstructor'  (same in 0.14.0; wasm-bindgen output)
lib ESNext: tsc exit 0
```
Same blocks against 0.14.0: `fixes`, `getBuildSwitches` (fork) AND `roiGeometryProfile`, `bpmTrackerConfig`, `PREFIX_PROXY_INPUT_V1_PROFILE`,
`TRADELOCK_RGB_WEIGHTED_V1_PIXEL_SAMPLER` (upstream-unreleased, in the README section that says "upstream documentation, unchanged in substance") do not exist.

## 5. Runtime, synthetic known answer (bin/drive.mjs; build's own DemoRunner -> RppgProcessor -> RppgSession, real WASM in Node)
Input: 3 face regions, chromatic pulse 66 bpm, 1% green; 0-45 s face, 45-55 s no face (centre = plain wall), 55-80 s face. getMetrics every 8th frame.
```
pub published   firstBpm=1.33
  bpm 0-45 : - - 75 84 84 83 83 83 83 83 83 52 52 79 52 80 80 79 77 75 73 72 53 53 53 72 72 54 55 72 73 ...
  bpm 45-55: 72 51 103 66 70 72 72 72 75 76   (no face)
off 0.15.0-test.16 (fixes:false)  -> per-second bpm identical to pub
on 0.15.0-test.16 (defaults, pulseCheck off) firstBpm=0.8
  bpm 0-45 : - 91 91 67 67 68 67 67 67 ...
  bpm 45-55: 68 - - - - - - - - -
  bpm 55-80: 52 53 53 52 52 52 52 ... 52 51 51
oncheck 0.15.0-test.16 (defaults + PulseCheck) firstBpm=18.13
  bpm 0-45 : (18 s of -) 66 65 66 66 ...
  bpm 55-80: (18 s of -) 66 66 66 66 66 66 66
```
Field diff pub vs off (per second, 80 s): only bayes_ambiguity/bayes_tracker_config_id/bayes_quality_provider_id (new keys, upstream)
and hrv_rmssd max |d| 2.7e-11, respiration_rate 8.0e-14, respiration_confidence 7.6e-14.
Fusion-off path (WASM projection), FUSION=0: off vs pub differs only in the 3 bayes keys; colourProjectionFix alone on differs in 18 fields (check goes red).
Post-gap scaled rate isolated: on with each switch off -> only noFaceNoReading:false removes it (61-70 instead of 52).
Long run (DUR=130): `55:52 56:53 ... 90:51 91:66 92:67 ...` = 36 s at 51-53 (true 66), confidence 0.86-0.89, all estimators agree:
`57 bpm=53 spectral_bpm=51 acf_bpm=52 peaks_bpm=51 resolved_bpm=52 bayes_bpm=52 calibrated_bpm=53 conf=0.87`.
Mechanism: pulseAnalysis.js `fs = (n - 1) / durationSec` over the 45 s history; dropped no-face frames leave a 10 s hole -> fs x 35/45.
With pulseCheck on, while bpm is withheld: `3 check=unknown bpm=- spectral_bpm=66 resolved_bpm=67 bayes_bpm=68 calibrated_bpm=67 fused_bpm=67 conf=1.00 reasons=LOW_SNR`
and after the gap `57 check=unknown bpm=- spectral_bpm=51 ... fused_bpm=53 conf=0.87`.

CPU/heap (Node, 80 s of 30 fps, 1 read/s, --expose-gc; excludes face finder, canvas, worker):
```
pub     cpuUserS=12.43 heapLiveMB=6.7
off     cpuUserS=2.72  heapLiveMB=7.3
on      cpuUserS=2.83  heapLiveMB=7.2
oncheck cpuUserS=4.18  heapLiveMB=7.8
```

## 6. Construction tests of the worker path (package's own processorWorker.js run in-process behind a fake Worker)
Engine throws on its 120th push (bin/failing-backend.mjs):
```
pub  main  : onErrorEvents ["runner:processor_error","session:processor_error"], runnerStillRunning false, samplesPushed 119, state failed/processor_error
test main  : same as pub
test worker: onErrorEvents [], runnerStillRunning true, samplesPushed 300, state failed/processor_failed, metricsBpm null
```
managedRppgSession.js retries only from onError with code processor_error (handleSessionError), so no automatic restart under the worker.
Trace (bin/tracecap.mjs, 900 samples):
```
main   getTraceSnapshot(100) -> points=100 durationSec=3.30 ; (600) -> points=600 durationSec=19.97
worker getTraceSnapshot(100) -> points=100 durationSec=9.97 ; (600) -> points=300 durationSec=9.97
```
Exported helpers (bin/doubling.mjs): `estimateDominantBpm(65 bpm + 0.6 harmonic)` pub 132.0, test 66.0. `new MultiRoiRppgFuser(fs)` defaults to "pos" (multiRoiFusion.js:9).

## 7. Prior measured evidence reused (scratchpad NIGHT-2026-10-10.md, pre-registered batches, not re-run here)
Removed from this public copy: these came from recordings that cannot be shared (private appendix).

## 8. Changesets
No changeset introduces `pulseCheck` (default on), `analysisWorker`, `analysisWidth`, `RPPG_WEB_BUILD_VERSION`, `PosPulseModel`, or the
`session.processor` type change (grep counts 0 for analysisWorker/analysisWidth/RppgProcessorLike/Worker/MAX_ANALYSIS_WIDTH).
chest-breathing.md and pulse-check-dark-wall.md describe options/constants later removed (one-experimental-switch.md, dark-wall-to-face.md).

## 9. Addenda
2 s face absence (GAP_END=47, pulseCheck off, defaults): test reads 64-67 for ~45 s after (true 66; expected scale 43/45 -> 63),
published on the same input 70-77 (its usual error). The bias grows with the absence: 10 s -> 51-53 for 36 s.
Shipped type docs (dist/rppgProcessor.d.ts Metrics) still say: bpm "Final fused/calibrated BPM estimate. Null during warmup (~10s) or when
backend is unavailable"; confidence "Gate your UI on this"; calibrated_bpm "Used as the basis for `bpm`"; fused_bpm "Same as `bpm` when no
external source is active". With the default pulse check: bpm null while fused_bpm 67 and confidence 1.00 (section 5).
Not run here (browser-only): analysisWidth / faceFinderTrial / worker start-up cost and memory; Vite dev pre-bundling of the worker URL.
scratch/behaviour-diff deleted after the run.
