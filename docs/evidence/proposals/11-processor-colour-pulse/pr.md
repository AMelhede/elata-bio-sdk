# Fix 11: the processor's own colour path reads the wrong heart rate

Branch: `fix/processor-colour-pulse` on github.com/AMelhede/elata-bio-sdk, tip b748546, six commits on Elata main
49fdb41 (pushed 2026-10-12; the last two after a hostile review, see "A clipped frame"). Every commit message follows the repo's convention and none quotes private data, so the
branch itself can be opened; the local one-commit ref `pr/processor-colour-pulse` (9828923, same tree, parent 49fdb41,
not pushed) is there if a single commit is preferred. Either way, please squash-merge with the PR title.

This is the follow-up fix 4 promised for `ChromPulseModel` and the raw-green fallback, done another way: it does not
touch `ChromPulseModel`; it gives the processor's colour path an opt-in replacement (see "Considered and not done").

## Issue

**Title:** `RppgProcessor` reads colour samples at the wrong rate: raw green in its window, and CHROM's constant term

**Who hits it.** `RppgProcessor` analyses every colour sample (`pushSampleRgb`, `pushSampleRgbMeta`) with its own
estimators (spectral, autocorrelation, peaks, HRV) as well as passing it to the WASM core, and the rate it reports
is built from those estimates together with the core's own rate. Three groups feed it colour:

- apps that drive `RppgProcessor` directly, which the README offers for "direct sample ingestion";
- `createRppgSession` with `faceMesh: "off"` (the README's own diagnostics example), or with `faceMesh: "auto"` when
  MediaPipe fails to load, which the README says falls back to `video_frame` mode: every frame then goes through
  `DemoRunner` to `pushSampleRgbMeta`;
- `createRppgSession` in `face_mesh` mode for every frame it does not fuse: `multiRoiFusion: false`,
  `useSkinMask: false`, or a frame where no face region has skin.

The published 0.14.0 carries the same code (its Rust crates are also unchanged on main since that release).

**How it works today.** `computeLocalRgbIntensity` (rppgProcessor.ts) runs `ChannelGainController`, then
`ChromPulseModel`, and returns the raw green value whenever CHROM's output is not finite or below 1e-6 in size. Two
faults follow:

1. `ChromPulseModel` returns 0 for its first nine samples, so the processor stores raw green there: about 120 grey
   levels, where every later value stays under 0.53 in size over 30 s of the reproduction below, and the pulse in
   them is about 0.01. The processor keeps 45 s of samples, so that step sits in every window for the first 45 s and
   dominates the spectrum at its lowest frequency.
2. `ChromPulseModel` forms X = 3R - 2G and Y = 1.5R + G - 1.5B on window-mean-normalised channels. Each axis averages
   the sum of its weights, 1, so X - alpha Y carries a term (1 - alpha), and alpha is re-estimated every sample from
   unfiltered values. Its sample-to-sample change lands in the heart-rate band at full size (fix 4 describes the
   same term in the fuser). On the fixture below, CHROM's output after the fuser's 0.7 to 4 Hz band-pass has 2.8
   times the spread of the same arithmetic with the window means of X and Y removed.

Each alone is enough to break the rate. Patching main's processor in place (fixture below, silent engine, seconds 16
to 40, three seeds; share of seconds within 5 bpm, for true 50 / 72 / 120):

| main's processor with | spectral | autocorrelation | `bpm` |
|---|---|---|---|
| nothing changed | 0 / 0 / 0% | 0 / 0 / 0% | 0 / 0 / 0% |
| raw green removed, CHROM kept | 58 / 58 / 61% | 0 / 0 / 0% | 0 / 1 / 3% |
| CHROM's offset removed, raw green kept | 0 / 0 / 0% | 0 / 0 / 0% | 0 / 0 / 0% |
| both removed | 100 / 100 / 100% | 100 / 100 / 0% | 100 / 100 / 88% |

(The 0% autocorrelation at 120 in the last row is a separate weakness, below.)

**Reproduce (no data needed).** `npm i @elata-biosciences/rppg-web@0.14.0`, Node 20 or later. A clean pulse along the
blood-volume colour direction (0.33, 0.77, 0.53; de Haan and van Leest 2014), 0.77% deep at green, 0.05 grey levels of
noise per channel, read once a second as an app does, with an engine that never has a rate of its own:

