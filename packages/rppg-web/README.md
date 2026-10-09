# @amelhede/rppg-web (test build)

**This is a test build, not the official package.** It is Elata's rPPG web SDK
(`@elata-biosciences/rppg-web` 0.14.0, MIT licence) with six fixes to the heart-rate
pipeline, four speed changes and a real-pulse check added. Every fix, speed change and rule of
the check has its own on/off switch, so an app can compare each one against the published
behaviour. It exists so the team can try
the changes in real apps before anything is proposed to the official SDK. It is published
under the npm `test` tag only; `latest` never points at it.

- Version: `0.15.0-test.11` (also exported as `RPPG_WEB_BUILD_VERSION`, for logging results
  against the exact build).
- Source: https://github.com/AMelhede/elata-bio-sdk, branch `release/test-1`.
- Everything below the "Switches" section is the upstream documentation, unchanged in
  substance. It uses the official package name, which is also how an app imports this build.

## Install it in place of the official package

Keep every import as it is (`@elata-biosciences/rppg-web`) and point the dependency at this
build with an npm alias, one line in the app's `package.json`:

```json
"@elata-biosciences/rppg-web": "npm:@amelhede/rppg-web@0.15.0-test.11"
```

Then reinstall (`npm install`, `pnpm install` or `yarn`). Subpath imports such as
`@elata-biosciences/rppg-web/pkg/rppg_wasm.js?url` keep working, because the package keeps
the same `exports` map. To go back, put the official version back in that line.

## Switches

All of them are ON by default in this build. Each one set to `false` gives back exactly what
the published 0.14.0 does for that part, so "off" is the comparison. Set them on
`createRppgSession(...)` (or on `DemoRunner` / `RppgProcessor` when used directly):

```ts
const session = await createRppgSession({
  video,
  faceMesh: "auto",
  // the defaults: every fix and speed change on but sparseFaceFinder; `fixes: false` turns every one off
  fixes: {
    noFaceNoReading: true,
    colourProjectionFix: true,
    realFrameRate: true,
    posFusion: true,
    noRateDoubling: true,
    steadyAnalysis: true,
    analysisWidth: true,
    analysisWorker: true,
    sparseFaceFinder: false, // off unless set to true (see the table)
    faceFinderTrial: true,
  },
  pulseCheck: true, // the default in this build
  chestBreathing: false, // experimental, off by default: breathing from chest motion (getChestBreathing)
  // every rule of the check on (the default); each one can be set to false on its own
  pulseCheckRules: {
    wallBandEdge: true,
    lightFamily: true,
    faceFlicker: true,
    lightTaint: true,
    headMotion: true,
    darkWall: true,
  },
});
console.log(session.getBuildSwitches()); // what this session actually runs
```

