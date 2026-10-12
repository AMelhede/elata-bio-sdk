## Issue: With face tracking on, the SDK reports a heart rate when no face is in view

With `faceMesh: "auto"` resolved to `face_mesh` and no face found, `MediaPipeFaceFrameSource` emits a frame with no ROI and `DemoRunner` reads a 100x100 crop at the centre of the frame instead (`demoRunner.ts`, the `!roi` fallback), pushing a wall or a chair into the pulse window. A spectral peak picker always returns the strongest bin in band, so `getMetrics()` keeps reporting a heart rate. The same fallback is in the published 0.1.1, 0.8.0 and 0.14.0. Once samples stop, `RppgProcessor.getMetrics()` also keeps returning its last estimate. The scaffolded `rppg-demo` shows `session.getMetrics().bpm`, so the default path is affected. A face-finder miss of a few frames with the face still in view goes through the same fallback, so it also feeds the centre square into a window that was reading the fused regions. `createRppgAppAdapter`'s 600 ms face-box gate keeps `canPublish` false and the snapshot's `publishBpm` null, but the crop still enters the window, and `snapshot.metrics` and `snapshot.gating.publishBpm` carry its number.

## PR: fix(rppg-web): with face tracking on, no face means no reading

Branch: opened from `pr/no-face-no-reading` on github.com/AMelhede/elata-bio-sdk, one commit on Elata main 49fdb41 (6950c68), the same tree as the working branch `fix/no-face-no-reading` at 21b7326 (eight commits, kept for history; its first commit predates the repo's commit convention and is already public on the fork).

**Reproduce on the published 0.14.0 (no data needed).** From the repo root, after `pnpm --filter @elata-biosciences/rppg-web build`: `npm pack @elata-biosciences/rppg-web@0.14.0 && mkdir rppg-web-0.14.0 && tar xzf elata-biosciences-rppg-web-0.14.0.tgz -C rppg-web-0.14.0`, save the script below as `face-gap.mjs`, and run `node face-gap.mjs ./rppg-web-0.14.0/package/dist gap 10 1` (0.14.0) and `node face-gap.mjs ./packages/rppg-web/dist gap 10 1` (this PR). The WASM core comes from the 0.14.0 package in both runs. It builds what `createRppgSession` builds once a face is found (`DemoRunner` with fusion and the skin mask, `RppgProcessor` with the tracker, `RppgSession` in `face_mesh` mode), feeds a 66 bpm colour pulse with three face regions, and polls `session.getMetrics()` once a second, like an app. `gap <s>`: the person leaves at 45 s for that long (the camera sees a grey wall, the face finder sends no regions). `miss <ms>`: the face stays in view at 15 s but the face finder loses it for that long. A second counts as right within 5 bpm of 66.

| run (seeds 1 to 3) | 0.14.0 (main 49fdb41 prints the same) | this PR |
|---|---|---|
| gap 10 s: seconds of the gap with a number | 10 of 10 | 1 of 10 (the 1 s hold) |
| gap 10 s: 65 s after the face returns, right / wrong number | 31 / 34; first right after 35 s, 73 meanwhile | 61 / 3; a number after 2 s, first right after 2 to 5 s (87, 80, 73 first) |
| gap 30 s: seconds of the gap with a number | 30 of 30 | 1 of 30 |
| gap 30 s: 65 s after, right / wrong | 21 to 22 / 43 to 44; first right after 44 to 45 s, 79 to 81 meanwhile | 61 / 3 |
| miss 367 ms, face in view: 45 s after, right | 34 to 37 | 45 |
| miss 733 ms, face in view: 45 s after, right | 29 to 31 (reads 90 to 91 from 7 s after) | 45 |

The three wrong numbers after a return are the CHROM stage of the fuser settling on a fresh window; with POS in the fuser (`fix/pos-in-fuser`, proposed separately) the same script reads right from the first second after the return, 65 of 65, at both gap lengths (merged tree, seed 1).

<details><summary>face-gap.mjs</summary>

```js
import { readFileSync } from "node:fs";
const [dist, mode, len, seedArg] = process.argv.slice(2);
const { DemoRunner } = await import(`${dist}/demoRunner.js`);
const { RppgProcessor } = await import(`${dist}/rppgProcessor.js`);
const { RppgSession } = await import(`${dist}/rppgSession.js`);
const { initSync, WasmRppgPipeline } = await import("./rppg-web-0.14.0/package/pkg/rppg_wasm.js");
initSync({ module: readFileSync("./rppg-web-0.14.0/package/pkg/rppg_wasm_bg.wasm") });
// "gap": the person leaves for <len> s at 45 s (the camera sees a wall, the face finder sends no regions).
// "miss": the face stays in view but the face finder loses it for <len> ms at 15 s.
const TRUE = 66, START = mode === "gap" ? 45000 : 15000, LEN = mode === "gap" ? Number(len) * 1000 : Number(len);
const END = mode === "gap" ? START + LEN + 65000 : 60000;
let s = Number(seedArg) >>> 0;
const dither = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32 - 0.5; };
const rois = [{ x: 35, y: 15, w: 30, h: 20 }, { x: 15, y: 50, w: 25, h: 25 }, { x: 60, y: 50, w: 25, h: 25 }];
function frame(t, face, found) {
  const data = new Uint8ClampedArray(100 * 100 * 4), p = Math.sin((2 * Math.PI * TRUE * t) / 60000), a = 0.03;
  for (let i = 0; i < data.length; i += 4) {
    const c = face ? [200 * (1 - 0.33 * a * p), 140 * (1 - a * p), 110 * (1 - 0.5 * a * p)] : [150, 145, 140];
    for (let k = 0; k < 3; k++) data[i + k] = c[k] + dither();
    data[i + 3] = 255;
  }
  return found ? { data, width: 100, height: 100, timestampMs: t, rois } : { data, width: 100, height: 100, timestampMs: t };
}
// What createRppgSession builds in face_mesh mode with no roi, minus the camera and the face finder.
// requireFace is what the branch's createRppgSession passes; 0.14.0 ignores it.
const source = { onFrame: null, async start() {}, async stop() {} };
const processor = new RppgProcessor({ newPipeline: (fs, w) => new WasmRppgPipeline(fs, w) }, 30, 10, {});
processor.enableTracker(55, 150, 200);
const runner = new DemoRunner(source, processor, { sampleRate: 30, roiSmoothingAlpha: 0.25, useSkinMask: true, requireFace: true });
const session = new RppgSession(source, processor, runner, "wasm", "face_mesh");
await runner.start();
const shown = []; // what an app polling session.getMetrics() once a second shows
for (let i = 0; i < (END * 30) / 1000; i++) {
  const t = (i * 1000) / 30, out = t >= START && t < START + LEN;
  source.onFrame(frame(t, mode === "miss" || !out, !out));
  if ((i + 1) % 30 === 0) { const b = session.getMetrics().bpm; shown.push({ t: (i + 1) / 30, bpm: typeof b === "number" ? Math.round(b) : null }); }
}
const right = (x) => x.bpm != null && Math.abs(x.bpm - TRUE) <= 5;
const during = shown.filter((x) => x.t * 1000 > START && x.t * 1000 <= START + LEN);
const after = shown.filter((x) => x.t * 1000 > START + LEN);
const first = after.find(right);
console.log(`${mode} ${len}, seed ${seedArg}:`, mode === "gap" ? `a number in ${during.filter((x) => x.bpm != null).length}/${during.length} s of the gap,` : "",
  `after it right ${after.filter(right).length}/${after.length} s, wrong number ${after.filter((x) => x.bpm != null && !right(x)).length},`,
  `first right ${first ? Math.round(first.t - (START + LEN) / 1000) : "never"} s after; first 8 s after: ${after.slice(0, 8).map((x) => x.bpm).join(" ")}`);
```

</details>

- In `face_mesh` mode without an explicit `roi`, a frame with no face is dropped (`lastDropReason: "no_face"`, `roiSource: null`, no `onStats` call) instead of read.
- After 1 s without a face, `RppgSession.getMetrics()` reports no reading: the SDK's existing failed-backend shape (every rate, confidence, agreement and window figure cleared, `snr` and `bayes_ambiguity` dropped), with reason code `no_face` appended (the code `RppgGatingController` already checks; nothing emitted it before). The rolling baseline, calibration state, tracker configuration ids and `capture_*` fields are kept. `RppgProcessor.getMetrics()` itself is unchanged.
- When the face returns after that second, the multi-region fuser and the processor's signal start afresh: new `RppgProcessor.resetSignal()` drops the sample window, restarts the colour models and starts the WASM pipeline anew (old pipeline freed, tracker settings re-applied). Without it the window spans the gap, and since the analysis estimates its sample rate as samples over time spanned, every rate scales down by the share of the window that has samples. Calibration, the baseline, the Bayesian tracker and the rate history carry over.
- `requireFace: false` keeps the previous behaviour; `video_frame` mode and an explicit `roi` are unchanged. README and llms.txt describe this.

Tests (rppg-web jest on this branch: 46 suites, 370 tests). On 49fdb41 the new files fail, two of them before any assertion runs, because they use the new option and methods: `demoRunnerNoFace.test.ts` stops at TS2339 (`faceAbsentMs`) and TS2353 (`requireFace`), `demoRunnerFaceGap.test.ts` at TS2353. `sessionNoFace.test.ts` compiles on main and fails by assertion (84 where null is expected). The numbers below for main come from running the same frames through main's dist (`face-gap.mjs` above, and a 60-frame wall run), not from those files.

- `demoRunnerNoFace.test.ts`: no frame without a face is read (on main's dist the same 60 wall frames are all read from the centre square, 60 of 60); the absence is timed from the first frame without a face; whole-frame mode still reads the centre; the signal restarts when the face returns after a second or more and not after a shorter miss; an empty frame is `frame_invalid`, not `no_face`; and a processor without `resetSignal` (every other processor call in `DemoRunner` is checked with `typeof`) keeps being fed after the face returns. That last test was added after review: without the check, the first face frame after the gap threw `TypeError`, the gap was never cleared, and every later frame threw too (60 of 60), with nothing pushed and `onError` never called.
- `sessionNoFace.test.ts`: the no-reading shape field by field.
- `demoRunnerFaceGap.test.ts`, a known answer through the real processor (the JS estimators; jest has no WASM): a 66 bpm colour pulse, the face gone for 10 s, then back. With the restart removed the rate after the gap reads 51, which is 66 times the share of a 45 s window that holds frames (35 of 45); with it, within 3 of 66. The same fixture reads 66 before the gap, so the check can fail. The same run through the multi-region fuser also reads 66, and the fuser's SNR is measured afresh: 0 one second after the return, 15 if the fuser keeps its state.
- A session test with the real processor: under a second without a face the reading is held; after a second it is null with `no_face`; the face back reads again.
- `rppgProcessor.test.ts`: after `resetSignal()` the window estimates (spectral, ACF, peaks, HRV, breathing) equal those of a processor fed only the later samples. Leaving out any one step (window, either colour model, freeing the old pipeline, re-applying the tracker) turns it red.
- `createRppgSession.lifecycle.test.ts`: `requireFace` is on in `face_mesh` mode without a `roi`, off with a `roi`, with `faceMesh: "off"` and when FaceMesh fails to load, and a caller's value wins. Removing the wiring turns all four red.

The 1 s hold: on private recordings of still people at a webcam, 1 s rode out every face-finder interruption observed mid-capture, and the adapter's 600 ms would have blanked one (numbers in the private appendix). Not measured on people moving here; see "Moving heads" below. A miss shorter than the hold leaves a hole of that length in the window. On the same 66 bpm fixture, a 367 ms miss 15 s into a capture left the rate at 66, a 733 ms miss there moved it one spectral step (66 to 63, still 63 15 s later), and a 966 ms miss 50 s in moved the headline rate by under 1 bpm (65.6 against 66.3). After a gap of 1 s or more, the real engine (the reproduction above) shows a number again within 2 s of the face returning; with CHROM in the fuser the first three are off (87, 80, 73 for a true 66), with POS in the fuser none are. (An earlier version of this text said "once the window has refilled, within 35 s"; that came from the jest fixture's processor with the engine stubbed out, not from the real engine.)

Moving heads: measured through the same real engine on a synthetic face that turns away and back, looks down and back, or moves fast enough that the face finder drops frames (true 60, 72 and 100 bpm; face lost for 0.3 to 5 s; 3 seeds; 135 runs; pulse at 1.5 % green; a number counts as wrong when more than 5 bpm off). Summed over the runs, the 1 s hold shows a wrong number for 440 s against main's 774 s, and a right one for 2376 s against 2235 s. Holds of 0 and 0.5 s do worse (747 and 632 s wrong). A 2 s hold does better (325 s wrong, 2555 s right), and almost all of that comes from losses of 1 to 2 s: the 1 s hold restarts the signal there, and a window restarted on a head still settling shows wrong numbers for 1 to 11 s (median about 5 s) before it reads right, longer than the three numbers seen on a still face. At 100 bpm and at 1.5 s losses the 1 s hold shows slightly more wrong seconds than main (185 against 161, 125 against 117), for the same reason. The 1 s is kept in this PR; how often losses fall between 1 and 2 s decides whether 2 s is worth showing the old number one second longer. On our own recordings (private, owner recordings, 101 files, 3.7 hours), 20 moments where the face rows stop while the SDK keeps receiving samples: 17 under 1 s, one of 1.7 s, two of 5 to 6 s. Replayed through main and this branch they show no clear difference (wrong-or-off seconds 241 for main, 245 here), because the engine's own reading swings widely on those recordings with or without a gap.

**Considered: keep the window across the gap and make the rate estimate gap-proof instead of restarting.** The engine's Rust core already resamples by timestamp (`resample_rgb_into` in crates/elata-rppg/src/pipeline.rs), so only the JS window estimate (`analyzePulseWindow`, `fs = (n - 1) / duration`) scales with a hole. We tried the alternative: this branch with the restart off and `analyzePulseWindow` resampling its window by timestamp onto an even grid (linear across holes, as the Rust core does). Checked first on a known answer: a 66 bpm sine with a 3 s hole reads 66.0 with it and 48.0 without. Then the reproduction above, seeds 1 to 3, right in the 65 s after the return (wrong numbers):

| case | this PR (restart) | gap-proof estimate, no restart | gap-proof estimate and restart | 0.14.0 |
|---|---|---|---|---|
| same 66 bpm before and after, 10 s gap | 61 (3) | 65 (0) | not run | 31 (34) |
| same 66 bpm, 30 s gap | 61 (3) | 65 (0) | not run | 21 to 22 (43 to 44) |
| 80 bpm before, 66 after, 10 s gap | 62 to 63 (1 to 2) | 49 (16); reads 79 to 81 for 16 s | 62 (2) | 0 (65); reads 98 rising to 154 |
| 80 bpm before, 66 after, 30 s gap | 62 to 63 (1 to 2) | 59 (6) | 62 (2) | 19 to 21 (44 to 46) |

Keeping the old samples only wins when nothing changed while the face was gone; when the rate changed, the old samples are the wrong answer and the restart is what removes them. On top of the restart the gap-proof estimate adds nothing measurable here, so it is not in this PR. It would still be the right tool for holes shorter than the hold, but those already read right here (45 of 45 above).

Cost: with face tracking on and no `roi`, `getMetrics()` now reports no reading after 1 s without a face, where it reported a number before; that is the point of the change, and `requireFace: false` restores the old behaviour. Per frame, a no-face frame now returns before any sampling, so it costs less than before.

API: `no_face` is a new member of the exported `DemoRunnerDropReason` (exhaustive switches need a case), plus `requireFace`, `DemoRunner.faceAbsentMs()` and `RppgProcessor.resetSignal()`; a minor bump under 0.x. `roi_missing` exists and is never emitted; `no_face` was chosen to match the gating controller's vocabulary.

Follow-ups, not in this PR: `getDebugSnapshot().backendMetrics` stays raw processor output; `RppgSessionIssueCode` has no no-face entry; the `faceMesh: "off"` doc says "the full video frame" where the runner reads the same 100x100 crop; a gap in frames for any other reason (a stop and start, a stalled camera) leaves the same hole in the window, and `resetSignal()` is the tool for it.

### Merging with the other fixes

Re-checked on 2026-10-12 with this branch at 21b7326: merged into a scratch copy of the local merged tree (`wip/all-fixes` at 32ce8b1, all thirteen fixes) together with the updated `fix/pos-in-fuser` (564d589) and `fix/real-frame-rate` (bd72c7e), no conflicts; rppg-web jest 57 suites, 467 tests pass; `tsc` and Biome lint clean.

All ten proposed fixes were merged together locally, the way they would land one after another on 49fdb41, and tested as one tree. Every merge order gives the same 8 conflict hunks in 3 PRs (all six orders of the three PRs that share `demoRunner.ts` were measured), so the recommended order follows dependencies: this PR first, then the Rust sign fix, POS in the fuser (`fix/pos-in-fuser`), the real frame rate (`fix/real-frame-rate`), then the other six. Merged first, this PR needs no update; the two PRs that touch the same lines resolve their side (2 hunks in the POS PR, 3 in the frame-rate PR, all "keep both").

On the merged tree:

- Every test this PR adds passes and still goes red when its part is removed: frames without a face read from the centre square again (7 tests red), no restart when the face returns (3), the session reporting the last number (2), `requireFace` never set (4), `resetSignal()` keeping the old window (3).
- The restart works through the frame-rate fix's sample grid: a 1.5 s face gap at 15 fps leaves no grid sample drawn across it, and a 66 bpm pulse filmed at 15 fps reads within 3 of 66 before a 10 s gap and again after it. A new test pins this (`demoRunnerFaceGapGrid.test.ts`, proposed for the frame-rate PR); it goes red if the restart is removed, or if the grid's 250 ms stall limit is ever raised above this PR's 1 s hold.
- One sentence above changes once the frame-rate fix is in. "A miss shorter than the hold leaves a hole of that length in the window" stays true on the single-region path. On the multi-region path, a miss whose gap between face frames is 250 ms or less is filled in by the grid, by linear interpolation as for a slow camera; only longer misses leave a hole.