```js
import { RppgProcessor } from "@elata-biosciences/rppg-web";
const idle = () => ({ bpm: null, confidence: 0, signal_quality: 0 });
const backend = { newPipeline: () => ({ push_sample_rgb() {}, get_metrics: idle }) };
let s = 1;
const u = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) + 0.5) / 2 ** 32;
const noise = () => 0.05 * Math.sqrt(-2 * Math.log(u())) * Math.cos(2 * Math.PI * u());
for (const [bpm, fps] of [[50, 30], [72, 30], [120, 30], [72, 20]]) {
  const p = new RppgProcessor(backend, fps, 10); // on this PR's branch: new RppgProcessor(backend, fps, 10, { rgbPulse: "pos" })
  for (let i = 0; i < 30 * fps; i++) {
    const t = (i * 1000) / fps, x = Math.sin((2 * Math.PI * bpm * t) / 60000);
    p.pushSampleRgb(t, 170 * (1 - 0.0033 * x) + noise(), 120 * (1 - 0.0077 * x) + noise(), 100 * (1 - 0.0053 * x) + noise(), 1);
    if ((i + 1) % fps === 0) p.getMetrics();
  }
  const m = p.getMetrics();
  console.log(`true ${bpm} at ${fps} fps: spectral ${m.spectral_bpm?.toFixed(1)}, bpm ${m.bpm?.toFixed(1) ?? "none"}`);
}
```

Output on 0.14.0, and identically on main (49fdb41) and on this branch with the option left out:

```
true 50 at 30 fps: spectral 84.0, bpm none
true 72 at 30 fps: spectral 84.0, bpm none
true 120 at 30 fps: spectral 84.0, bpm none
true 72 at 20 fps: spectral 84.0, bpm 100.0
```

On this branch with `{ rgbPulse: "pos" }`: spectral 51.0, 72.0, 120.0, 72.0 and bpm 50.9, 72.1, 119.9, 71.8.

The 84 is the bottom of the spectral band (42) doubled by the rule fix 5 removes; with fix 5 in, it reads 42. The
window itself shows fault 1, here with a colour that wobbles by 0.2 grey levels:

```js
const p = new RppgProcessor(backend, 30, 10);
for (let i = 0; i < 12; i++) p.pushSampleRgb(i * 33.3, 170 + 0.2 * Math.sin(i), 120 + 0.2 * Math.cos(i), 100, 1);
console.log(p.getTraceSnapshot().points.map((x) => x.intensity.toFixed(2)).join(" "));
// 0.14.0: 120.20 120.11 119.92 119.80 119.87 120.06 120.19 120.15 119.97 -1.07 -0.88 -0.97
```

## Pull request

**Title:** feat(rppg-web): add rgbPulse "pos" so the processor's colour path reads the rate

Closes the issue above.

**What changes**

