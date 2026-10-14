## Issue: the multi-region fuser adds the frame-to-frame wobble of CHROM's weight to the pulse

**Who is affected.** Every app that calls `createRppgSession()` and gets a face: with `faceMesh` left at `"auto"` and MediaPipe loading, the session runs in `face_mesh` mode, `multiRoiFusion` and `useSkinMask` default to on, and `DemoRunner` feeds the processor through `pushFusedSample`. On that path the fused pulse from `MultiRoiRppgFuser` is the only signal the processor receives, from the first frame on: the fuser returns a valid sample as soon as one region has skin, and its 3 s warm-up only delays the SNR weights. Direct users of `MultiRoiRppgFuser` are affected the same way. The published `@elata-biosciences/rppg-web` 0.14.0 carries the same fuser (`dist/multiRoiFusion.js` is byte-identical to main's build) and the same `ChromPulseModel`, so released apps have it today. It reaches the rate apps read: end to end with the real WASM core, a synthetic 120 bpm pulse is reported right in 0 of 150 seconds on main (table under Tests below).

**How it works today.** For each region the fuser calls `ChromPulseModel.process(r, g, b)` and band-passes the result (multiRoiFusion.ts). `ChromPulseModel` divides each channel by its mean over the last 45 samples, forms X = 3R - 2G and Y = 1.5R + G - 1.5B, and returns the newest X - alpha * Y with alpha = sd(X) / sd(Y) (rppgSignalModel.ts).

Each normalised channel averages exactly 1 over the window, so each axis averages the sum of its weights: 3 - 2 = 1 for X and 1.5 + 1 - 1.5 = 1 for Y. Every output sample therefore contains the term (1 - alpha). Alpha is re-estimated from the window on every frame, so each frame-to-frame change in alpha reaches the output at full size. The band-pass that follows is linear and time-invariant: it removes a constant (1 - alpha), but not the part of alpha's variation that falls in the heart-rate band.

The size, on the fixture below (each of the three regions, seeds 1 to 5, last 10 s): alpha's frame-to-frame change has a standard deviation of 0.04 to 0.05. After the fuser's band-pass, the (1 - alpha) term has a standard deviation of 0.043 to 0.066, and everything else in the output (pulse plus noise) 0.0034 to 0.0039. The leak is 12 to 20 times the pulse.

The paper method does not have this term: de Haan and Jeanne (IEEE TBME 60(10), 2013) band-pass X and Y before computing alpha and combining them, which removes the constant. The rPPG-Toolbox reference implementation does the same (`Xf = filtfilt(B, A, Xs)`, `Yf = filtfilt(B, A, Ys)`, `Alpha = std(Xf) / std(Yf)`). This SDK already has the correct form in another module: `pulseProjection` in waveformFeatureWindow.ts subtracts 1 from each normalised channel before applying either projection.

**Reproduce (no data needed).** From the repo root, after `pnpm --filter @elata-biosciences/rppg-web build`, save this as `repro.mjs` and run `node repro.mjs`. It feeds a 72 bpm pulse along the blood-volume colour direction (0.33, 0.77, 0.53; de Haan and van Leest 2014), 0.4% deep, with sensor noise of 0.1 grey level per channel and no light change, into three identical regions for 20 s at 30 fps, and prints the spectral peak of the last 10 s of `fused` for seeds 1 to 5.

```js
import { MultiRoiRppgFuser } from "./packages/rppg-web/dist/multiRoiFusion.js";
import { ChromPulseModel } from "./packages/rppg-web/dist/rppgSignalModel.js";
const fs = 30;
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const sd = (a) => Math.sqrt(mean(a.map((v) => (v - mean(a)) ** 2)));
const rng = (s) => () => (s = (s * 1664525 + 1013904223) >>> 0) / 0xffffffff;
const gauss = (r) => { let u = 0; while (u === 0) u = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r()); };
function peakBpm(x) {
  let best = 0, bestHz = 0;
  for (let hz = 0.7; hz <= 3.5; hz += 0.01) {
    let re = 0, im = 0;
    x.forEach((v, i) => { const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (x.length - 1));
      re += w * v * Math.cos((2 * Math.PI * hz * i) / fs); im += w * v * Math.sin((2 * Math.PI * hz * i) / fs); });
    if (re * re + im * im > best) { best = re * re + im * im; bestHz = hz; }
  }
  return Math.round(bestHz * 60);
}
function read(projection, seed) { // on main the fourth argument does not exist and is ignored
  const fuser = new MultiRoiRppgFuser(fs, 8, 0.5, projection), r = rng(seed), out = [];
  for (let i = 0; i < 600; i++) {
    const p = 0.004 * Math.sin((2 * Math.PI * 1.2 * i) / fs);
    const s = () => ({ r: 180 * (1 + 0.33 * p) + 0.1 * gauss(r), g: 120 * (1 + 0.77 * p) + 0.1 * gauss(r), b: 100 * (1 + 0.53 * p) + 0.1 * gauss(r) });
    out.push(fuser.pushFrame({ forehead: s(), leftCheek: s(), rightCheek: s() }).fused);
  }
  return peakBpm(out.slice(-300));
}
const row = (label, projection) => console.log(label.padEnd(44), [1, 2, 3, 4, 5].map((s) => read(projection, s)).join(", "));
row("default projection", undefined);
row('CHROM (main\'s default; "chrom" on the branch)', "chrom");
// ChromPulseModel with the window mean of X and Y removed before combining; nothing else changed.
ChromPulseModel.prototype.process = function (r, g, b) {
  const q = (this.q ??= []); q.push([r, g, b]); if (q.length > 45) q.shift(); if (q.length < 10) return 0;
  const m = [0, 1, 2].map((c) => mean(q.map((v) => v[c])));
  const X = q.map((v) => (3 * v[0]) / m[0] - (2 * v[1]) / m[1]);
  const Y = q.map((v) => (1.5 * v[0]) / m[0] + v[1] / m[1] - (1.5 * v[2]) / m[2]);
  return X.at(-1) - mean(X) - (sd(X) / sd(Y)) * (Y.at(-1) - mean(Y));
};
row("CHROM with mean(X), mean(Y) removed", "chrom");
```

Output on main (49fdb41), and the same against the published 0.14.0 package's `dist/`:

```
default projection                           99, 50, 67, 109, 63
CHROM (main's default; "chrom" on the branch) 99, 50, 67, 109, 63
CHROM with mean(X), mean(Y) removed          72, 72, 72, 72, 72
```

On this PR's branch the first row reads 72, 72, 72, 72, 72 (POS) and the other two rows are unchanged.

The window is 45 samples in all three rows, so window length is not the cause. Removing the two window means, and nothing else, is enough. The same holds with a light change and no sensor noise, where each run is deterministic: through the same fuser, a slow 3% brightness swing at 0.3 Hz reads 84 on a true 66, and an in-band 2% swing at 1.5 Hz reads 156 on a true 66; with the window means removed, and with POS, both read 66. With a 5% brightness swing and sensor noise together (seeds 1 to 5; a 0.25 Hz swing with 0.1 grey level of noise for the true 50, a 0.4 Hz swing with 0.2 for the true 100), a true 50 reads 65 and a true 100 reads 76 or 77; with the window means removed, and with POS, both read the true rate within 1 bpm.

## PR: feat(rppg-web): project fused regions with POS by default

Closes the issue above.

**What changes**

- `MultiRoiRppgFuser` projects each region with the new `PosPulseModel` by default: POS (Wang, den Brinker, Stuijk and de Haan, "Algorithmic principles of remote PPG", IEEE TBME 64(7), 2017), S1 = G - B, S2 = G + B - 2R, h = S1 + (sd S1 / sd S2) S2, streamed over the same 45-sample window, newest sample out. Each POS axis sums to zero (0 + 1 - 1, 1 + 1 - 2), so S1 and S2 average zero over the window and there is no constant for the per-frame weight to multiply: its frame-to-frame change only rescales a pulse-sized deviation. The same property cancels a brightness change exactly.
- The output is negated so the waveform keeps the orientation CHROM gave the same pulse: `detectPeaks` (pulseAnalysis.ts) picks maxima, so a flipped waveform would put the detected beats on the opposite extreme of each cycle.
- New option `fusionProjection: "pos" | "chrom"` on `createRppgSession`, `DemoRunner` and the fuser's constructor (fourth argument). `"chrom"` keeps the previous output reachable: over five noisy seeds, with regions dropping out, a low-skin region and a reset mid-run, every field it returns (`fused`, `valid`, `weights`, `snr`, `fusedSnr`) is bit-identical to main's fuser on every frame.
- `DemoRunner` now passes `undefined` for the fuser's window, weight cadence and projection, so each default lives only in the fuser. The fuser's per-region field is renamed `projection` and typed by a small `{ process, reset }` interface.
- `PosPulseModel` and the `FusionProjection` type are exported next to `ChromPulseModel`.
- README (multi-ROI paragraph), the fuser header, the `DemoRunner` option docs and comments, and the `pushFusedSample` doc no longer describe CHROM as the fuser's projection.
- On that path the rate and the `signal_quality` that `getMetrics()` reports change with the fused pulse (`signal_quality` there is the fuser's SNR). End-to-end numbers are under Tests.
- Minor changeset: a 0.x package whose default output changes. The changeset release plan (`changeset status`) is the same on main and here, because main already carries minor changesets for rppg-web.

This follows Elata's own plan: docs/rppg-multi-roi-learned-reconstruction.md calls POS the "First-class baseline for the multi-ROI path", and docs/rppg-model-evaluation.md lists "three-region multi-ROI POS fusion".

**What does not change**

- `ChromPulseModel` (see the follow-up below), and so the non-fused paths: fusion off, the skin mask off, frames without sub-ROIs (`video_frame` mode), and the processor's own RGB analysis. An explicit `roi` option does not turn fusion off when frames carry sub-ROIs, on main or here.
- The fuser's band-pass, SNR weighting, 8 s buffer, 0.5 s weight cadence and 45-sample projection window.
- Cost: about 1.1 to 1.3 microseconds per `PosPulseModel.process` call against 1.2 to 1.6 for `ChromPulseModel` (three runs on one machine).

**Tests**

- `createRppgSession.fusion.test.ts` (new, 3 tests). A session created with no options except the video: the face finder, the camera and the WASM core are stubbed, while `createRppgSession`, `DemoRunner`, the fuser and `RppgProcessor` are real. It is fed 20 s of 30x30 synthetic frames whose pixels carry the 72 bpm pulse above plus one grey level of per-pixel sensor noise (about 0.1 level per channel after each 100-pixel region is averaged), rounded to integers as a camera delivers them. All 600 frames must go through the fuser and the processor must receive exactly those 600 samples, and the spectral peak of the last 10 s must be within 2 bpm of 72. The test checks the pulse the processor receives, not the rate it reports, because the reported rate also depends on the WASM core and the estimator, which this PR does not touch (the end-to-end script below checks the reported rate). It uses no new API, so it compiles on main.
  - On main it fails all three by assertion: off by 19.2, 33.6 and 12.6 bpm. Here it passes, off by 0.0.
  - Seeds 2 to 4 are the first three seeds on which main fails; seed 1 happens to read right on main. Over seeds 1 to 20 at the same settings: this branch is off by 0.0 bpm on all 20; main is within 2 bpm on 2 (seeds 1 and 20) and off by 4.2 to 67.2 bpm on the other 18.
- `posPulseModel.test.ts` (7 tests): sensor noise alone keeps the output at the scale of the noise (standard deviation under 0.005; CHROM's arithmetic gives 0.14 to 0.16 on the same seeds), a pulse is recovered under a brightness swing ten times its size, the waveform has CHROM's orientation, a brightness change alone gives no output (a property CHROM shares), and the fuser uses POS by default and CHROM only when asked.
- `demoRunner.test.ts` (+1): with pulse-carrying frames, the default fused samples equal those with `fusionProjection: "pos"` and differ from `"chrom"`.
- `createRppgSession.lifecycle.test.ts` (+1): `fusionProjection` reaches `DemoRunner`.
- `exports.test.ts` (+1): `PosPulseModel` is exported from the package entry.
- `fusionChromGolden.test.ts` (new, 2 tests): `fusionProjection: "chrom"` reproduces the fuser on 49fdb41. The test feeds a fixed input (a region dropping out, a region below the skin threshold, a reset part way through) and compares a summary of every output field with the one 49fdb41's built fuser prints for the same input; the published 0.14.0 prints the same summary. Changing CHROM's window by one sample, or wiring `"chrom"` to POS, turns it red; the second test checks that the default does differ, so the first can fail. Beyond the test: over 5 seeds of noisy input with the same dropouts and reset, `"chrom"` output equals main's bit for bit in 4500 of 4500 frames, and the same comparison with `"pos"` differs in 4410.
- These last four files use the new class or option, so on main they stop at compile errors (TS2305, TS2554, TS2353, TS2339) rather than assertions.
- Mutations, each run against the four touched behaviour test files plus `multiRoiFusion.test.ts` (40 tests), and the last one against `exports.test.ts`:

| mutation | tests that go red |
|---|---|
| `DemoRunner` defaults to `"chrom"` again | session known answer (3), `DemoRunner` default |
| `createRppgSession` stops passing `fusionProjection` | lifecycle pass-through |
| fuser constructor defaults to `"chrom"` | session known answer (3), `DemoRunner` default, fuser default |
| `PosPulseModel` returns CHROM's output | session known answer (3), noise scale (3), brightness swing, `DemoRunner` default, fuser default |
| sign flip removed | orientation |
| POS without per-window mean normalisation | session known answer (3), noise scale (3), brightness swing |
| `DemoRunner` skips the fuser for the first 10 s | session known answer (3), two `DemoRunner` fusion tests |
| `PosPulseModel` export removed from index.ts | exports (compile error) |

**End to end with the real WASM core (a script, not a committed test).** The tests above check the pulse the processor receives. This checks the rate `getMetrics()` reports, which also goes through the processor's estimators and the WASM core. The jest suite runs without the WASM build (CI's web-tests job does not download it), so the script takes the WASM from the published 0.14.0 package (its Rust core is unchanged on main) and drives what `createRppgSession` builds once a face is found: `DemoRunner` with fusion and the skin mask on, `RppgProcessor` with the tracker on, the same synthetic frames as the session test, 60 s each, polled once a second like an app. A second counts as right within 5 bpm. Counts are over the last 30 s of each run.

| input | main (49fdb41) | this PR |
|---|---|---|
| 72 bpm pulse, seeds 1 to 10 (300 s) | right 100, no number 59 | right 300, no number 0 |
| 120 bpm pulse, seeds 1 to 5 (150 s) | right 0, no number 39 | right 150, no number 0 |
| no pulse, seeds 1 to 5 (150 s) | a number in 105 (42 of them within 5 of 72) | a number in 78 |

Heart-rate variability changes with the waveform, so it was checked the same way: on the 72 bpm rows above (a pure sinusoid, so the true beat-to-beat variation is about 0), `hrv_rmssd` from `getMetrics()` over the last 30 s, seeds 1 to 5, has a median of 113 to 179 ms per seed on main and 14 to 20 ms here. Breathing (the respiration estimate) was not measured; it reads a slower band of the same waveform, and we have no breathing-modulated known answer for it yet.

With no pulse, main lands within 5 bpm of 72 in 42 of 150 seconds, so its 72 bpm row is close to chance; the 120 bpm row, far from where an empty signal lands, is the clean comparison. Neither version reliably withholds a number when there is no pulse; that is the estimator's job and this PR does not touch it. `signal_quality` in this mode is the fuser's SNR: averaged over the last 30 s (seeds 1 to 3), main gives 0.77 to 0.91 with the pulse and 0.85 to 0.91 without, so it does not separate them; this PR gives 1.00 with the pulse and 0.46 to 0.61 without.

<details><summary>e2e.mjs</summary>

From the repo root, after the build: `npm pack @elata-biosciences/rppg-web@0.14.0 && mkdir rppg-web-0.14.0 && tar xzf elata-biosciences-rppg-web-0.14.0.tgz -C rppg-web-0.14.0`, then `node e2e.mjs <true bpm> <pulse depth> <seed>` (for example `node e2e.mjs 120 0.004 1`; depth 0 is the no-pulse case).

```js
import { readFileSync } from "node:fs";
import { DemoRunner } from "./packages/rppg-web/dist/demoRunner.js";
import { RppgProcessor } from "./packages/rppg-web/dist/rppgProcessor.js";
import { initSync, WasmRppgPipeline } from "./rppg-web-0.14.0/package/pkg/rppg_wasm.js";
initSync({ module: readFileSync("./rppg-web-0.14.0/package/pkg/rppg_wasm_bg.wasm") });
const [bpm, depth, seed] = process.argv.slice(2).map(Number);
const rng = (s) => () => (s = (s * 1664525 + 1013904223) >>> 0) / 0xffffffff;
const gauss = (r) => { let u = 0; while (u === 0) u = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r()); };
const r = rng(seed), source = { onFrame: null, async start() {}, async stop() {} };
// What createRppgSession builds by default once a face is found, minus the camera.
const processor = new RppgProcessor({ newPipeline: (fs, w) => new WasmRppgPipeline(fs, w) }, 30, 10, {});
processor.enableTracker(55, 150, 200);
const runner = new DemoRunner(source, processor, { sampleRate: 30, roiSmoothingAlpha: 0.25, useSkinMask: true });
await runner.start();
const rois = [{ x: 10, y: 0, w: 10, h: 10 }, { x: 0, y: 15, w: 10, h: 10 }, { x: 20, y: 15, w: 10, h: 10 }];
const shown = [];
for (let i = 0; i < 60 * 30; i++) {
  const p = depth * Math.sin((2 * Math.PI * (bpm / 60) * i) / 30), data = new Uint8ClampedArray(30 * 30 * 4);
  for (let px = 0; px < 900; px++) {
    for (const [c, v, d] of [[0, 200, 0.33], [1, 150, 0.77], [2, 120, 0.53]]) data[px * 4 + c] = v * (1 + d * p) + gauss(r);
    data[px * 4 + 3] = 255;
  }
  source.onFrame({ data, width: 30, height: 30, rois, timestampMs: (i * 1000) / 30 });
  if ((i + 1) % 30 === 0) shown.push(processor.getMetrics().bpm); // an app polling once a second
}
const last = shown.slice(-30);
console.log(`true ${bpm}, depth ${depth}, seed ${seed}: right ${last.filter((v) => v != null && Math.abs(v - bpm) <= 5).length}/30, no number ${last.filter((v) => v == null).length}/30`);
```

</details>

**Checks run**

- rppg-web jest: 46 suites, 365 tests pass.
- `tsc --noEmit` for source and for tests: clean. Package build and `verify-dist-esm`: pass. `audit:repo`: passes.
- Biome 1.9.4 on the touched source files: lint clean. `biome format` flags the same lines in demoRunner.ts (22) and rppgProcessor.ts (105) on main and here, none of them lines this PR touches; the other files are clean. Test files are outside Biome's scope (`biome.json` ignores `__tests__`).
- `changeset status`: the same release plan on main and here.

**Considered and not done**

- Repairing CHROM in the fuser instead of switching to POS. On the synthetic known answers above, CHROM with the window means removed reads right too. On private contributor-held recordings, POS was ahead of that repair (numbers in the private appendix (supporting only: a reviewer cannot rerun it, and nothing in this PR depends on it)). A repair of `ChromPulseModel` would also change the non-fused processor path, which is a separate change (next section).
- CHROM as de Haan and Jeanne publish it (X and Y band-passed before alpha, 1.6 s Hann windows, overlap-add). On private contributor-held recordings it ties POS (numbers in the private appendix (supporting only: a reviewer cannot rerun it, and nothing in this PR depends on it)), so it is as good. We still propose POS because it drops into the fuser's per-sample structure unchanged (one sample in, one out, no filter state ahead of the projection, no overlap-add latency), because the engine's Rust core already uses a POS-style projection (docs/rppg-multi-roi-learned-reconstruction.md), and because it leaves `ChromPulseModel` untouched. If you prefer published CHROM, the measured case for the fuser is the same.
- POS as the paper writes it (overlap-add of 1.6 s windows) instead of this PR's streaming form (newest sample of a 45-sample window). On private contributor-held recordings the two read the same (supporting only: a reviewer cannot rerun it, and nothing in this PR depends on it). On our 50 webcam recordings through the whole fuser: the streaming form reads right in 29.9% of windows against 28.3% overlap-added (main's `analyzePulseWindow` on the last 8 s every 2 s, right within 5 bpm, region colours on the 30 Hz grid; overlap-add worse in 32 recordings, better in 13). So the streaming form costs nothing measurable, and on these recordings it is if anything slightly ahead.
- Sizing the POS window from `fs`. It stays at 45 samples, like `ChromPulseModel`; the docstring makes no claim about the paper's 1.6 s window.
- Dropping the `"chrom"` option. It is kept so the previous output stays reachable for comparison or rollback; happy to drop it if you prefer less surface.

**Follow-up, not in this PR: `ChromPulseModel` has the same defect**

`ChromPulseModel` is public, feeds the processor's own analysis on the non-fused RGB paths (`computeLocalRgbIntensity` in rppgProcessor.ts), and is what `fusionProjection: "chrom"` selects. The two-line repair (subtract mean(X) and mean(Y)) is not included because its effect on the non-fused path could not be measured fully here:

- That path's reported rate also depends on the WASM core, which the numbers below leave out (stub backend).
- Through `RppgProcessor.pushSampleRgb` with a stub backend, so only the processor's own analysis shows (same pulse and noise, 70 s, seeds 1 to 5): today `fused_bpm` is empty in 4 of 5 runs (84 in one) and the Bayes estimate reads 76 to 91. With the means removed, `fused_bpm` reads 72 in 3 of 5 runs and is empty in 2, but the Bayes estimate moves to 134 to 143, near twice the rate. The repair helps one estimate and exposes another problem.
- The processor's fallback `if (!Number.isFinite(chrom) || Math.abs(chrom) < 1e-6) return g;` would start firing on a zero-mean output (3 times in 10,455 samples in that run), splicing a raw green value (about 120) into a series of scale 0.005. It already does this for the first nine samples of every session, while `ChromPulseModel` returns 0.

That follow-up is proposal 11 (`fix/processor-colour-pulse`, text in fix11.md). It does not repair `ChromPulseModel`: it gives the processor's colour path an opt-in `rgbPulse: "pos"` (this PR's `PosPulseModel`, then the fuser's band-pass at the rate the samples arrive at, and no raw green while it warms up), so `ChromPulseModel`, `fusionProjection: "chrom"` and the bit-identical promise above stay as they are. It adds `PosPulseModel` with exactly this PR's text, so whichever of the two lands second merges it without a conflict.

**Our own measurement on real recordings (contributor-side, recordings cannot be shared)**

Removed from this public copy: it was measured on recordings whose licence does not allow sharing their numbers. The
private appendix holds the table and its scorer (ask Andreas Melhede). The public evidence for this PR is the
synthetic known answers above, which anyone can rerun.

**Merging:** open this PR from `pr/pos-in-fuser` (one commit on 49fdb41, deca8d7, the same tree as the working branch `fix/pos-in-fuser` at 564d589). The working branch has five commits; the first one's message predates the repo's commit convention and quotes measurements on recordings that cannot be shared. That commit is already public on the fork and stays there; the one-commit branch is what we ask you to review.

### Merging with the other fixes

Re-checked on 2026-10-12 with this branch at 564d589 (the `"chrom"` golden test added): merged into a scratch copy of the local merged tree with the updated fix 1 (21b7326) and fix 3 (bd72c7e), no conflicts; rppg-web jest 57 suites, 467 tests pass, the golden test included; `tsc` and Biome lint clean.

Recommended order: this PR third, after the no-face fix (`fix/no-face-no-reading`), whose lines it shares, and after the Rust sign fix. The real frame rate (`fix/real-frame-rate`), which asks for this PR first, is held from the first round. In the first round this PR is one of two that need an update (2 hunks here, 1 in the peer-range PR).

The first round (the eleven fixes being proposed, without the held frame-rate fix and the withdrawn fix 12) was merged in that order onto 49fdb41 and tested as one tree on 2026-10-12: rppg-web jest 53 suites, 437 tests pass; `tsc` both configs and Biome lint clean; with the fuser's default set back to CHROM there, 3 tests turn red. The earlier full-set checks (all ten fixes, then thirteen) are around this paragraph.

Update after `fix/no-face-no-reading` has merged: merge main into this branch (one commit on top, no force push) and resolve two hunks, both by keeping the two sides:

- `packages/rppg-web/src/demoRunner.ts`, `DemoRunnerOptions`: main adds `requireFace` right after `multiRoiFusion`, where this PR adds `fusionProjection`. Keep both, each with its own doc comment, `requireFace` first.
- `packages/rppg-web/src/rppgSession.ts`, the options `createRppgSession` passes to `new DemoRunner`: the same place. Keep both lines, `requireFace: options.requireFace ?? (faceTrackingMode === "face_mesh" && options.roi === undefined),` then `fusionProjection: options.fusionProjection,`.

Everything else, including the README and `createRppgSession.lifecycle.test.ts`, merges on its own.

On the merged tree:

- Every test this PR adds passes and goes red when its part is removed: CHROM as the default again (5 red), the POS output not negated (1), `DemoRunner` ignoring `fusionProjection` (1), the session not passing it (1). The no-face fix's multi-region gap test now runs on POS and passes.
- End to end through a WASM core built from the merged tree: POS against CHROM in the fuser, the core's own rate within 5 bpm in 77 of 108 reads against 14 of 108 (54 to 140 bpm, 30 and 15 fps, three seeds, reads at 15, 20 and 25 s), the same with the Rust sign fix and with main's Rust core. Polled once a second, as apps do, the reported rate with POS is within 5 bpm of the truth in 113 of 120 seconds from 20 to 39 s (114 and 140 bpm, three seeds each).
- With the frame-rate fix's grid (held from the first round), the slow-camera loss that PR measured goes away: see its section for the table.
