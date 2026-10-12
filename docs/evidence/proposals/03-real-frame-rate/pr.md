## Issue: the multi-region fuser runs at the camera's frame rate, not the `sampleRate` it is designed for

`MultiRoiRppgFuser` is a fixed-rate block. Everything in it is counted in samples at the `fs` it is built with (`DemoRunner` passes `sampleRate`, 30 by default):

- the band-pass biquads are designed for `fs` (`new Bandpass(fs, 0.7, 4.0)`, multiRoiFusion.ts);
- the spectral SNR behind the region weights and `fusedSnr` (which `pushFusedSample` turns into the fused path's `signal_quality`) uses a frequency axis built from `fs` (`spectralSnr(buf, this.fs)`);
- the CHROM window (45 samples), the SNR history (`fs * 8`), the warm-up (`fs * 3`) and the weight cadence (`fs * 0.5`) are sample counts.

`DemoRunner` calls `fuser.pushFrame()` once per delivered frame, and the delivered rate is not fixed. A UVC camera with auto-exposure priority may lower its frame rate to lengthen exposure (USB Video Class 1.5, Auto-Exposure Priority Control: "A value of 1 indicates that the frame rate may be dynamically varied by the device"), and `requestVideoFrameCallback` skips frames when the page is busy (WICG video-rvfc: `presentedFrames` "allows clients to determine if frames were missed").

At a delivered rate d, every frequency inside the fuser scales by d/fs and every time constant by fs/d. At 15 fps with `sampleRate` 30:

- the pass band becomes about 21 to 120 bpm instead of 42 to 240;
- the SNR band (0.7 to 3.5 Hz) becomes about 21 to 105 bpm, so region weights and the fused quality are judged on the wrong band;
- the warm-up doubles.

Above `sampleRate` it goes the other way: at 60 fps a 72 bpm pulse sits at 36 bpm on the fuser's axis, below its 42 bpm high-pass edge.

Measured on main through `DemoRunner` with a synthetic chromatic pulse (the seeded fixture in the PR's test, 20 s, amplitude taken at the true rate after 8 s):

| case | fused amplitude, relative to the same pulse at 30 fps | first non-zero fused quality |
|---|---|---|
| 160 bpm at 15 fps | 0.48 | 6.93 s (3.47 s at 30 fps) |
| 72 bpm at 60 fps | 0.63 | |

Both match the filter equations. The fuser's band-pass (second-order Butterworth sections at 0.7 and 4 Hz, designed for fs 30) passes 0.45 at 5.33 Hz against 0.92 at 2.67 Hz, a ratio of 0.49, and 0.59 at 0.6 Hz against 0.94 at 1.2 Hz, a ratio of 0.63.

**Reproduce on the published 0.14.0 (no data needed).** From the repo root, after `pnpm --filter @elata-biosciences/rppg-web build`: `npm pack @elata-biosciences/rppg-web@0.14.0 && mkdir rppg-web-0.14.0 && tar xzf elata-biosciences-rppg-web-0.14.0.tgz -C rppg-web-0.14.0`, save the script below as `grid-amp.mjs`, then `node grid-amp.mjs ./rppg-web-0.14.0/package/dist` and `node grid-amp.mjs ./packages/rppg-web/dist`. It drives `DemoRunner` with the test file's own fixture (a seeded chromatic pulse, three regions, 20 s) and a processor that records what it is given.

```
./rppg-web-0.14.0/package/dist: 160 bpm 15/30 0.48; 72 bpm 60/30 0.63; first quality 30 fps 3.47 s, 15 fps 6.93 s
./packages/rppg-web/dist:       160 bpm 15/30 0.94; 72 bpm 60/30 1.04; first quality 30 fps 3.47 s, 15 fps 3.47 s
```

Main (49fdb41) prints the same line as 0.14.0.

<details><summary>grid-amp.mjs</summary>

```js
const dist = process.argv[2];
const { DemoRunner } = await import(`${dist}/demoRunner.js`);
function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
function gauss(r) { const u = Math.max(1e-12, r()); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r()); }
const SIDE = 24;
function pulseFrame(t, bpm, r) {
  const width = SIDE * 3, height = SIDE, data = new Uint8ClampedArray(width * height * 4);
  const s = Math.sin(2 * Math.PI * (bpm / 60) * (t / 1000));
  const base = [200, 150, 120], depth = [0.33, 0.77, 0.53];
  for (let i = 0; i < data.length; i += 4) { for (let c = 0; c < 3; c++) data[i + c] = Math.round(base[c] * (1 - 0.01 * depth[c] * s) + gauss(r)); data[i + 3] = 255; }
  return { data, width, height, timestampMs: t, rois: [0, 1, 2].map((k) => ({ x: k * SIDE, y: 0, w: SIDE, h: SIDE })) };
}
const framesAt = (fps, n, start = 0) => Array.from({ length: n }, (_, i) => start + i * (1000 / fps));
async function film(fps, bpm, seconds, seed = 1) {
  const src = { onFrame: null, async start() {}, async stop() {} };
  const pushes = [];
  const proc = { pushFusedSample: (t, value, snr) => pushes.push({ t, value, snr }), getMetrics() {} };
  const runner = new DemoRunner(src, proc, { useSkinMask: true, sampleRate: 30 });
  await runner.start();
  const r = rng(seed);
  for (const t of framesAt(fps, Math.floor(seconds * fps) + 1)) src.onFrame(pulseFrame(t, bpm, r));
  await runner.stop();
  return pushes;
}
function amp(p, bpm) {
  const m = p.reduce((a, x) => a + x.value, 0) / p.length; let re = 0, im = 0;
  for (const x of p) { const ph = 2 * Math.PI * (bpm / 60) * (x.t / 1000); re += (x.value - m) * Math.cos(ph); im += (x.value - m) * Math.sin(ph); }
  return (2 * Math.hypot(re, im)) / p.length;
}
const settled = (x) => x.t > 8000;
const firstQ = (p) => p.find((x) => x.snr > 0)?.t;
const a30 = await film(30, 160, 20), a15 = await film(15, 160, 20);
const b30 = await film(30, 72, 20), b60 = await film(60, 72, 20);
// Self-check: the 30 fps run must carry the pulse (amplitude well above zero) or the ratios mean nothing.
if (!(amp(a30.filter(settled), 160) > 1e-4)) throw new Error("self-check: no pulse at 30 fps");
console.log(`160 bpm 15/30 ${(amp(a15.filter(settled), 160) / amp(a30.filter(settled), 160)).toFixed(2)}; 72 bpm 60/30 ${(amp(b60.filter(settled), 72) / amp(b30.filter(settled), 72)).toFixed(2)}; first quality 30 fps ${(firstQ(a30) / 1000).toFixed(2)} s, 15 fps ${(firstQ(a15) / 1000).toFixed(2)} s`);
```

</details>

Not affected: the processor's rate estimate. Its Rust core interpolates by timestamp onto its own grid (`resample_rgb_into` in crates/elata-rppg/src/pipeline.rs) and the JS window analysis derives its rate from timestamps (`analyzePulseWindow` in pulseAnalysis.ts). Only the fuser assumes evenly spaced input.

## PR: fix(rppg-web): resample multi-ROI fusion input onto the sampleRate grid

Closes the issue above.

**Status: open after fix 4 (POS in the fuser), or together with it.** On its own it fixes the fuser's band and warm-up. On the synthetic fixture it also makes resting rates read wrong more often on 15 to 24 fps cameras. That loss comes from the fuser's CHROM stage, not from the grid (see "Measured trade-off" below), and the POS stage in fix 4 removes it. No change to CHROM's window is proposed.

**What this buys once fix 4 is in, and what it does not.** Measured against fix 4 alone (POS in the fuser, no grid), which is the fair comparison since this PR asks for fix 4 first:

- It does not change the heart rate anyone reads. Synthetic: with POS, grid and no grid both read 60 of 60 windows at 15, 20, 24 and 30 fps (table at the end) and at 45 and 60 fps (50 to 150 bpm, two noise levels). The real engine at 15 fps (the 0.14.0 WASM core, `getMetrics()` once a second, 150 s per row): 66 bpm right 150 / 150 seconds, 120 bpm 150 / 149, 150 bpm 140 / 145 (no grid / grid). Time to the first right reading at 15 fps: median 2 s either way. Our own recordings (below): no measurable difference.
- It does change the fused quality, which is what an app reads as `signal_quality` on this path. Same pulse, fused SNR relative to the same pulse at 30 fps, seeds 1 to 5 (the merged-tree test below):

| camera, pulse | fix 4 alone | fix 4 and this PR |
|---|---|---|
| 15 fps, 160 bpm | 0.19 to 0.33 | 0.99 to 1.00 |
| 15 fps, 120 bpm | 0.22 to 0.33 | 1.00 |
| 20 fps, 140 bpm | 1.60 to 1.62 | 1.00 |
| 60 fps, 72 bpm | 2.77 to 2.78 | 1.00 |
| 60 fps, 50 bpm | 0.24 to 0.28 | 1.00 |
| 45 fps, 72 bpm | 1.04 | 1.00 |

  Without the grid the quality of one pulse depends on the camera: at 15 fps a 120 or 150 bpm pulse scores the same as no pulse at all (fused SNR 3.1 to 4.3 against 3.0 to 4.2 for no pulse; 15.1 with the grid), and the `signal_quality` the 0.14.0 processor reports from it is 0.50 to 0.63 (no pulse 0.48 to 0.66) against 1.00 with the grid. At 60 fps a 66 bpm pulse scores three times too high. An app that gates on quality would reject a good fast pulse on a slow camera and over-trust a fast camera.
- So this is a correctness fix of the fuser's input (a fixed-rate block fed at the wrong rate), and its observable gain is the quality figure; it is not a rate fix. If you would rather not take 237 lines for that, it can be dropped without losing any rate accuracy measured here.

**What changes (DemoRunner, fusion path only)**

- Each grid time between the previous frame and the current one gets the two frames' region values, linearly interpolated, and goes through the fuser. The processor gets one sample per grid time. Interpolating only between the previous and current frame adds no latency beyond one grid step.
- At exactly `sampleRate` this is one sample per frame; the existing suite passes unchanged.
- A gap over 250 ms is a stall: the grid restarts at the next frame instead of drawing a line across it. 250 ms is the frame interval of a steady 4 fps camera, which can still carry a pulse up to 120 bpm (its Nyquist limit).
- Above `sampleRate`, each grid time takes the line between the two frames around it, so frames in between are not averaged in (documented in the code). That gives up some white-noise SNR against averaging, up to about 3 dB at 60 fps, and is still far better than main, which reads every frequency at half its value there. Averaging per grid bin can follow if wanted.
- Grid times reach the processor in increasing order whenever frame timestamps increase. A frame whose timestamp does not increase, or is not a number, is pushed at its own timestamp, as on main, and the grid restarts from it. (The not-a-number case is stated as its own rule because the first version bridged it: one NaN timestamp became an interpolation weight and left NaN in the fuser's filters for the rest of the session.)
- When the fuser has no valid output for a grid time, or the processor has no `pushFusedSample`, the grid sample goes through the same fallback chain as every other path (`pushSampleRgbMeta`, `pushSampleRgb`, `pushSample`, then a `TypeError` reported as `processor_error`), now one shared helper.
- The fuser's own code is unchanged. Its `pushFrame` JSDoc now says it must be called once every 1/fs seconds on an even grid and points to `DemoRunner`.

**Measured with the PR (same fixture, reproducible with the new test file)**

| case | main | this PR | expected |
|---|---|---|---|
| fused amplitude, 160 bpm at 15 fps, relative to 30 fps | 0.48 | 0.94 | 0.92 (linear interpolation's gain at 2.67 Hz) |
| fused amplitude, 72 bpm at 60 fps, relative to 30 fps | 0.63 | 1.04 | about 1 |
| first non-zero fused quality at 15 fps (30 fps: 3.47 s) | 6.93 s | 3.47 s | 3.47 s |

The same fixture over seeds 1 to 6 at two noise levels (1 and 2 grey levels) gives a 160 bpm ratio at 15 fps of 0.44 to 0.54 on main and 0.85 to 0.99 with the change, so the test's 0.8 to 1.2 window does not depend on the seed.

**Measured trade-off: resting rates on slow cameras (explained; closed by fix 4)**

The table above is the fuser's response to a pulse. Reading a rate out of the fused output is a different question. Same fixture, 30 s per run, seeds 1 to 6, noise 1 grey level; the SDK's own window estimator (`analyzePulseWindow`) on 8 s windows ending every 2 s from 12 to 30 s; a window counts as right when its rate is within 5 bpm of the truth. Each cell is right windows out of 60, main / this PR (at exactly 30 fps the two are identical):

| true rate | 30 fps | 24 fps | 20 fps | 15 fps |
|---|---|---|---|---|
| 66 bpm | 54 / 54 | 53 / 48 | 54 / 41 | 56 / 38 |
| 96 bpm | 57 / 57 | 54 / 42 | 56 / 42 | 58 / 29 |
| 150 bpm | 51 / 51 | 55 / 57 | 43 / 51 | 29 / 29 |

Above `sampleRate` the change is a clear gain where main's band has moved past the pulse: 66 bpm reads right in 49 of 60 windows at 60 fps (main 7) and 60 at 45 fps (main 25). At 96 and 150 bpm it is mixed: 49 / 46 and 52 / 60 at 60 fps, 55 / 59 and 60 / 58 at 45 fps (this PR / main).

At 3 grey levels of noise the 96 bpm row is 20 / 9, 23 / 19 and 23 / 6 at 24, 20 and 15 fps (main / this PR). This PR's wrong readings are mostly low (51 to 69 bpm for a true 96 at 15 fps), which points below the pulse rather than at a harmonic.

Cause, tested by changing only that: the fuser's CHROM stage (`ChromPulseModel`, 45-sample window) recomputes its mixing weight every sample from the spread of the last 45 samples. Its output is `X - alpha * Y` with X and Y both near 1, so any wander in alpha comes straight through as a slow wave, and the 0.7 Hz high-pass only partly removes it. On the grid, 45 samples at 15 fps hold 22.5 camera frames, half of them interpolated, so alpha wanders more and faster. Give the fuser a CHROM window that holds 45 camera frames (90 grid samples at 15 fps, 68 at 20, 56 at 24) and keep everything else as in this PR:

| true rate | 24 fps | 20 fps | 15 fps |
|---|---|---|---|
| 66 bpm | 53 | 59 | 58 |
| 96 bpm | 57 | 60 | 60 |
| 150 bpm | 57 | 54 | 60 |

That matches or beats main in every cell, including 150 bpm at 15 fps, where main's shrunken band reads 29 of 60. On main the same 45 samples span 3 s of real frames at 15 fps, which is why main reads resting rates better at 15 fps than at 30.

Building the fuser for the camera's real rate instead (main's runner with `sampleRate` set to the delivered rate, so one sample per frame, a correct band and 45 camera frames in the CHROM window) reads about the same: 55, 57, 58 of 60 at 66 bpm; 57, 59, 60 at 96 bpm; 58, 54, 60 at 150 bpm (24, 20, 15 fps). It assumes evenly spaced frames at a known rate, which is the assumption the grid exists to drop.

The window length matters at 30 fps too, so it is not only this PR's problem: with a 90-sample CHROM window this PR at 30 fps reads 66 bpm in 60 of 60 windows (45 samples: 54) and 96 bpm in 60 (57); at 3 grey levels, 44 (19) and 56 (10). A steady synthetic pulse favours long windows, while a short one is what follows real motion and lighting changes, so changing the window for every camera needs real recordings behind it, not this fixture.

The processor's reported `bpm` (a real `RppgProcessor` behind `pushFusedSample`, engine stubbed to report no rate, `getMetrics()` at 14, 18, 22, 26 and 30 s, so 30 reads per cell) mostly withholds on both sides at these rates. Where it reports, main is right as often as or more often than this PR in every cell tried (15 and 20 fps; 66, 96 and 150 bpm). That instrument is dominated by the processor's own gating, so it is weak, but it shows no gain from this PR on its own.

**Why this is CHROM, not the grid.** CHROM's two axes carry a DC of about 1 each (X = 3R - 2G, Y = 1.5R + G - 1.5B on mean-normalised channels), and alpha is recomputed every sample from unfiltered values, so alpha's sample-to-sample wander is multiplied by that DC and lands in the band. POS's two axes (G - B and G + B - 2R) have zero DC, so the same wander cannot reach its output. A minimal check, independent of this PR: a noiseless synthetic pulse in the blood-volume direction reads its true 66 bpm through every combination tried (CHROM or POS, real frames or the grid, 15, 24 and 30 fps); add sensor noise of 0.05 grey levels (about 0.04%, far below a real camera's) and CHROM reads 51 to 69 at every frame rate, whether fed real frames or the grid, while POS reads 66 in every case.

**What we recommend.** Land fix 4 first, or with this one. Leave CHROM's window as it is: the window option above showed no gain on real recordings (next paragraph), and it would add a public option to `MultiRoiRppgFuser` for nothing measurable. Repairing CHROM itself (alpha from band-passed X and Y, as in the published method) is a separate question, and stops mattering once POS is the fuser's default.

**Our own observation (context, not evidence; the recordings cannot be shared):** 50 of our own webcam recordings (15 to 29 fps, a consumer wearable's reading as truth), the region colours fed through each variant's fuser, then main's own `analyzePulseWindow` (49fdb41) on the last 8 s of the fused signal every 2 s, a window right within 5 bpm, compared recording by recording with a sign test. Share of windows right: main 11.0%; this PR alone 12.8%; fix 4 alone 30.0%; fix 4 and this PR 29.9%. This PR alone against main: +1.7 points, better in 26 recordings and worse in 15, p 0.12, so no measurable difference. With fix 4 in, this PR against fix 4 alone: -0.1 points, 23 better and 20 worse, p 0.76; under 22 fps 26.3% against 26.0%. Through the full published engine instead (the 0.14.0 processor with its WASM core fed each fused signal, its `bpm` once a second after 20 s), seconds right out of all seconds: fix 4 alone 23.8%, fix 4 and this PR 25.5% (26 better, 24 worse, p 0.89). One observation we did not set out to test, so treat it as a lead and not a result: with the grid the engine shows a number in fewer seconds (80.7% against 86.5%, fewer in 38 of 50 recordings) and is right in more of the seconds it shows (31.6% against 27.5%, p 0.2), which is what a truer quality figure would do. (An earlier version of this paragraph quoted 8.3%, 11.4% and +3.1 points, p 0.011; those used a later build's `analyzePulseWindow`, not main's, and are withdrawn.)

All of this is a synthetic fixture; it says which way the change moves the fused signal, not what accuracy a person gets.

**Compatibility**

- No API change. `DemoRunnerDiagnostics` keeps its meanings: `samplesPushed` still counts frames (framesSeen = samplesPushed + droppedFrames, now documented), and `framesWithFusion` still counts frames and stays a subset of `framesWithMultiRoi`.
- Measured cost (Node, a loaded 4-core container, so ratios only; real 0.14.0 engine behind the processor, POS in the fuser): at 15 fps, `getMetrics()` takes 142 ms per call with the grid against 57 ms without (2.5 times), and the runner 6.25 ms against 4.0 ms per camera second; a 30 fps camera without the grid costs 132 ms and 6.1 ms. At exactly 30 fps the output equals main's to float rounding (grid times within 3.7e-10 ms, values within 1e-13).
- On the fused path the processor now receives `sampleRate` samples a second whatever the camera does, so its `totalSamplesReceived`, `windowSampleCount` and trace points count grid samples there (README and changeset say so). At 15 fps it holds twice as many samples (its 45 s local history goes from about 675 to about 1350), so each `getMetrics()` call has twice the data to work through, and the fuser does twice the work per second; that is what a camera running at `sampleRate` already costs. At 60 fps both hold half as many.
- Patch changeset: a bug fix with no API or diagnostics change.

**Considered and not done:** moving the resampling into `MultiRoiRppgFuser` (an optional timestamp on `pushFrame`). That fixes direct callers too, but `pushFrame` would then return zero or more results per call, which changes a public method's contract. Happy to do that instead if you prefer it.

**Tests** (`packages/rppg-web/src/__tests__/demoRunnerFrameGrid.test.ts`, 17 tests)

- Behaviour against the filter's known response: the 160 bpm amplitude ratio at 15 fps and the 72 bpm ratio at 60 fps are between 0.8 and 1.2 (main 0.48 and 0.63; seeds 1 to 5 give main 0.45 to 0.49 and 0.59 to 0.77, this PR 0.87 to 0.96 and 0.87 to 1.05); the fused quality warms up within one frame of the 30 fps time; a grid time halfway between frames at green 140 and 150 gets 145.
- A processor with only `pushSampleRgb` or only `pushSample` gets every grid sample with interpolated values, and `framesWithFusion` stays 0; one with no push method raises `processor_error`.
- Runner diagnostics at 15 and 60 fps: framesSeen = samplesPushed + droppedFrames, and framesWithFusion equals framesWithMultiRoi when every frame fuses.
- One NaN timestamp in a 30 fps pulse: every later fused value stays finite and the fused quality stays above 1.
- Grid spacing, a camera at `sampleRate`, a different `sampleRate`, ordering around a frame without regions, stalls, a clock that starts again from zero, and a stop and start.
- On main (49fdb41), 8 of the 17 fail. They pass here.
- Not here, on purpose: a test that the same pulse gets the same fused quality at 15, 30 and 60 fps. With CHROM in the fuser the per-seed spread is wider than the effect (quality ratio to 30 fps, seeds 1 to 5: this PR 0.64 to 0.92 at 15 fps and 160 bpm, main 0.49 to 1.11), so such a test would pass or fail by seed. With POS it separates cleanly and is proposed for the update after fix 4 (below). Each of the others goes red when the part of the change it guards is removed (the restart on a non-increasing or NaN timestamp, the reset on a frame without regions, the 250 ms stall rule, the reset in `stop()`, the fused-frame count).

**Checks run**

- rppg-web jest: 44 suites, 367 tests pass.
- `tsc --noEmit` for source and tests: clean. Package build and `verify-dist-esm`: pass. The built declarations differ from main only in doc comments and private members.
- Biome 1.9.4 on the touched files: lint clean. `biome format` flags 14 lines in demoRunner.ts against 18 on main, all in lines this PR does not touch; multiRoiFusion.ts is clean. (Test files are outside Biome's scope in biome.json.)
- `audit:repo` passes. `docs:mintlify:check` fails on main and here alike (`elata-docs/docs.json` is missing).
- No Rust changes.

**Out of scope:** no end-to-end heart-rate accuracy is claimed here; the rate-read numbers above come from a synthetic fixture. The fused path's final rate also depends on other parts of the pipeline that this PR does not touch. Also left alone: `rppgDiagnostics`' waveform debug helper reads `trace.sampleRate` (the configured rate) to space peaks, a smaller case of the same assumption on non-fused paths.

**Merging:** open this PR from `pr/real-frame-rate` (one commit on 49fdb41, ff1cc00, the same tree as the working branch `fix/real-frame-rate` at bd72c7e). The working branch has five commits; the first one's message predates the repo's commit convention, and its account of the cause (that the processor also assumed 30 fps) and its offline numbers are superseded by this description. That first commit is already public on the fork and stays there; the one-commit branch is what we ask you to review.

### Merging with the other fixes

All ten proposed fixes were merged together locally and tested as one tree. Recommended order: this PR fourth, after the no-face fix (`fix/no-face-no-reading`) and after POS in the fuser (`fix/pos-in-fuser`), as this PR asks. Every merge order gives the same 8 conflict hunks in 3 PRs (measured), so landing it after both costs nothing extra.

Update after both have merged: merge main into this branch (one commit on top, no force push) and resolve five hunks:

- `packages/rppg-web/src/demoRunner.ts`, above `export class DemoRunner`: main's `FACE_GONE_RESET_MS` and this PR's grid types and helpers. Keep both.
- `demoRunner.ts`, class fields: keep main's `noFaceSinceMs` and `noFaceLastMs` and this PR's `gridPrev`, `gridNextT` and `gridFused`.
- `demoRunner.ts`, `stop()`: keep both `this.noFaceSinceMs = null;` and `this.gridPrev = null;`.
- `demoRunner.ts`, the push in `onFrame`: keep this PR's version (`pushOnGrid` for frames with fusion regions, `pushToProcessor` otherwise). Main's wording from the POS fix goes into the fused branch of `pushOnGrid`: "Fused pulse already carries the per-region projection + SNR-weighted blending; feed it straight to spectral BPM/HRV, with the fused SNR as quality."
- `packages/rppg-web/README.md`, the multi-ROI fusion paragraph: keep main's (POS, `fusionProjection: "chrom"`) and append this PR's sentences about the grid.

Not flagged by git, still needed: with POS the default, the fuser's 45-sample window belongs to whichever projection is chosen. Write "projection window" for "CHROM window" in `pushOnGrid`'s doc comment, in the `pushFrame` doc comment this PR adds to `multiRoiFusion.ts`, and in the header comment of `demoRunnerFrameGrid.test.ts`.

Add one test, `demoRunnerFaceGapGrid.test.ts` (3 tests, kept on the local merged branch). At 15 fps, so the grid fills in samples: a face gap long enough for the no-face fix to restart the signal leaves no sample drawn across it, and the first sample after it is the returning frame's own; a face-finder miss of 200 ms between face frames is filled in and one of 667 ms is not, neither restarting the signal; a 66 bpm pulse reads within 3 of 66 before and after a 10 s gap. It goes red when the stall limit is raised to 5 s (2 tests), when the restart is removed (2), and when the grid never bridges (1). The restart and the grid agree only because 250 ms is below the no-face hold of 1 s; this test is what keeps it so.

Add a second test, `demoRunnerFrameGridQuality.test.ts` (2 tests): the same pulse, fused SNR at 15 fps (160 bpm) and at 60 fps (72 bpm) within 10% of the 30 fps figure. Red with fix 4 alone (0.19 and 2.77), green with this PR on top (1.00 and 1.00). It needs POS, so it can only land after fix 4. With the grid's bridging removed on the merged tree, both go red, as do 8 of the 17 tests in `demoRunnerFrameGrid.test.ts` and 1 of the 3 in `demoRunnerFaceGapGrid.test.ts`.

Re-checked on 2026-10-12 with the branch at bd72c7e, merged into a scratch copy of the local merged tree with the updated fix 1 and fix 4 plus the quality test: no conflicts, rppg-web jest 57 suites, 467 tests pass, `tsc` and Biome lint clean.

On the merged tree the 17 tests here pass; never bridging turns 8 red, and each of the other four guards (restart after a frame without regions, NaN timestamp, `stop()`, stall rule) turns its test red.

The trade-off above, with POS in place. This PR's own probe run on the merged tree (`analyzePulseWindow` on 8 s windows ending every 2 s from 12 to 30 s, six seeds, right within 5 bpm, out of 60). The merged tree includes the no-doubling fix, so the "no grid" column differs a little from the table above. Each cell: no grid with CHROM (main's runner) / grid with CHROM (this PR alone) / no grid with POS / grid with POS (this PR and fix 4):

| true rate, sensor noise | 30 fps | 24 fps | 20 fps | 15 fps |
|---|---|---|---|---|
| 66 bpm, 1 grey level | 59 / 59 / 60 / 60 | 53 / 53 / 60 / 60 | 54 / 52 / 60 / 60 | 56 / 39 / 60 / 60 |
| 96 bpm, 1 grey level | 57 / 57 / 60 / 60 | 52 / 42 / 60 / 60 | 56 / 42 / 60 / 60 | 58 / 28 / 60 / 60 |
| 150 bpm, 1 grey level | 51 / 51 / 60 / 60 | 55 / 57 / 60 / 60 | 43 / 51 / 60 / 60 | 29 / 29 / 60 / 60 |
| 66 bpm, 3 grey levels | 22 / 22 / 60 / 60 | 7 / 18 / 60 / 60 | 23 / 15 / 60 / 60 | 25 / 20 / 60 / 60 |
| 96 bpm, 3 grey levels | 9 / 9 / 60 / 60 | 12 / 9 / 60 / 60 | 22 / 18 / 60 / 60 | 16 / 4 / 60 / 60 |
| 150 bpm, 3 grey levels | 7 / 7 / 60 / 60 | 3 / 5 / 60 / 60 | 6 / 3 / 60 / 60 | 1 / 4 / 60 / 60 |

With POS every cell reads 60 of 60, at both noise levels, with the grid and without it, so the slow-camera loss this PR shows with CHROM does not appear once fix 4 is in. On this fixture the grid neither helps nor hurts the rate read with POS; its gains are the ones in the first table (amplitude and warm-up at the camera's real rate).