- New option `rgbPulse?: "pos" | "chrom"` on `RppgProcessor`'s fourth constructor argument, passed on by
  `createRppgSession`. With `"pos"`, `computeLocalRgbIntensity` returns `RgbPulseExtractor.process(t, r, g, b)`:
  - POS (`PosPulseModel`, Wang, den Brinker, Stuijk and de Haan, IEEE TBME 64(7), 2017; 45-sample window, newest
    sample out). Its axes each sum to zero, so there is no constant for the per-sample weight to modulate.
  - Then the same `Bandpass(fs, 0.7, 4.0)` the multi-region fuser applies to each region, designed for the rate the
    samples actually arrive at: intervals per second over the last 45 timestamps, leaving out intervals over 250 ms
    (stalls; 4 a second cannot sample the band's 4 Hz top at all). The mean interval, not the median: camera frames
    arrive on a 16 ms clock (32, 48, 64 ms), where the median can sit several frames a second off the real rate. The
    filter is designed afresh when that rate moves by more than 10% (which moves the gain at 50 bpm by 0.63 dB; the
    comment shows the arithmetic).
  - 0 while POS warms up (its own neutral value), never a colour level.
  - A sample with R = G = B carries no colour to project. While every sample since the last reset has been like that
    (a signal already extracted, or a grey camera, pushed as g, g, g), it passes its own value, as it effectively did
    before (CHROM gives 0 there, so the fallback returned green). Once a colour sample has arrived, such a sample is a
    clipped or dropped frame: it gives 0 and does not enter POS or the rate clock (see "A clipped frame" below).
- `"chrom"`, the default, is the previous path, value for value (a test pins the window values).
- `RgbPulseExtractor` and `PosPulseModel` live in rppgSignalModel.ts. `PosPulseModel` is byte-identical to fix 4's
  (same text, same place), so whichever of the two lands second merges it without a conflict. Neither is added to the
  package entry: `PosPulseModel`'s export is fix 4's; `RgbPulseExtractor` is internal.
- `resetCalibration()` resets the extractor with the other per-sample models.
- Docs: a minor changeset; the README's low-level section says the processor reads colour with its own estimators and
  how to turn the option on, and why it is off; the option's doc comment on `RppgProcessor` and on
  `CreateRppgSessionOptions`.

**What does not change**

- The default path: with `rgbPulse` left out or `"chrom"`, every metric field of every read is unchanged. Checked
  against main's build through the session's colour path (the 24 runs of the end-to-end table below: 1416 reads,
  every field identical), by a test that pins the window values, and, on our side, on recordings (below).
- `ChromPulseModel`, `ChannelGainController` (both still exported and still used by the default), the fuser, the
  fused path (`pushFusedSample` never reaches this code), the WASM core, and every estimator downstream.
- The changeset release plan (`changeset status`) is the same as on main, which already carries minor changesets for
  rppg-web.

**The tradeoff, and why it is opt-in.** We wrote the rule for the default before measuring it: on by default only
if, against main, (1) no known answer reads right less often, (2) with no pulse at all, a number is not shown in more
than 15 points more seconds at any setting, and (3) it is better on our recordings. (1) and (3) hold; (2) does not,
for a processor read directly at 30 frames a second:

Direct `RppgProcessor`, published 0.14.0 WASM core, no tracker, read once a second, seconds 16 to 40, seeds 21 to 23.
Cells: share of seconds within 5 bpm of the true 50 / 72 / 120; then the share showing any number with no pulse.

| setting | main, 30 fps | `"pos"`, 30 fps | main, 20 fps | `"pos"`, 20 fps |
|---|---|---|---|---|
| 0.05 grey levels | 1 / 0 / 0%; 22% | 100 / 100 / 97%; 67% | 0 / 0 / 0%; 100% | 100 / 100 / 93%; 42% |
| 0.2 grey levels | 1 / 0 / 0%; 22% | 99 / 100 / 90%; 67% | 0 / 0 / 0%; 100% | 100 / 100 / 94%; 39% |
| 0.5 grey levels | 3 / 3 / 0%; 22% | 100 / 100 / 36%; 67% | 0 / 0 / 0%; 100% | 94 / 100 / 74%; 39% |
| brightness wander | 11 / 35 / 0%; 100% | 100 / 100 / 75%; 100% | 6 / 0 / 0%; 100% | 100 / 100 / 79%; 96% |

With an engine that never has a rate (only the processor's own estimators), main shows nothing at all at 30 fps and
about 100 for every input at 20 fps; `"pos"` is right in 90 to 100% of seconds (36% for 120 at 0.5 grey levels) and
shows a number with no pulse in 57 to 60% of seconds at 30 fps and 24 to 43% at 20 fps.

So main's lower no-pulse share at 30 fps comes with being wrong when there is a pulse; at 20 fps `"pos"` shows fewer
no-pulse numbers than main. The rule still fails, so `"chrom"` stays the default. Two readings point the other way
and are offered as information, not as the reason for anything here:

- Declared before the run as descriptive only: counting only reads at `confidence >= 0.45` (the threshold
  `RppgGatingController` uses for its stable value), pooled over every setting in the table, `"pos"` is right in 1607
  of 1728 pulse seconds and shows a number in 119 of 576 no-pulse seconds; main is right in 0 and shows a number in
  287. (The processor's own `reliable`, `confidence >= 0.5` with `signal_quality >= 0.35`, holds in no second for
  either.)
- Found after the rule was set (exploratory): through the session's own colour path, `"pos"` shows fewer no-pulse
  numbers than main (next section).

We think the default should become `"pos"` once the no-pulse question has its own fix in the estimator layer (see
"Seen along the way"), and would rather you decide that with these numbers than have it decided by this PR.

<details><summary>matrix.mjs (the direct processor table)</summary>

Set up as for e2e.mjs below, then `node matrix.mjs <pos|-> <wasm|silent>` (`-` leaves the option out; `silent` is
the engine that never has a rate). One line per setting, rate and input: seconds right within 5 bpm and seconds
showing any number, of 72 (3 seeds, seconds 16 to 40). Each cell of the table above is the three pulse lines and the
no-pulse line of one setting and rate, as percentages of 72. Run again on 2026-10-12 against main and this branch, both
engines: all 128 lines equal the counts the table was made from.

```js
import { readFileSync } from "node:fs";
import { RppgProcessor } from "./packages/rppg-web/dist/index.js";
import { initSync, WasmRppgPipeline } from "./rppg-web-0.14.0/package/pkg/rppg_wasm.js";
initSync({ module: readFileSync("./rppg-web-0.14.0/package/pkg/rppg_wasm_bg.wasm") });
const [mode, engine = "wasm"] = process.argv.slice(2); // mode: pos or - (option left out); engine: wasm or silent
const backend = engine === "silent"
  ? { newPipeline: () => ({ push_sample_rgb() {}, get_metrics: () => ({ bpm: null, confidence: 0, signal_quality: 0 }) }) }
  : { newPipeline: (f, w) => new WasmRppgPipeline(f, w) };
// Region-mean colour 170 / 120 / 100, pulse 1% along (0.33, 0.77, 0.53), Gaussian noise per channel; "wander" adds a
// common brightness change of 1% at 0.25 Hz plus a slow random walk. 40 s, read once a second, seconds 16 to 40.
function feed(bpm, fps, seed, noise, wander) {
  let s = seed >>> 0, walk = 0;
  const u = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) + 0.5) / 2 ** 32;
  const gauss = () => Math.sqrt(-2 * Math.log(u())) * Math.cos(2 * Math.PI * u());
  const out = [];
  for (let i = 0; i < 40 * fps; i++) {
    const t = (i * 1000) / fps, p = bpm > 0 ? Math.sin((2 * Math.PI * bpm * t) / 60000) : 0;
    let k = 1;
    if (wander) { walk = 0.999 * walk + (0.005 * gauss()) / Math.sqrt(fps); k = 1 + 0.01 * Math.sin((2 * Math.PI * 0.25 * t) / 1000) + walk; }
    const [r, g, b] = [170, 120, 100].map((c, j) => c * k * (1 - 0.01 * [0.33, 0.77, 0.53][j] * p) + noise * gauss());
    out.push({ t, r, g, b });
  }
  return out;
}
for (const [set, noise, wander] of [["0.05", 0.05, false], ["0.2", 0.2, false], ["0.5", 0.5, false], ["wander", 0.05, true]])
  for (const fps of [30, 20]) for (const bpm of [50, 72, 120, 0]) {
    let n = 0, shown = 0, right = 0;
    for (const seed of [21, 22, 23]) {
      const p = new RppgProcessor(backend, fps, 10, mode === "-" ? {} : { rgbPulse: mode });
      let next = 1000;
      for (const x of feed(bpm, fps, seed, noise, wander)) {
        p.pushSampleRgb(x.t, x.r, x.g, x.b, 1);
        if (x.t < next) continue;
        next += 1000;
        const m = p.getMetrics();
        if (x.t / 1000 < 16) continue;
        n++;
        if (m.bpm != null) { shown++; if (bpm > 0 && Math.abs(m.bpm - bpm) <= 5) right++; }
      }
      p.dispose();
    }
    console.log(`${mode} ${engine} noise ${set} ${fps} fps true ${bpm}: right ${right}/${n}, shown ${shown}/${n}`);
  }
```

</details>

**How it was tested**

- `processorRgbPulse.test.ts` (new, 20 tests), `RppgProcessor` with an engine that never has a rate, the reproduce
  feed with seed 12345, 30 s, read every 5 s (each read runs the whole window analysis, which is slow under jest;
  checked read every 1, 2 and 5 s on this branch and on main, every asserted answer is the same, and only the true
  120 at 30 fps withholds `bpm` at the end when read every 5 s, which its test allows):
  - true 72 and 50 at 30 fps, 50 and 72 at 20 fps: spectral estimate and `bpm` within 3; main reads spectral 84.0
    for every one, `bpm` none at 30 fps and 103.1 at 20 fps (100.0 read every second).
  - true 120: spectral within 3, and `bpm` within 3 or withheld, never wrong (main: 84.0, none).
  - `pushSampleRgbMeta` takes the same path; 20 frames a second into a processor built for 30 reads 50, 72
    (spectral and `bpm`) and 120 (spectral).
  - the window holds one quantity (no value above 1 in size; main's first nine are about 120).
  - R = G = B passes its own value and still reads 72 (passes on main too, by design).
  - one frame clipped white (255, 255, 255) at 10 s: that sample is 0, no window value is above 1 in size, and `bpm`
    reads 72 (main: spectral 102, `bpm` none).
  - `resetCalibration` restarts the extractor.
  - the default, left out or `"chrom"`, gives exactly the previous window values (passes on main too, by design).
  - `RgbPulseExtractor` alone: 0 for the first nine samples; equal to POS then `Bandpass(fs, 0.7, 4.0)` value for
    value at 30 and at 20 a second; a 20 a second clock gives a 20 a second filter; a 32/32/48 ms clock gives the mean
    rate (26.8), not the median (31.25); one 600 ms stall does not move the rate; an R = G = B sample passes its level
    while the stream has been grey and gives 0 after colour, until a reset; reset starts it afresh.
- `createRppgSession.lifecycle.test.ts` (+1): with `rgbPulse: "pos"` the session's processor gives POS's warm-up 0
  where the default gives raw green.
- On main both files stop at compile errors (TS2305: `PosPulseModel` and `RgbPulseExtractor` are not exported there;
  TS2353: unknown `rgbPulse`). Run with type-checking off, so main ignores the option, 19 of the 27 tests fail by
  assertion; the 8 that pass are the 6 existing lifecycle tests and the two pass-on-main tests above.
- Break on purpose, each run against both files; every one turns the named tests red:

| change | red |
|---|---|
| processor ignores the option | 11 (every processor known answer, the window, the clipped frame, `resetCalibration`, the session) |
| raw green while POS warms up | 15 |
| `ChromPulseModel` in the extractor instead of POS (band-pass kept) | 10 (7 known answers, the clipped frame, value for value at 30 and 20) |
| no band-pass | 2 (value for value at 30 and 20) |
| band-pass designed at a fixed 30 instead of the measured rate | 1 (value for value at 20) |
| median interval instead of mean | 1 |
| stalls counted in the rate | 1 |
| no R = G = B rule at all (grey samples go through POS) | 3 (grey stream, clipped frame, the extractor's grey test) |
| a grey sample always passes its level (the first version) | 2 (clipped frame, the extractor's grey test) |
| a grey sample always gives 0 | 2 (grey stream, the extractor's grey test) |
| reset keeps the "colour seen" flag | 1 |
| default becomes `"pos"` | 2 (default pin, session test) |
| `resetCalibration` does not reset the extractor | 1 |
| session drops the option | 1 |

  A clean synthetic pulse reads through an unfiltered POS, and through a filter designed for the wrong rate, so the
  band-pass is pinned value for value rather than by a known answer. Where it shows: at 0.5 grey levels, a true 72
  at 30 fps reads within 3 in 10 of 10 seeds with it and 5 of 10 without; on recordings it is most of the gain
  (below). It also costs something: near 50 bpm at 0.5 grey levels it reads a few beats high (54 to 56 in 3 of 10
  seeds), from the 0.7 Hz corner the fuser uses too.
- Full suites at b748546: rppg-web jest 44 suites, 371 tests (main 43 and 350); `tsc` for the build and the test
  config clean; `pnpm lint` clean; Biome format: no new findings (rppgSignalModel.ts clean; rppgProcessor.ts has 104
  lines of format drift on main and 99 here, none on lines this PR touches); package build and `verify-dist-esm`
  pass. Consumer Node smoke and `scripts/audit-repo.mjs` passed at 7aa4325 and were not re-run for the last two
  commits (one extractor line and tests). Not run: Rust tests (no Rust change), Playwright (no demo change).

**End to end through the session's colour path, with the real WASM core (a script, not a committed test).** What
`createRppgSession` builds with `faceMesh: "off"`: `DemoRunner` with the skin mask on and no face regions, so every
frame goes to `pushSampleRgbMeta`, and the processor at sampleRate 30 with the tracker on (55, 150, 200). WASM from
the published 0.14.0. Frames are 40 x 40 pixels of skin colour with the pulse along the blood-volume direction, 2 grey
levels of per-pixel noise, rounded to integers; 60 s, polled once a second; seconds right within 5 bpm, and seconds
showing any number, over the last 30 s of 3 seeds (90 seconds per cell):

| input | main, 30 fps | `"pos"`, 30 fps | main, 20 fps | `"pos"`, 20 fps |
|---|---|---|---|---|
| true 50 | right 0, shown 36 | right 90, shown 90 | right 0, shown 54 | right 90, shown 90 |
| true 72 | right 9, shown 53 | right 90, shown 90 | right 4, shown 61 | right 90, shown 90 |
| true 120 | right 0, shown 57 | right 87, shown 88 | right 3, shown 48 | right 78, shown 83 |
| no pulse | shown 50 | shown 30 | shown 48 | shown 40 |

The branch with the option left out matches main in all 24 runs. Here the session's tracker is on, unlike the direct
matrix above, and `"pos"` shows a number with no pulse in fewer seconds than main at both rates.

<details><summary>e2e.mjs</summary>

From the repo root, after the build: `npm pack @elata-biosciences/rppg-web@0.14.0 && mkdir rppg-web-0.14.0 && tar xzf
elata-biosciences-rppg-web-0.14.0.tgz -C rppg-web-0.14.0`, then `node e2e.mjs <pos|-> <fps> <true bpm> <seed>` (bpm 0
is the no-pulse case; `-` leaves the option out).

```js
import { readFileSync } from "node:fs";
import { DemoRunner, RppgProcessor } from "./packages/rppg-web/dist/index.js";
import { initSync, WasmRppgPipeline } from "./rppg-web-0.14.0/package/pkg/rppg_wasm.js";
initSync({ module: readFileSync("./rppg-web-0.14.0/package/pkg/rppg_wasm_bg.wasm") });
const [mode, fps, bpm, seed] = [process.argv[2], ...process.argv.slice(3).map(Number)];
let s = seed >>> 0;
const u = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) + 0.5) / 2 ** 32;
const gauss = () => Math.sqrt(-2 * Math.log(u())) * Math.cos(2 * Math.PI * u());
// What createRppgSession builds with faceMesh "off", minus the camera.
const processor = new RppgProcessor({ newPipeline: (f, w) => new WasmRppgPipeline(f, w) }, 30, 10, mode === "-" ? {} : { rgbPulse: mode });
processor.enableTracker(55, 150, 200);
const source = { onFrame: null, async start() {}, async stop() {} };
const runner = new DemoRunner(source, processor, { sampleRate: 30, roiSmoothingAlpha: 0.25, useSkinMask: true });
await runner.start();
const shown = [];
let next = 1000;
for (let i = 0; i < 60 * fps; i++) {
  const t = (i * 1000) / fps, p = bpm > 0 ? 0.004 * Math.sin((2 * Math.PI * bpm * t) / 60000) : 0;
  const data = new Uint8ClampedArray(40 * 40 * 4);
  for (let px = 0; px < 1600; px++) {
    data[px * 4] = 200 * (1 - 0.33 * p) + 2 * gauss();
    data[px * 4 + 1] = 150 * (1 - 0.77 * p) + 2 * gauss();
    data[px * 4 + 2] = 120 * (1 - 0.53 * p) + 2 * gauss();
    data[px * 4 + 3] = 255;
  }
  source.onFrame({ data, width: 40, height: 40, timestampMs: t });
  if (t >= next) { next += 1000; shown.push(processor.getMetrics().bpm ?? null); } // an app polling once a second
}
const last = shown.slice(-30);
console.log(`${mode} ${fps} fps, true ${bpm}, seed ${seed}: right ${last.filter((v) => v != null && Math.abs(v - bpm) <= 5).length}/30, shown ${last.filter((v) => v != null).length}/30`);
```

</details>

**A clipped frame.** The first version of this branch passed every R = G = B sample through, so one frame clipped
white (255, 255, 255) put 255 into a window of values near 0.01. Measured on the reproduce feed (true 72 at 30 fps,
40 s, read once a second, seconds 16 to 40, seeds 1 to 3, the engine with no rate and the published 0.14.0 core, in
grey levels and in `DemoRunner`'s 0 to 1 units; seconds right within 5 bpm, of 72):

| feed | main | first version, `"pos"` | this branch, `"pos"` |
|---|---|---|---|
| no clipped frame | 0 (any engine, either scale) | 72 | 72 |
| one clipped white frame at 10 s | 0 | 0 | 72 |
| five clipped white frames at 10 s | 0 to 3 | 0 to 2 | 72 |
| one frame of (255, 255, 250) or (255, 250, 240) | 0 to 1 | 72 | 72 |

So a grey sample now passes its level only while the stream has been grey since the last reset; after colour it gives
0 (the test "one clipped frame in a colour stream" is red on the first version and green here). A clipped frame that
is not exactly grey goes through POS, which normalises it away within its 45 samples, and costs nothing (last row).
What this costs: a colour stream that turns grey for good (a camera switching to a monochrome mode) gives 0 from then
on. Measured with 20 s of colour then 70 s of the same pulse pushed as g, g, g: in seconds 66 to 90 this branch shows
nothing with the engine that never has a rate, and the core's own rate with the real core (0 of 72 right; that is
the engine fallback fix 12 is about); the first version read 72 in all 72. Until then (seconds 20 to 45) the window
still holds the colour part and this branch reads 72 in 75 of 75 seconds, where the first version read it in 0 to
4. Calling `resetCalibration()` after such a switch starts a grey stream afresh. On our recordings, 6 of which carry such samples, the rule
moves nothing measurable (net 2 fewer right seconds of 6,679; "Our own observation" at the end).

**What it costs**

- CPU, measured in Node with the engine that never has a rate (60 s at 30 fps, median of 5 repeats, warm): pushing a
  colour sample 2.06 us with `"pos"` against 1.95 us on main (an earlier run of the first version: 2.25 against
  2.27, so the difference is within run-to-run spread); a read (`getMetrics()`, 45 s window) 143 to 164 ms on every
  arm. No measurable difference: the read is dominated by the window analysis both paths share.
- Tests: `processorRgbPulse.test.ts` takes about 27 s under `jest --runInBand` (57 s before it was trimmed to a read
  every 5 s); the whole rppg-web suite 56 s here against 34 s on main, on the same machine. Each processor known
  answer runs the whole window analysis per read, which is slow under jest.
- API: one optional field on two option types, no new package export; a second colour pulse model to maintain beside
  `ChromPulseModel`.
- Not a cost, measured because a fixed band-pass top could alias at low frame rates: at 6, 7, 8, 10 and 12 frames a
  second (the reproduce feed, 60 s, seeds 1 to 3, seconds 30 to 60, the engine with no rate), `"pos"` reads a true 50
  and a true 72 in 90 of 90 seconds at every rate, with no window value above 0.007; main reads them in 0 to 39.

**Considered and not done**

- On by default: fails the rule above (rule 2, direct processor at 30 fps). A narrower default, `"pos"` for sessions
  only, is supported by the session table but was found after the rule, so it is not proposed here.
- Repairing `ChromPulseModel` (subtracting the window means of X and Y) and dropping the fallback: it would change
  `fusionProjection: "chrom"` in the fuser and break fix 4's promise that `"chrom"` gives the previous output bit for
  bit, and the repaired CHROM has no measurement behind it on the processor's path.
- POS without the band-pass: reads the synthetic answers, but on our recordings it read worse than the published
  path (the earlier run on a test build, below).
- The band-pass at the processor's nominal `sampleRate`: in that same earlier run it gave back most of the gain,
  mostly on cameras under 22 fps.
- Exporting `RgbPulseExtractor` from the package entry: happy to add it if you want apps to build the same signal.
- Dropping `ChannelGainController` from the `"pos"` path is deliberate: POS divides each channel by its own window
  mean, which is what the gain was for.
- For a grey sample after colour, passing its level through again once 45 grey samples have arrived in a row (so a
  stream that turns grey for good reads again without a reset): measured on the same feeds, it keeps every clipped
  frame case at 72 of 72, but while the window holds both quantities it shows wrong numbers, 123 in seconds 20 to 45
  against none for the rule taken (127 against 72 over both switch feeds and both engines, where the 72 are the
  core's own rate through the fallback). We set "no more wrong numbers than the rule taken" before running it.
- The name `"chrom"` for the default: it is the previous path, CHROM with raw green while CHROM warms up or gives
  about 0, and the option's doc comment says so. If you prefer a name such as `"legacy"`, it is a one-word change.

**Seen along the way, not changed (each would move numbers on the default path too)**

- The processor's autocorrelation estimate halves clean rates above about 110 (a true 120 reads 60); its untrained
  calibration then averages that with the spectral rate, and on some feeds the estimators disagree and `bpm` is
  withheld. This is why the 120 tests assert the spectral estimate.
- The no-reading fallback (`bpm` from the fused, then the candidate, then the engine rate) passes the engine's rate
  through after the processor's own agreement test has refused. That and the agreement test are where a no-pulse
  number gets through; they are the place to fix the tradeoff above.
- The peak-count estimate is noisy on its own even with the band-pass (a true 72 at 0.2 grey levels reads 73 to 81).
- Every `getMetrics()` runs `pulseAnalysis.ts`'s `hilbertImag`, an O(N squared) DFT over the window: about 50 ms per
  read in Node and about ten times that under jest.
- On the default path in `face_mesh` mode, a frame the fuser cannot use sends a colour sample into a window of fused
  values; while CHROM warms up that sample is raw green. Not measured.

**Our own observation (not reproducible from the PR):** 50 recordings we hold, each with a reference rate, the mean
of the three face-region colours per frame fed to a processor through `pushSampleRgb` at the frame's own timestamp,
the published 0.14.0 core, `bpm` read once a second from 20 s, a second right within 5 bpm. The scorer checks itself
first (a synthetic 72 must read within 2 with `"pos"`, and the window must hold 45 s of samples; both checks were
broken on purpose and stopped it). Main's path (this branch's default) 15.6% of seconds right, `"pos"` 25.3%; 38
recordings better, 11 worse, 1 tied (sign test p = 0.00014); under 22 fps 14.8% against 23.1%, at 22 fps and over
16.7% against 28.3%. (Scored again at b748546. 411 of the 160,155 frames, in 6 recordings, are exactly R = G = B
and not zero: three clipped frames at 249, and runs of a constant level such as 35.4 for 99 frames. The grey rule
changes 3 recordings by a few seconds each, net 2 fewer right seconds than the first version's 1,694: the synthetic
clipped-frame failure above did not show on these recordings, and the rule neither helps nor hurts there.) Main and this branch's default gave the same value in every field of all 980 reads checked
(6 recordings). An earlier run on a test build with other fixes in place found the same shape: POS without the band-pass worse than the published path,
the band-pass at the nominal rate level with it, and at the measured rate clearly better. The recordings cannot be
shared, so this is context, not evidence for the PR.

### Merging with the other fixes

No textual conflict with any of the other ten fixes, alone or merged together: `git merge-tree` is clean against
each branch and against the local merged tree of all ten. `PosPulseModel` and the lifecycle test's
`import { DemoRunner }` line are identical to fix 4's, so the merged tree has each once.

One change git does not flag: fix 1 (`fix/no-face-no-reading`) adds `resetSignal()`, which restarts the per-sample
models it knows of (`channelGain`, `chromPulse`). After both have landed, add `this.rgbPulseExtractor.reset();`
after `this.chromPulse.reset();` in `resetSignal()` (and name it in that method's doc comment), with this test in
`processorRgbPulse.test.ts`:

```ts
test("resetSignal starts the colour pulse afresh with the window", () => {
	const p = run(feed(72, 30, 5), 30);
	p.resetSignal();
	for (const x of feed(72, 30, 1).map((s) => ({ ...s, t: s.t + 10000 }))) p.pushSampleRgb(x.t, x.r, x.g, x.b, 1);
	const trace = p.getTraceSnapshot(1000).points;
	expect(trace.length).toBe(30);
	expect(trace.slice(0, 9).map((x) => x.intensity)).toEqual(Array(9).fill(0));
});
```

It is red without the line (the nine values carry the band-pass state from before the gap) and green with it.
Whichever lands second carries it.

Fix 5 changes the number the default path's spectral estimate gets stuck on (84 on main, 42 with fix 5); the
changeset avoids the number for that reason. Fix 3's grid sends colour samples through the same
`pushSampleRgbMeta`, at camera or grid timestamps; the extractor measures the rate from whichever it gets.

On the merged tree (the ten fixes, the face-gap grid test, this branch, and the `resetSignal` line with its test):
rppg-web jest 53 suites, 441 tests (52 and 421 before this branch); `tsc` both configs and Biome lint clean. Re-checked
on 2026-10-12 after the last two commits, merged onto a copy of our local merged tree of all the fixes (which now also
carries fix 12 and fix 13): a clean merge, 55 suites and 463 tests all pass (461 before the two commits), `tsc` both
configs and Biome lint clean, and the first version's grey rule put back there turns the two grey tests red. Broken
there on purpose, each turns its tests red: the processor ignoring the option (11), `ChromPulseModel` in the
extractor (9), raw green in the warm-up (15), the fixed-30 band-pass (1), `resetSignal` without the line (1), the
session dropping the option (1).