| Switch | What it does when ON | What OFF gives back |
|---|---|---|
| `fixes.noFaceNoReading` | With face tracking on and no face in view, no frame is read. After one second with no face the session reports no heart rate, HRV or breathing, and the multi-region fuser starts afresh when a face returns (the processor's own 10 s window is not cleared, so the first seconds back can still mix in frames from before). | The published behaviour: with no face found, the SDK reads a square in the middle of the picture (a wall, a chair) and keeps reporting a heart rate from it. |
| `fixes.colourProjectionFix` | Inside the WASM core: the colour step subtracts, as the CHROM method (de Haan and Jeanne 2013) says, so a lamp's flicker cancels and the pulse colour stays. Samples that are already a pulse pass through unchanged. Runs when the multi-region fusion is off and in the first moments before it has enough data. | The published core, which adds instead of subtracting: a flickering lamp passes as a pulse and the real pulse colour cancels. The switch reaches the WASM through `set_colour_projection_fix`. |
| `fixes.realFrameRate` | Frames are placed on the even 30-per-second time grid the analysis assumes, filling between frames, so a camera that delivers 15 to 25 frames a second (common indoors) does not scale every rate it reports. Gaps over 250 ms count as a stall and are not bridged. | Each frame is used as it arrives, as published; on a slow camera every rate comes out scaled. |
| `fixes.posFusion` | The step that blends forehead and both cheeks reads each region with POS (Wang et al. 2017), the method designed for its short windows (about 1.6 s). | CHROM, as published. An explicit `fusionProjection: "pos" \| "chrom"` option wins over this switch. |
| `fixes.noRateDoubling` | The rate estimator keeps the strongest rhythm it finds. | The published rule that, below 85 bpm, replaces the strongest rate with twice that rate whenever a pulse wave's own second harmonic is strong, so a resting 65 can read 130. |
| `fixes.steadyAnalysis` | The heart-rate analysis runs at most once per 250 ms of signal, and every read in between gets that answer, so the rate does not depend on how often an app (or the SDK's own diagnostics) asks for it. It also removes work: a managed session's diagnostics read on every camera frame. | As published, every read runs the whole analysis again, and the rate tracker takes the same stretch of signal once per read: a managed session on the main thread analyses on every camera frame, and the analysis worker reads twice per answer, so the reported rate depends on how often it is read. |
| `fixes.analysisWidth` | Speed. Each camera frame is read at most 640 pixels wide (same shape), and the face finder reads that same smaller picture, so the face points and the colours come from one frame. A cheek patch still averages thousands of pixels at that size, far more than the pulse needs. | The full camera frame, with the face finder reading the live video, as published. On a 1280x960 camera that cut the frames analysed to about 7 a second. |
| `fixes.analysisWorker` | Speed. The heart-rate analysis runs in a Web Worker, so it never holds up the camera frames. It runs on the main thread instead when a worker or the WASM core inside it cannot start, or when `wasmImporter` or `bpmEvidenceQualityProvider` is set (a function cannot be sent to a worker). The session option `analysisWorker`, when given, wins over this switch. | The analysis runs on the main thread, as published, and camera frames that arrive while it runs are skipped. |
| `fixes.sparseFaceFinder` | Speed. Off unless set to `true`: on recorded captures it added frames (about one a second) but did not give a reading on as many of them, so it is not a default. The face finder is asked at most every 100 ms (ten times a second); the frames in between are read with the last face it found. The finder is the costliest step per frame, so on a busy machine more of the camera's frames are read; a face that moves is then read with a box up to 100 ms old. | The face finder runs on every frame, as published. |
| `fixes.faceFinderTrial` | Speed. With `faceMesh: "auto"`, the face finder is built on the GPU and on the CPU, each is timed on the live video for a few frames, and the faster is kept (a laptop's CPU alone can hold the camera to a few frames a second; a software GPU can be slower than the CPU, so the clock decides). A finder whose GPU context dies, or that finds no face for 2 s after the page comes back from hidden, is rebuilt. `session.getFaceFinder()` says which delegate won and what each cost. An app that passes its own `faceMesh` is unaffected. | The CPU delegate only, as published, and no rebuild. |
| `pulseCheck` | A heart rate is reported only while a real pulse is proven: forehead and both cheeks agree on one rate, clearly above the noise, over 8 one-second windows, and the newest 8 seconds still back it. The reported rate is the one the check measured. A patch of wall beside the face is checked too: a light that flickers at the same rhythm is refused. HRV and breathing are always withheld while it is on, because neither yet passes a known-answer test. `session.getPulseCheck()` shows the check's state. | The SDK's own rate (with the fixes chosen above), HRV and breathing, as published. |
| `pulseCheckRules` | Each of the check's rules can be turned off on its own, for testing one at a time: `wallBandEdge` (the wall's line is found even at the band's edge, a light folded to 180 a minute), `lightFamily` (a light's whole and half multiples are the light's too), `faceFlicker` (a rate the face flickers at in brightness far more than in colour is refused), `lightTaint` (a second the wall carries does not count toward proving a pulse), `headMotion` (a rate the head's own movement keeps time with, such as a nod, is the movement's: judged at that rate, by how far the movement stands above the head's other movement and by its size against the face's width; a second the head carries the rate is not evidence, nor is a second the face mesh did not see the head, and the rate is withheld once the head carries it for 4 seconds), `darkWall` (when the camera's colour is too damaged to read by colour, the pulse is read from green minus the wall beside the face, but only over a wall that shows the light on the face: the wall at least a tenth as bright as the face through nearly the whole window, whatever the colour scale or the camera's exposure; over a darker wall it is read by colour as usual, so a light on the face that the wall does not show, such as a screen, is not read as the pulse; `getPulseCheck().windowWallToFace` shows the wall against the face, `windowWallLevel` the wall's level as the camera sees it). All on unless set to false; `getBuildSwitches()` reports them. | Each rule off: the behaviour before it existed. |
| `chestBreathing` | Experimental, off by default. Also reads the breathing rate from the up-and-down motion of the chest and shoulders in a box below the chin (32-second window, 6 to 36 breaths a minute), shown by `session.getChestBreathing()` as `{ rate, share }` (`share` near 1: one clear rhythm; near 0: noise). It is separate from the metrics' `respiration_rate`, which the pulse check keeps withheld. Measured so far only on recorded captures against a finger-sensor breathing reference; treat it as a research output. Needs the face mesh and a view of the chest; a still person. | (default) not read. |
| `pulseCheckAgreement` | Off by default. With the check on, also report the SDK's own rate when it agrees with the check's latest window for 8 seconds running. | (default) |

Things to know while testing:

- **The pulse check needs face tracking.** With `faceMesh: "off"`, or if the face finder
  failed to load, there are no face regions to check, so no heart rate is shown. That is by
  design (no proof, no number). Check `diagnostics.faceTrackingMode`; set `pulseCheck: false`
  to see the SDK's own rate instead.
- **Silence is an answer.** The check stays quiet when the pulse cannot be read clearly (poor
  light, movement, a turned head). It usually takes 20 to 40 seconds of a still face to show
  a number. A number that never comes is worth reporting, with the light and the camera used.
- **None of the fixes alone stops a number from a face with no pulse** (a photo, a lamp on a
  face). Only the pulse check does that.
- **The movement rule needs MediaPipe's face mesh (468 points, or 478 with the irises) on
  every frame** (with `sparseFaceFinder` on, the last mesh found is carried to the frames in between). It reads the head's bone landmarks by that mesh's own numbering. With
  `headMotion` on, a frame source that gives face regions without landmarks, or with too few
  of them (454 points or fewer, such as a 68-point face detector), shows no heart rate:
  `headCentre` finds no head, every second is judged `"blind"`, and a nod cannot be ruled
  out. `getPulseCheck().windowHead` says how the latest second was judged: `"carried"`,
  `"clear"` or `"blind"`.
- Every result worth keeping should be logged with `RPPG_WEB_BUILD_VERSION` and
  `session.getBuildSwitches()`.

## What the original package is

TypeScript wrapper for the Elata rPPG pipeline.

### What This Package Is

This package provides:

- `createRppgSession()` as the recommended browser integration entrypoint
- `RppgProcessor` for lower-level sample ingestion and metrics work
- packaged browser WASM backend loading from `/pkg`
- advanced helpers such as `DemoRunner` and frame sources

## When To Use It

**Abstraction level: managed session.** This package owns the camera capture
loop, WASM loading, face ROI, diagnostics, and lifecycle for you: you call
`createRppgSession()` and poll `getMetrics()`.

Use `@elata-biosciences/rppg-web` when you want:

- browser-side rPPG processing with a managed camera session
- packaged WASM backend loading without wiring the low-level runtime yourself
- built-in diagnostics, graceful degradation, and lifecycle management

If you are evaluating the SDK for the first time, start with the
`create-elata-demo` rPPG template before integrating manually.

## Install

```bash
pnpm add @elata-biosciences/rppg-web
npm install @elata-biosciences/rppg-web
```

**Using a local `file:` path** (monorepo or local dev)? You must build the
WASM backend before running `pnpm install` in your app: `file:` installs copy
whatever is on disk at the time. Run `build:wasm` first:

```bash
pnpm --dir packages/rppg-web run build:wasm  # requires Rust + wasm-bindgen
cd your-app && pnpm install
```

The published npm package includes pre-built `pkg/` assets: this step is only
needed when working from the repo source.

## Requirements

- Node.js `>= 20` for builds, tests, and demos
- modern browser with WebAssembly support for the default backend
- optional MediaPipe FaceMesh for face-ROI demo helpers

**Building the WASM backend from source** (not needed when installing from npm):
- Rust toolchain (`rustup`, `cargo`)
- `wasm-bindgen-cli` (`cargo install wasm-bindgen-cli`)
- Run `pnpm --dir packages/rppg-web run build:wasm` to compile and place assets in `pkg/`

## Vite Config

### WASM asset placement

The default session loader fetches WASM files from `/pkg/rppg_wasm.js` and
`/pkg/rppg_wasm_bg.wasm`. In a Vite app, place those files under `public/pkg/`
so they are served at that path:

```
your-app/
  public/
    pkg/
      rppg_wasm.js
      rppg_wasm_bg.wasm
```

The built assets live in `node_modules/@elata-biosciences/rppg-web/pkg/` after
an npm install. Copy or symlink that directory into your app's `public/` folder,
or use the import-based options below to let Vite manage the asset URLs instead.

### Dynamic import restriction

Vite 7 blocks `import(url)` for files served from `/public`, which is where
most projects place the `pkg/` WASM assets. **If you skip this step, the
session will start, `backendMode` will be `"unavailable"`, and BPM will always
be null: no error is thrown.** Two approaches to fix it:

**Option A: vite-plugin-wasm (recommended)**

```bash
npm install -D vite-plugin-wasm vite-plugin-top-level-await
```

```ts
// vite.config.ts
import { defineConfig } from "vite";
import wasm from "vite-plugin-wasm";
import topLevelAwait from "vite-plugin-top-level-await";

export default defineConfig({
  plugins: [wasm(), topLevelAwait()],
});
```

Then import the WASM JS bundle statically and pass it as `wasmImporter`:

```ts
import * as rppgWasm from "@elata-biosciences/rppg-web/pkg/rppg_wasm.js";
import { createRppgSession } from "@elata-biosciences/rppg-web";

const session = await createRppgSession({
  video: videoEl,
  wasmImporter: () => Promise.resolve(rppgWasm),
});
```

**Option B: explicit URL imports (no extra plugins)**

```ts
import rppgWasmJsUrl from "@elata-biosciences/rppg-web/pkg/rppg_wasm.js?url";
import rppgWasmBinaryUrl from "@elata-biosciences/rppg-web/pkg/rppg_wasm_bg.wasm?url";
import { createRppgSession } from "@elata-biosciences/rppg-web";

const session = await createRppgSession({
  video: videoEl,
  wasmJsUrl: rppgWasmJsUrl,
  wasmBinaryUrl: rppgWasmBinaryUrl,
});
```

Option B works because Vite resolves `?url` imports to fingerprinted asset
URLs at build time, bypassing the public directory restriction entirely.

## Usage

Minimal camera → BPM loop:

```ts
import { createRppgSession } from "@elata-biosciences/rppg-web";

// 1. Acquire camera and attach to a video element
const stream = await navigator.mediaDevices.getUserMedia({ video: true });
const video = document.createElement("video");
video.srcObject = stream;
await video.play();

// 2. Start an rPPG session
const session = await createRppgSession({
  video,
  backend: "auto",
  faceMesh: "off",
});

// 3. Poll for BPM
const interval = setInterval(() => {
  const metrics = session.getMetrics();
  if (metrics?.bpm != null) {
    console.log("BPM:", metrics.bpm.toFixed(1));
  }
}, 1000);

// 4. Cleanup
// clearInterval(interval);
// await session.stop();
```

Expect a ~10 second warmup before the first BPM estimate.

> **If BPM is always null:** check `session.backendMode` before assuming bad
> signal. If it is `"unavailable"`, the WASM assets did not load: the session
> runs gracefully but metrics will always be null. This looks identical to the
> warmup period. See the [Vite Config](#vite-config) section above.

If you need a single boolean for UI gating (e.g. "show the BPM display"),
use `createRppgAppAdapter().canPublish` instead of polling `getMetrics()`
directly: it handles the backend check, confidence threshold, and warmup
window in one place.

With diagnostics:

```ts
const session = await createRppgSession({
  video: videoEl,
  sampleRate: 30,
  backend: "auto",
  faceMesh: "off",
  onDiagnostics: (diagnostics) => {
    console.log(diagnostics.state.status, diagnostics.faceTrackingMode);
    console.log(diagnostics.framesSeen, diagnostics.totalSamplesReceived);
    console.log(diagnostics.issues, diagnostics.processorFailure);
  },
  onError: (error) => {
    console.error(error.code, error.message);
  },
});

console.log(session.getMetrics());
```

`createRppgSession()` owns the packaged WASM init, FaceMesh loading, frame
capture loop, ROI handling, diagnostics emission, and cleanup. If WASM is not
available and you use `backend: "auto"`, the session falls back to an
`unavailable` backend mode and reports that state through diagnostics instead of
failing silently.

## Which API To Use

| API | Use when |
|-----|----------|
| `createRppgSession()` | Starting point for most browser apps: handles WASM init, frame capture, ROI, diagnostics, and cleanup. |
| `createManagedRppgSession()` | Same as above, plus automatic restart after terminal processor failures. |
| `createRppgAppAdapter()` | You want a single app-facing snapshot (status, BPM, `canPublish`, trace) to drive UI state: use this instead of calling `getMetrics()` yourself and writing the gating logic. |
| `createRppgAppMonitor()` | You want the SDK to own the update loop entirely: it polls on an interval and pushes snapshots to a subscriber, so you don't write any `setInterval` + `getMetrics()` code at all. |
| `RppgProcessor` / `DemoRunner` | You need custom capture orchestration or rendering that the session helpers don't cover. |

If you're unsure, start with `createRppgSession()` and a `setInterval` +
`getMetrics()` poll. Reach for the adapter/monitor when you want the SDK to
own that loop.

## Recommended Vs Advanced

Recommended:

- Use `createRppgSession()` for browser apps that need camera capture, packaged WASM loading, ROI handling, diagnostics, and cleanup.
- Use `createManagedRppgSession()` when you also want automatic restart after terminal processor failures.
- Use `RppgProcessor` only when you intentionally want low-level sample ingestion and already own the surrounding orchestration.

Advanced:

- Drop to `RppgProcessor`, `DemoRunner`, frame sources, or generated WASM bindings only when you need custom orchestration that the session helper does not cover.
- If you are debugging the SDK itself, compare against `createRppgSession()` first so you know whether the problem is in your app wiring or lower-level runtime behavior.

`loadWasmBackend()` looks for packaged WASM bundles at common paths such as
`/pkg/rppg_wasm.js` and `/rppg_wasm.js`.

If you want to inject your own backend, it must expose
`newPipeline(sampleRate, windowSec)` and return an object with `push_sample`
and `get_metrics` or camelCase equivalents.

## Key Exports

- `createRppgSession`
- `createManagedRppgSession`
- `RppgSession`
- `RppgProcessor`
- `DemoRunner`
- `MediaPipeFrameSource`
- `MediaPipeFaceFrameSource`
- `loadWasmBackend`
- `computeWaveformPeriodicityProfile`
- `computeTraceWaveformDebug`
- `normalizeRppgError`
- `createRppgAppAdapter`
- `createRppgAppMonitor`
- `ensureVideoPlaying`
- `replayBayesSession`
- `CaptureConfidenceScorer`

## Capture Confidence (motion + lighting)

rPPG is fragile under motion and bad lighting, and the classic failure is a
calibration bar that silently freezes. `CaptureConfidenceScorer` turns that into
honest UX: a 0..1 confidence in the **capture environment**, separate from the
pulse-domain `confidence`/`signal_quality`, plus the limiting factor
(`"motion"` vs `"lighting"`) and actionable reason codes, so you can gate
calibration and tell the user exactly what to fix.

```ts
import { CaptureConfidenceScorer } from "@elata-biosciences/rppg-web";

const capture = new CaptureConfidenceScorer();
// Per processed frame (everything optional: it degrades to what you have):
const c = capture.push({ landmarks, faceBox, motion, clipRatio, skinRatio, meanLuma });
// c.score, c.motion, c.lighting, c.limiting, c.reasons, c.ready
```

Or let `RppgProcessor` carry it for you: call `proc.pushCaptureFrame(sample)` each
frame and read the `capture_confidence` / `capture_motion` / `capture_lighting` /
`capture_limiting` fields from `getMetrics()`. `BaselineCalibrator.push(bpm, hrv,
quality, capture)` then gates intake on it: progress *pauses* (never retreats)
with `calibrator.stallReason` naming the fix instead of leaving a frozen %.

The motion half ports the open features (TI / FMX / FMY / FSM) from
Arevalillo-Herráez et al., _Motion-Based Confidence Score…_, J. Med. Syst. (2026)
50:82, combined by a transparent noisy-OR weighted by the paper's published
correlations. The lighting term is our extension (the paper is motion-only). The
paper's trained classifier is intentionally **not** reproduced here.

## Session Diagnostics

```ts
import {
  createRppgSession,
  type RppgSessionDiagnostics,
} from "@elata-biosciences/rppg-web";

const session = await createRppgSession({
  video: videoEl,
  onDiagnostics: (diagnostics: RppgSessionDiagnostics) => {
    console.log(diagnostics.roiSource, diagnostics.processorMethod);
    console.log(diagnostics.lastSampleAgeMs, diagnostics.issues);
  },
});

console.log(session.lastError);
```

Every session diagnostics payload includes:

- `framesSeen`, `droppedFrames`, and `lastDropReason`
- `roiSource` and `processorMethod`
- `totalSamplesReceived`, `windowSampleCount`, and `lastSampleAgeMs`
- processor issue codes such as `no_samples_yet`, `insufficient_window`, and `low_skin_ratio`
- session-level issues such as `backend_unavailable`
- `state` with `running`, `degraded`, or terminal `failed` status
- `processorFailure` when a fatal backend exception poisons the WASM pipeline
- `lastError` when capture, FaceMesh, or processor work fails

**Warmup indicator:** During the ~10 second warmup window, `diagnostics.issues`
contains `insufficient_window`. Once that clears, the processor has enough
samples for a BPM estimate. `diagnostics.windowSampleCount` gives the raw
sample count if you want to show a progress indicator.

**FaceMesh fallback:** `faceMesh: "auto"` falls back to `video_frame` mode if
MediaPipe fails to load. Check `diagnostics.faceTrackingMode` to see which
mode is active: `"face_mesh"` or `"video_frame"`.

**Multi-ROI fusion (on by default):** in `face_mesh` mode the session runs CHROM +
bandpass independently on the forehead and both cheeks and blends them by in-band
spectral SNR, so glare/hair/glasses-glint or partial occlusion on one region no
longer poisons the pulse. It falls back automatically to the single aggregated-ROI
path in `video_frame` mode or when the skin mask is off. Disable with
`multiRoiFusion: false`. Runner diagnostics expose `lastFusionWeights` (per-region,
SNR-driven), `lastFusedSnr`, and `lastProcessorMethod: "fused"`.

### Versioned ROI profiles

ROI geometry and pixel selection are separate, versioned contracts. Normal
applications should omit both options and retain the existing SDK behavior.
Replay studies and learned models can select a frozen profile explicitly:

```ts
import {
  TRADELOCK_RGB_WEIGHTED_V1_PIXEL_SAMPLER,
  MCD_PROXY_INPUT_V1_PROFILE,
  createRppgSession,
} from "@elata-biosciences/rppg-web";

const session = await createRppgSession({
  video: videoEl,
  faceMesh: "auto",
  roiGeometryProfile: MCD_PROXY_INPUT_V1_PROFILE,
  roiPixelSampler: TRADELOCK_RGB_WEIGHTED_V1_PIXEL_SAMPLER,
});
```

The built-in profiles have deliberately narrow meanings:

| Profile | Contract |
|---------|----------|
| `ELATA_FACE_YCBCR_V1_PROFILE` | Current SDK forehead/cheek geometry; default. |
| `MCD_PROXY_INPUT_V1_PROFILE` | Frozen five-ROI geometry used by the waveform proxy model. |
| `TRADELOCK_LIVE_FOREHEAD_V1_PROFILE` | Landmark-anchored forehead rectangle for TradeLock live-pipeline replay and ablation. |
| `ELATA_YCBCR_V1_PIXEL_SAMPLER` | SDK YCbCr skin predicate and fallback semantics. |
| `TRADELOCK_RGB_WEIGHTED_V1_PIXEL_SAMPLER` | TradeLock normalized-RGB skin predicate with center weighting. |

Geometry and sampling profiles are independent because the waveform model's input
geometry and the TradeLock live forehead ROI are not the same algorithm. Keep
the model's expected profile ID with its artifact metadata. `sampleRppgRoi()`
emits the versioned `elata.rppg.roi-sample/v1` boundary with RGB, raw skin
fraction, compatibility skin fraction, clipping, luminance statistics, and both
profile IDs.

### Experimental Bayesian ambiguity penalty

The default tracker remains unchanged. To reduce confidence when estimators
strongly disagree, pass a validated, versioned configuration:

```ts
const session = await createRppgSession({
  video,
  bpmTrackerConfig: {
    schema: "elata.rppg.bpm-tracker-config/v1",
    id: "ambiguity-v1",
    ambiguityPenalty: { enabled: true, spreadStartBpm: 18, spreadRangeBpm: 90, maxPenalty: 0.28 },
  },
});
```

Metrics expose `bayes_ambiguity` and `bayes_tracker_config_id`. Invalid or
out-of-range configurations are rejected during session creation.

Advanced integrations may pass a `bpmEvidenceQualityProvider`. Its per-source
multipliers and ambiguity penalty are bounded by the SDK; missing, non-finite,
or thrown results become neutral. Keep learned trust artifacts outside this
package and provide them through this interface.

### Experimental waveform reconstruction

Learned reconstruction is an optional diagnostic plugin and never replaces the
deterministic BPM path:

```ts
const session = await createRppgSession({
  video,
  faceMesh: "auto",
  roiGeometryProfile: MCD_PROXY_INPUT_V1_PROFILE,
  roiPixelSampler: TRADELOCK_RGB_WEIGHTED_V1_PIXEL_SAMPLER,
  experimental: {
    waveformReconstructor,
    inferenceIntervalMs: 1000,
    useReconstructedBpmEvidence: false,
  },
});
```

The SDK builds the frozen five-ROI, 15-channel window, runs inference outside
the frame callback, contains model failures, and exposes
`getModelDiagnostics()` and `getLatestWaveformReconstruction()`. `stop()`
aborts in-flight model work and releases its runtime; a later `start()`
reinitializes it. `dispose()` is terminal and idempotent. Diagnostics distinguish
insufficient/alignment/profile/channel input failures from model initialization,
inference, and output failures. A profile mismatch prevents window construction
rather than silently changing model preprocessing.

### Experimental morphology and physiology interpretation

`extractWaveformMorphology()` converts a filtered or reconstructed waveform
into source-labelled cycle features. Physiological trend proxies appear only
under `experimentalProxies` after reliability gates pass.

`normalizePhysiologyFeatures()` computes baseline-relative HR, HRV, and
respiration features without assigning labels. Pass those features to
`createPhysiologyInterpreter()` only if generic `baseline`, `activated`, or
`recovering` states are useful to your app. Its `activationScore` is
physiology-derived evidence, not facial affect, emotional valence, stress, or a
clinical measurement; use `affect.ts` separately when face-derived affect is
actually intended.

Intentional `faceMesh: "off"` sessions use `video_frame` mode without being
reported as a FaceMesh failure. If a fatal processor exception occurs,
`session.state` switches to terminal `failed`, later metrics reads return safe
null/zero values, and the runner stops instead of continuing to reuse the same
backend instance.

If your app needs explicit asset control, `createRppgSession()` also accepts:

- `wasmJsUrl`
- `wasmBinaryUrl`
- `wasmImporter`
- `ensureVideoPlayback`
- `videoPlaybackTimeoutMs`

Those options let apps bypass guessed `/pkg/*` paths when bundler or deploy
layout needs explicit wiring.

## Managed Session

If your app wants a supervised lifecycle with retry-on-processor-failure, use
`createManagedRppgSession()`:

```ts
import { createManagedRppgSession } from "@elata-biosciences/rppg-web";

const managed = await createManagedRppgSession({
  video: videoEl,
  faceMesh: "off",
  maxRetries: 3,
  retryDelayMs: 1500,
  onStateChange: (state) => {
    console.log(state.status, state.retryCount, state.lastError?.code);
  },
});

console.log(managed.state.status);
console.log(managed.getMetrics());
```

The managed wrapper sits above `RppgSession`; it does not replace the lower
level API when you want full lifecycle ownership.

## Public Trace Snapshot

If you want recent waveform/debug samples without reading internal processor
fields, use `getTraceSnapshot()`:

```ts
const trace = session.getTraceSnapshot(300);

console.log(trace.sampleRate, trace.windowSec);
console.log(trace.points);
console.log(trace.backendFailure);
```

`getTraceSnapshot()` is the supported way to read recent intensity/sample data
for debug panels or regression tooling.

If you also want peak/threshold-style waveform debug without reading processor
internals, use `computeTraceWaveformDebug()`:

```ts
import { computeTraceWaveformDebug } from "@elata-biosciences/rppg-web";

const waveform = computeTraceWaveformDebug(session.getTraceSnapshot(300));

console.log(waveform.peaks);
console.log(waveform.threshold);
```

## Error Normalization

Use `normalizeRppgError()` to convert raw session errors or degraded
diagnostics into stable app-facing categories and recovery guidance:

```ts
import { normalizeRppgError } from "@elata-biosciences/rppg-web";

const normalized = normalizeRppgError(session.lastError, session.getDiagnostics());

console.log(normalized?.code);
console.log(normalized?.message);
console.log(normalized?.guidance);
```

The helper covers cases such as:

- `wasm_init_failed`
- `face_tracking_init_failed`
- `camera_not_playing`
- `capture_failed`
- `canvas_unavailable`
- `processor_failed`
- `backend_unavailable`

## App Adapter

If you want a single app-facing snapshot for UI state, publish gating, trace
data, and stable messages, use `createRppgAppAdapter()`:

```ts
import {
  createManagedRppgSession,
  createRppgAppAdapter,
} from "@elata-biosciences/rppg-web";

const managed = await createManagedRppgSession({
  video: videoEl,
  faceMesh: "off",
});

const adapter = createRppgAppAdapter();
const app = adapter.getSnapshot(managed);

console.log(app.status);
console.log(app.canPublish);
console.log(app.publishBpm);
console.log(app.message);
console.log(app.trace.points);
```

This is the recommended reference-adapter path before building a custom
`useRppg`-style state layer in your app.

If you want the SDK to own the polling/subscription loop too, use
`createRppgAppMonitor()`:

```ts
import {
  createManagedRppgSession,
  createRppgAppMonitor,
} from "@elata-biosciences/rppg-web";

const managed = await createManagedRppgSession({ video: videoEl, faceMesh: "off" });
const monitor = createRppgAppMonitor(managed, { intervalMs: 500 });

const unsubscribe = monitor.subscribe((snapshot) => {
  console.log(snapshot.status, snapshot.publishBpm);
});

monitor.start();
```

## Video Playback Helper

If your app needs to coordinate autoplay/readiness explicitly before starting a
session, use `ensureVideoPlaying()`:

```ts
import { ensureVideoPlaying } from "@elata-biosciences/rppg-web";

await ensureVideoPlaying(videoEl, { timeoutMs: 5000 });
```

`createRppgSession()` uses the same helper internally by default.

## Low-Level Integration

If you need custom capture orchestration, the lower-level APIs are still
available:

- `loadWasmBackend()` for manual backend loading
- `RppgProcessor` for direct sample ingestion
- `DemoRunner`, `MediaPipeFrameSource`, and `MediaPipeFaceFrameSource` for advanced browser control

For most browser apps, prefer `createRppgSession()` and only drop lower if you
need custom lifecycle or rendering behavior.

## Version Compatibility

`@elata-biosciences/rppg-web` and `@elata-biosciences/eeg-web` are tested in
lockstep in this repo. Prefer matching package versions unless release notes
say otherwise.

## Build And Dev Notes

**Using from source?** Run `pnpm --dir packages/rppg-web build` before
importing the package. The published npm release ships a pre-built `dist/`, but
a fresh clone does not. The `prepare` script handles this automatically after
`pnpm install`.

To also build the WASM assets (required for the `pkg/` directory and any
integration that loads WASM), run `pnpm --dir packages/rppg-web run build:wasm`
first. This requires Rust and `wasm-bindgen`.

**Using via `file:` path (monorepo or local integration)?** Run `build:wasm`
*before* running `pnpm install` in the consumer app. `file:` installs copy
whatever is on disk at install time: if `pkg/` doesn't exist yet, it won't
be included. The sequence is:

```bash
pnpm --dir packages/rppg-web run build:wasm  # builds pkg/ at package root
cd your-app && pnpm install                   # now pkg/ is copied in
```

From the repo root:

```bash
pnpm --dir packages/rppg-web run build:demo
pnpm --dir packages/rppg-web build
pnpm --dir packages/rppg-web test
```

To run the in-package demo:

```bash
pnpm --dir packages/rppg-web run start-demo
```

Useful explicit commands:

```bash
pnpm --dir packages/rppg-web run build:wasm
pnpm --dir packages/rppg-web run bundle:demo
pnpm --dir packages/rppg-web run start-demo:quick
```

Demo entry points after `start-demo` / `start-demo:quick`:

- `/index.html`: live camera demo with tracker and replay debug panels
- `/replay.html`: import a copied replay JSON blob or a raw replay session and inspect the summary offline

## Replay Workflow

The live demo can copy a replay JSON payload from its debug panel. That payload
is already a serialized `ReplayBayesSessionResult`, so it can be:

- pasted into the `/replay.html` page in the in-package demo
- stored with bug reports for tracker regressions
- compared across SDK versions to spot replay output changes

If you have a raw session payload shaped like `ReplayDebugSession`, the replay
page can also run `replayBayesSession()` on it and render the result.

## Package Layout

- `src/*.ts`: source edited in this repo
- `dist/*.js`: emitted runtime files
- `dist/*.d.ts`: emitted type declarations
- `pkg/*`: packaged WASM runtime assets
- `demo/*`: demo-only files

## Troubleshooting

- If `session.backendMode` is `unavailable`, make sure your app is serving the packaged `pkg/rppg_wasm.js` and `.wasm` assets.
- If you see "backend pipeline has no push_sample API", make sure you are using `createRppgSession()` or a backend created through the normalized wrappers rather than constructing generated bindings directly.
- If you hit `wasmrppgpipeline_new`, make sure the underlying WASM module was initialized before creating low-level pipelines and prefer the package helpers over raw generated constructors.
- If you see deprecated init warnings, route startup through `initEegWasm()` instead of calling generated init exports with raw strings, URLs, or buffers.
- If camera access fails, verify that the page has permission to use `getUserMedia` and that the browser supports the required APIs.
- If you want a known-good starting point, scaffold the `rppg-demo` template with `create-elata-demo` and compare your setup against it.

## Release Notes

For release flow, dist-tags, and recovery guidance, see
[docs/releasing.md](https://github.com/Elata-Biosciences/elata-bio-sdk/blob/main/docs/releasing.md).
