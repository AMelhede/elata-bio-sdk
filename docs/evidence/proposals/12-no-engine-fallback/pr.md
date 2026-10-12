# Fix 12: `bpm` shows the core's raw rate after the processor's own checks refused one

Branch: `fix/no-engine-fallback` on github.com/AMelhede/elata-bio-sdk, tip 6894d3a, three commits on Elata main
49fdb41 (pushed 2026-10-12). Every commit message follows the repo's convention and none quotes private data, so
the branch itself can be opened; the local one-commit ref `pr/no-engine-fallback` (13793e5, same tree, parent
49fdb41, not pushed) is there if a single commit is preferred. Either way, please squash-merge with the PR title.

**Recommendation after a hostile review (2026-10-12): file the issue below, do not open this pull request.** The
option duplicates a field apps already have. With no Muse, main's `fused_bpm` equals this branch's `bpm` with
`engineFallback: false` in every read once the processor has 24 samples: 0 differences in 1,572 reads of the check
under "Considered" and in 5,440 reads of a wider run with the real core. So an app that wants only the numbers the
processor's checks passed can read `m.fused_bpm` today, and feed `{ ...m, bpm: m.fused_bpm }` to the gating
controller. What the option adds beyond that is the reads before 24 samples (under 1.6 s), and the narrower change
that would make those empty by default did not meet the bar we set for it on our recordings (under "Considered").
What is worth sending is the issue, with two corrections it points at: `fused_bpm`'s doc comment says it is "Same as
`bpm` when no external source is active", which is false in every refused read (the reproduction below prints `bpm 88`
beside `fused_bpm null`), and the README could name `fused_bpm` as the checked rate. The rest of this text is kept
as the record of what was measured.

This is the "seen along the way" item fix 11 named: "The no-reading fallback (`bpm` from the fused, then the
candidate, then the engine rate) passes the engine's rate through after the processor's own agreement test has
refused."

## Issue

**Title:** `RppgProcessor.getMetrics().bpm` falls back to the WASM core's raw rate when the processor has refused a
rate, so with no pulse in view it still shows a heart rate

**Who hits it.** Every app that reads `bpm`: from `RppgProcessor.getMetrics()`, from `RppgSession.getMetrics()`
(which on main returns the processor's read unchanged, `rppgSession.ts` line 203), and through the gating
controller, which passes `bpm` on as `publishBpm` whenever it is not in a motion hold (`rppgGating.ts` line 242).
The README's quick start shows `bpm` whenever it is not null. The published 0.14.0 has the same code (its Rust
crates are also unchanged on main since that release).

**How it works today.** `computeAdvancedMetrics` (rppgProcessor.ts, 49fdb41):

```ts
const lowConfidenceGate =                                      // line 1189
  (resolvedConfidence < 0.32 && bayes.confidence < 0.45) ||
  analysis.snrDb < -4.5 || analysis.motionMean > 0.22 ||
  (resolved.aliasFlag && estimatorSpread > 28);
const cameraCandidate = lowConfidenceGate ? null : calibratedBpm ?? resolvedBpm ?? base.bpm ?? null;
...
return {
  bpm: fused.bpm ?? cameraCandidate ?? base.bpm ?? null,      // line 1222
  confidence: lowConfidenceGate ? Math.min(Math.max(base.confidence || 0, resolvedConfidence || 0), 0.3) : ...,
  fused_bpm: lowConfidenceGate ? null : fused.bpm,
  ...
```

When the gate fires, `cameraCandidate` is null and, with no fresh Muse rate, so is `fused.bpm`; `bpm` then falls
through to `base.bpm`, the WASM core's raw rate. The same read says `fused_bpm: null`, `fused_source: "none"` and
caps `confidence` at 0.3: the processor has refused it, and shows the core's number anyway. The two early returns
(fewer than 24 samples, or no window analysis, lines 1047 and 1060) carry no `bpm`, so the read is
`{ ...base, ...advanced }` and `bpm` is the core's raw rate outright; the core reports from 10 samples on
(`pipeline.rs` line 220). The core withholds only when the window is "severe" (line 361: peak under 1.3 times the
noise floor, skin under 0.10, motion over 0.6, clipping over 0.4), so on noise it nearly always has a number.

The refusal is visible today in another field: in every read the gate refused, with no Muse, `fused_bpm` is null
(the reproduction below prints it), and in every read it passed `fused_bpm` is the shown rate. Only the early reads
(under 24 samples) put the core's raw rate in `fused_bpm` too, labelled `fused_source: "camera"`. `fused_bpm`'s doc
comment (rppgProcessor.ts line 116) says it is the same as `bpm` when no external source is active, which hides this.

(`cameraCandidate`'s own `?? base.bpm` cannot be reached: a null resolved rate means `resolveBpmCandidates`
confidence 0 and a tracker rate of null, whose confidence is 0, and that fires the gate.)

**Reproduce (no data needed).** `npm i @elata-biosciences/rppg-web@0.14.0`, Node 20 or later. An engine that always
answers 88, and a colour feed with no pulse at all:

```js
import { RppgProcessor } from "@elata-biosciences/rppg-web";
const engine = { newPipeline: () => ({ push_sample_rgb() {}, get_metrics: () => ({ bpm: 88, confidence: 0.2, signal_quality: 0.8 }) }) };
let s = 1;
const u = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) + 0.5) / 2 ** 32;
const noise = () => 0.05 * Math.sqrt(-2 * Math.log(u())) * Math.cos(2 * Math.PI * u());
const p = new RppgProcessor(engine, 30, 10); // on this PR's branch: new RppgProcessor(engine, 30, 10, { engineFallback: false })
const shown = [];
for (let i = 0; i < 20 * 30; i++) {
  p.pushSampleRgb((i * 1000) / 30, 170 + noise(), 120 + noise(), 100 + noise(), 1); // no pulse at all
  if ((i + 1) % 30 === 0) shown.push(`${p.getMetrics().bpm ?? "none"}`);
}
const m = p.getMetrics();
console.log(`bpm each second: ${shown.join(" ")}`);
console.log(`last read: bpm ${m.bpm}, fused_bpm ${m.fused_bpm}, fused_source ${m.fused_source}, confidence ${m.confidence.toFixed(2)}`);
```

On 0.14.0, and identically on main and on this branch with the option left out:

```
bpm each second: 88 88 88 88 88 88 88 88 88 88 88 88 88 88 88 88 88 88 88 88
last read: bpm 88, fused_bpm null, fused_source none, confidence 0.20
```

On this branch with `{ engineFallback: false }`: `none` in every second, and `bpm null` in the last read.

**With the real core.** Main built here from source (its TypeScript; the core is 0.14.0's, unchanged since), a raw
processor fed one colour sample per frame (`pushSampleRgb`) and read once a second as an app polls, seconds 16 to
40, three seeds per cell. Every shown number was labelled by the branch of the chain that produced it, and every
label was checked against the value (no read failed that check). No pulse:

| input (no pulse) | seconds | `bpm` shown | of those, the core's rate after the gate refused |
|---|---|---|---|
| sensor noise, 0.05 / 0.2 / 0.5 grey levels, 20 and 30 fps | 432 | 249 | 33 |
| a brightness wander (1% at 0.25 Hz plus a random walk) | 144 | 141 | 70 |
| a lamp flicker in band (1% at 1.2 Hz and at 2 Hz, the same on every channel) | 288 | 288 | 142 |
| a pulseless capture recorded from a synthetic camera (one pass and a palindrome loop) | 62 | 39 | 22 |

The rest are the processor's own estimates passing its gate on noise (with the colour path as it is on main, see
fix 11). The synthetic rows come from `realcore.mjs` below, run again on 2026-10-12 against main and this branch with
the option left out: every number in the first three rows, and the pulse table's right seconds (18, 40, 0 with the
fallback; 0, 0, 0 with `false`), printed exactly. The pulseless capture row is ours and is not reproducible from here. Published 0.14.0 gives the same numbers, read for read. Until the processor has 24 samples (0.8 s at 30
frames a second, 1.6 s at 15) the early returns show the core's rate, from 11 samples on: an app polling once a
second at 15 frames a second gets 180 with no pulse and 45 for a true 72 as its first reading (from 16 samples), and
one reading every 100 ms gets 180, 45, 80 or 89 at 15, 20 and 30 frames a second; none of those 17 numbers was
within 5 of a true rate.

<details><summary>realcore.mjs (the synthetic rows of the tables)</summary>

From the repo root, after the build: `npm pack @elata-biosciences/rppg-web@0.14.0 && mkdir rppg-web-0.14.0 && tar xzf
elata-biosciences-rppg-web-0.14.0.tgz -C rppg-web-0.14.0`, then `node realcore.mjs` (on this branch, `node
realcore.mjs false` sets `engineFallback: false`). A refused read is told apart from public fields: `bpm` shown with
`fused_bpm` null and no Muse.

```js
import { readFileSync } from "node:fs";
import { RppgProcessor } from "./packages/rppg-web/dist/index.js";
import { initSync, WasmRppgPipeline } from "./rppg-web-0.14.0/package/pkg/rppg_wasm.js";
initSync({ module: readFileSync("./rppg-web-0.14.0/package/pkg/rppg_wasm_bg.wasm") });
const opts = process.argv[2] === "false" ? { engineFallback: false } : {}; // node realcore.mjs [false]
const backend = { newPipeline: (f, w) => new WasmRppgPipeline(f, w) };
// Region-mean colour 170 / 120 / 100, a pulse 1% along (0.33, 0.77, 0.53) when bpm > 0, Gaussian noise per channel;
// "wander": 1% at 0.25 Hz plus a slow random walk on all channels; "flicker": 1% at the given rate on all channels.
function feed({ bpm, fps, noise, seed, mode = "plain", hz = 0 }) {
  let s = seed >>> 0, walk = 0;
  const u = () => { s = (s * 1664525 + 1013904223) >>> 0; return (s + 0.5) / 2 ** 32; };
  const gauss = () => Math.sqrt(-2 * Math.log(u())) * Math.cos(2 * Math.PI * u());
  const out = [];
  for (let i = 0; i < 40 * fps; i++) {
    const t = (i * 1000) / fps, p = bpm > 0 ? Math.sin((2 * Math.PI * bpm * t) / 60000) : 0;
    let k = 1;
    if (mode === "wander") { walk += (0.005 * gauss()) / Math.sqrt(fps); walk *= 0.999; k = 1 + 0.01 * Math.sin((2 * Math.PI * 0.25 * t) / 1000) + walk; }
    if (mode === "flicker") k = 1 + 0.01 * Math.sin((2 * Math.PI * hz * t) / 1000);
    out.push({ t, rgb: [170, 120, 100].map((c, j) => c * k * (1 - 0.01 * [0.33, 0.77, 0.53][j] * p) + noise * gauss()) });
  }
  return out;
}
const groups = {};
const add = (name, bpm, cell) => {
  const g = (groups[name] ??= { seconds: 0, shown: 0, refusedCore: 0, right: 0 });
  for (const seed of [1, 2, 3]) {
    const p = new RppgProcessor(backend, cell.fps, 10, opts);
    let next = 1000;
    for (const x of feed({ bpm, seed, ...cell })) {
      p.pushSampleRgb(x.t, ...x.rgb, 1);
      if (x.t < next - 1e-6) continue;
      next += 1000;
      const m = p.getMetrics();
      if (x.t / 1000 < 16) continue;
      g.seconds++;
      if (m.bpm == null) continue;
      g.shown++;
      if (m.fused_bpm == null) g.refusedCore++; // the processor refused (fused_bpm null, no Muse) and bpm is the core's rate
      if (bpm > 0 && Math.abs(m.bpm - bpm) <= 5) g.right++;
    }
    p.dispose();
  }
};
for (const fps of [30, 20]) {
  for (const noise of [0.05, 0.2, 0.5]) for (const bpm of [0, 50, 72, 120]) add(bpm ? `true ${bpm}` : "noise, no pulse", bpm, { fps, noise });
  for (const bpm of [0, 50, 72, 120]) add(bpm ? `true ${bpm}` : "wander, no pulse", bpm, { fps, noise: 0.05, mode: "wander" });
  for (const hz of [1.2, 2.0]) add("flicker, no pulse", 0, { fps, noise: 0.05, mode: "flicker", hz });
}
for (const [name, g] of Object.entries(groups)) console.log(`${name}: ${g.seconds} s, bpm shown ${g.shown}, of those the core's rate after a refusal ${g.refusedCore}, right ${g.right}`);
```

</details>

## Pull request

**Title:** feat(rppg-web): add engineFallback: false so bpm stays empty when the processor refuses a rate

Closes the issue above.

**What changes**

- New option `engineFallback?: boolean` on `RppgProcessor`'s fourth constructor argument, passed on by
  `createRppgSession`. With `false`:
  - a read the gate refused gives `bpm: fused.bpm ?? null`, so `null` unless a fresh Muse rate (another sensor's
    measurement) comes through `fused`;
  - the two early returns give `bpm: null`, `fused_bpm: null`, `fused_source: "none"` (`calibrated_bpm` keeps the
    core's value there, as a diagnostic, as before).
- `true`, the default, is the previous behaviour value for value; with the option left out every metric field of
  every read is unchanged (below).
- Docs: a minor changeset; the README's low-level section says what `bpm` shows when the processor refuses a rate
  and how to turn that off; the option's doc comment on `RppgProcessor` and on `CreateRppgSessionOptions`.

**What does not change**

- Every read the gate passes, with either value: the same number in `bpm` and every other field (a test pins it on
  a clean pulse; on every run below no shown number changed value, only refused reads went blank).
- The gate itself, the estimators, the resolver, the tracker, the calibration, the Muse fusion, the WASM core, the
  fuser and the session's routing.
- `confidence` in a refused read (still at most 0.3), so an app that already gates on it sees nothing new.

**The tradeoff, and why it is opt-in.** We wrote the rule for the default before measuring: on by default only if
(1) no-pulse numbers drop by at least 5 points, (2) on synthetic pulses at most 1% of right seconds are lost (and no
more than 4 of 75 in any one cell), and (3) on our recordings at most 1% of scored seconds go from right to blank,
and they are not worse by a paired sign test. (1) holds; (2) and (3) do not. Same harness as above, pulse feeds:

| main, raw processor | right seconds, fallback on | right seconds, `engineFallback: false` | wrong numbers removed |
|---|---|---|---|
| true 50 (576 s over 12 settings) | 18 | 0 | 89 |
| true 72 (576 s) | 40 | 0 | 61 |
| true 120 (576 s) | 0 | 0 | 132 |

On main's colour path the processor's own estimators do not read these pulses (that is fix 11), so the few right
seconds there are the core's, through the fallback. With fix 11's `rgbPulse: "pos"` they are the processor's own,
and the fallback carries few of them: on the same fixtures on our test build with that change, 29 of 1,701 right
seconds came through it, still over the 1% bar. On recordings the fallback is weak evidence, not none: see our own
observation at the end. So `true` stays the default, and we would rather you decide whether apps should get
`false` by default once fix 11 is in, with these numbers, than have it decided here.

**How it was tested**

- `processorEngineFallback.test.ts` (new, 9 tests), `RppgProcessor` with stand-in engines with a fixed answer, the
  feed of the reproduction (a region mean of 170 / 120 / 100 grey levels, a pulse when there is one along the
  blood-volume direction 0.33 / 0.77 / 0.53 at 1% scale, 0.05 grey levels of noise), read once a second:
  - no pulse, an engine that always says 88: the fallback shows 88 in every read, with `fused_source` "none" and
    `confidence` at most 0.3; `false` shows nothing, and every other field of every read is the same;
  - a clean grey 72 the processor reads itself: every read the gate passed is identical with and without the
    fallback, every read it refused shows 88 with it and nothing without, and the last 15 read 72;
  - a moving camera (every sample with motion 0.5, which the gate refuses): 88 with the fallback, nothing without,
    and a fresh Muse rate of 64 shows either way;
  - fewer than 24 samples: the core's 88 with the fallback, `bpm` and `fused_bpm` null without;
  - noise at 0.5 grey levels, three seeds: with `false` no read that shows a rate has `fused_source` "none";
  - an engine with no rate: the option changes nothing (passes on main too, by design);
  - left out: the fallback (passes on main too, by design).
- `createRppgSession.lifecycle.test.ts` (+1): the session passes the option to its processor.
- On main the new file stops at a compile error (TS2353: unknown `engineFallback`). Run with type checking off, 7
  of its 9 tests fail by assertion, and the lifecycle test fails; the 2 that pass are the two by-design ones above.
- Break on purpose, each run against both files; every one turns the named tests red:

| change | red |
|---|---|
| processor ignores the option (always the fallback) | 8 (every refused-read test, the early read, the session test) |
| refused reads still fall back, early reads fixed | 6 (no pulse, clean pulse, moving camera, three noise seeds) |
| early reads still fall back, refused reads fixed | 2 (the early read, the session test) |
| early reads: `bpm` null but `fused_bpm` still the core's | 1 |
| a fresh Muse rate dropped in refused reads | 1 (moving camera) |
| default flipped to `false` | 2 (left out, the session test) |
| session drops the option | 1 |
| the option also blanks reads the gate passed | 3 (clean pulse, moving camera with Muse, engine with no rate) |

- Run time: `processorEngineFallback.test.ts` takes 64 s under `jest --runInBand` and the rppg-web suite 91 s with
  it (measured in review); not trimmed, since we recommend not opening this PR.
- Full suites at 6894d3a: rppg-web jest 44 suites, 360 tests (main 43 and 350); `tsc` for the build and the test
  config clean; Biome lint clean; Biome format: no new findings (rppgProcessor.ts has the same 105 lines of format
  drift as on main, none on lines this PR touches; rppgSession.ts none). Not run: Rust tests (no Rust change),
  Playwright (no demo change).

**End to end through the session (a script, not a committed test).** What `createRppgSession` builds on main in
`face_mesh` mode: `DemoRunner` with the multi-region fuser and the skin mask, the processor with the tracker on (55,
150, 200), `session.getMetrics()` read once a second. The three face regions' colours are injected per frame (the
runner's own sampler is wrapped; no SDK file is edited), a synthetic face with a chromatic pulse 1% deep at green,
20 and 30 frames a second, three seeds, 60 s, read from 16 s; and the pulseless capture above, once and looped.

| main's session | seconds | `bpm` shown, fallback on | of those, the core's after a refusal | right, fallback on | right, `false` |
|---|---|---|---|---|---|
| synthetic face, no pulse | 264 | 233 | 130 | | |
| pulseless capture | 63 | 51 | 36 | | |
| synthetic face, true 50 | 264 | 247 | 92 | 127 | 127 |
| synthetic face, true 72 | 264 | 264 | 2 | 215 | 213 |
| synthetic face, true 120 | 264 | 253 | 9 | 124 | 124 |

On these synthetic inputs the session path would pass the rule: `false` takes the no-pulse numbers from 233 to 103
of 264 seconds and 51 to 15 of 63, and costs 2 of 466 right seconds. Our recordings say otherwise (the observation
at the end): there the fallback carries most of the right seconds on this path too, which is why the default does
not change. The branch with the option left out matches main read for read through this path (the same `bpm`,
`confidence`, branch and core rate in all 7,798 reads of these runs and the recordings below).

**Considered and not done**

- Reading `fused_bpm` instead, which needs no change: with no Muse it equals `bpm` with `engineFallback: false` in
  every read from 24 samples on. Checked with the script below on this branch (the reproduce feed with and without a
  pulse of 72, 0.05 and 0.5 grey levels, the published 0.14.0 core, read every 100 ms for 40 s): equal in 1,572 of
  1,572 reads, the 28 earlier reads skipped. A wider run (30, 20 and 15 frames a second, three noise levels, lamp
  wander and flicker, 6,528 reads) found 0 differences in its 5,440 reads with 24 or more samples; all 192
  differences were early reads, where `fused_bpm` is the core's rate. This is why we recommend not opening the PR.

<details><summary>fusedeq.mjs</summary>

Set up as for realcore.mjs, on this branch: `node fusedeq.mjs` prints `reads with 24 or more samples: default
fused_bpm equals engineFallback false bpm in 1572, differs in 0 (28 early reads skipped)`.

```js
import { readFileSync } from "node:fs";
import { RppgProcessor } from "./packages/rppg-web/dist/index.js";
import { initSync, WasmRppgPipeline } from "./rppg-web-0.14.0/package/pkg/rppg_wasm.js";
initSync({ module: readFileSync("./rppg-web-0.14.0/package/pkg/rppg_wasm_bg.wasm") });
const backend = { newPipeline: (f, w) => new WasmRppgPipeline(f, w) };
let same = 0, differ = 0, early = 0;
for (const [bpm, noise] of [[0, 0.05], [0, 0.5], [72, 0.05], [72, 0.5]]) {
  let s = 1;
  const u = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) + 0.5) / 2 ** 32;
  const n = () => noise * Math.sqrt(-2 * Math.log(u())) * Math.cos(2 * Math.PI * u());
  const a = new RppgProcessor(backend, 30, 10), b = new RppgProcessor(backend, 30, 10, { engineFallback: false });
  for (let i = 0; i < 40 * 30; i++) {
    const t = (i * 1000) / 30, x = bpm ? Math.sin((2 * Math.PI * bpm * t) / 60000) : 0;
    const rgb = [170 * (1 - 0.0033 * x) + n(), 120 * (1 - 0.0077 * x) + n(), 100 * (1 - 0.0053 * x) + n()];
    a.pushSampleRgb(t, ...rgb, 1); b.pushSampleRgb(t, ...rgb, 1);
    if (i % 3 !== 2) continue; // read every 100 ms
    const fused = a.getMetrics().fused_bpm ?? null, off = b.getMetrics().bpm ?? null;
    if (i + 1 < 24) { early++; continue; }
    fused === off ? same++ : differ++;
  }
}
console.log(`reads with 24 or more samples: default fused_bpm equals engineFallback false bpm in ${same}, differs in ${differ} (${early} early reads skipped)`);
```

</details>

- The narrower default: only the early reads (under 24 samples, which nothing of the processor's has checked) give
  no rate, `fused_bpm` included; refused reads unchanged. We set its rule before measuring: on by default only if
  (a) it loses at most 1% of right seconds and (b) among the reads it blanks, wrong numbers outnumber right ones at
  least 10 to 1, each on synthetic pulses and on our recordings separately, read once a second from the first second.
  Main's raw processor with the published 0.14.0 core against a copy of it with only that change:
  - synthetic (30, 20 and 15 frames a second, 0.05, 0.2 and 0.5 grey levels, true 0, 50, 72 and 120, two seeds, 40 s):
    13 early reads, all in the first second at 15 and 20 frames a second; with a pulse 10 shown and 0 right; 0 of 20
    right seconds lost. (a) and (b) hold. Read every 100 ms for the first 3 s instead: 96 early numbers with a pulse,
    4 right; 36 with none.
  - our recordings (50, each from its first second): 13 early reads, 2 right and 11 wrong; 2 of 1,144 right seconds
    lost (0.17%), worse on 2 recordings and better on none. (a) holds, (b) does not (11 to 2).
  Nothing else changed in any read of either run. So it is not proposed; the recordings part is our own data and is
  context. If you would rather have it anyway, it is the two early returns and nothing else.
- On by default: fails the rule above, on synthetic pulses and on recordings.
- Keeping the fallback only when the core's own `confidence` is high: chosen on the synthetic no-pulse feeds (the
  smallest threshold that removes 90% of the fallback's no-pulse numbers: 0.9 on main), then tried once on our
  recordings, it still loses nearly all the fallback's right seconds. On those recordings the core's confidence is
  the same for its right and its wrong rates (median 0.60 against 0.56), so it cannot separate them.
- Dropping the dead `?? base.bpm` inside `cameraCandidate`: it cannot be reached (see the issue), so removing it
  changes nothing; left alone to keep this diff to the option.
- Raising `confidence` in refused reads, or a separate field for the core's rate: either changes what existing
  apps see by default.

**Seen along the way, not changed**

- In a read the gate passes, `bpm` is `calibratedBpm` whenever both the spectral and the autocorrelation estimates
  exist, not the resolver's choice: `cameraCandidate = calibratedBpm ?? resolvedBpm ?? ...`, and an untrained
  `MuseCalibrationModel` predicts `(spectral + acf) / 2` (its training moves the weights by about 1e-5 per read, so
  it stays near that mean). An octave disagreement (60 and 120) shows 90, a rate neither estimator gave. On the
  synthetic session above, in the reads the gate passed, that mean was right in 70%, the resolver's own choice in
  94%; on our recordings through the same path (context, at the end) 3% against 11%, with the core's rate in those
  reads at 37%. We think this, more than the fallback, is where main's wrong numbers come from, and it is the next
  thing we would look at; it is not touched here.
- With the fallback off, main's raw processor still shows a number in 450 of 926 no-pulse seconds above: the
  processor's own estimators pass the gate on noise. That is the gate itself, and fix 11 makes the estimators
  agree on noise more often still. A pulse-presence check is the place to fix it; the gate's thresholds are not.
- The processor's autocorrelation halves clean rates above about 110 and the untrained calibration averages that
  with the spectral rate (fix 11's note); on the 120 bpm feeds here the processor's own reads are wrong for that
  reason.

**Our own observation (not reproducible from the PR):** 50 recordings we hold, each with a reference rate, the mean
of the three face-region colours per frame fed to a raw processor through `pushSampleRgb` at the frame's own
timestamp, main's build with 0.14.0's core, `bpm` read once a second from 20 s, a second right within 5 bpm. The
scorer checks itself first (a grey 72 must read within 2 on every build, the window must hold 45 s of samples, the
core must give a number on a pulseless capture, and every shown number must match its labelled source; each check
was broken on purpose and stopped it). Main: 1,038 of 6,679 seconds right, 910 of them through the fallback;
`engineFallback: false`: 128 right (worse on 49 of 50 recordings), and 2,079 wrong numbers removed. The fallback's
numbers there are right 30% of the time, where a core reading its no-pulse numbers would be right 14% of the time
(the same 2,989 seconds scored against the rates it gave on the no-pulse feeds above): weak evidence, but not none.
On our test build with fix 11's change on, the fallback carried 779 of 1,967 right seconds and was right in 32% of
its numbers; the processor's own were right in 34% of theirs. Through main's session path (each recording's three
region colours injected as the three face regions, as in the table above), `bpm` was right in 1,296 of 6,679
seconds, 1,203 of them through the fallback; with `false`, 93 (worse on 44 of 50 recordings). There the reads the
gate passes show the plain mean of the spectral and autocorrelation estimates ("Seen along the way"), right in 93
of 3,316, where the core's rate in those same reads was right in 37% of them and the resolver's choice in 11%. The
recordings cannot be shared, so this is context, not evidence for the PR.

### Merging with the other fixes

No textual conflict with any of the other eleven fixes, alone or merged together: `git merge-tree` is clean against
each branch and against the local merged tree of all eleven (`wip/all-fixes`). The first layout of this branch did
conflict with fix 1 and fix 11 (all on the lines they add to); the third commit moves the option, its field, its
session line and its lifecycle test a few lines away, with no change in behaviour. The lifecycle test's
`import { DemoRunner }` line is identical to fix 4's and fix 11's, so the merged tree has it once.

On the merged tree (the eleven fixes, the face-gap grid test, fix 11's `resetSignal` line, and this branch; local
`wip/all-fixes` at 4471632): rppg-web jest 54 suites, 451 tests (53 and 441 before this branch); `tsc` both configs
and Biome lint clean. With the processor made to ignore the option there, the same 8 tests turn red as on the
branch. Fix 1's `resetSignal()` needs nothing for this option (it has no state): after a reset the processor has
under 24 samples again, and with `false` those reads are empty.

With the other fixes in, on the merged tree's raw processor (its WASM core built from the merged Rust, so fix 2's
projection is in), the harness above, fallback on and off, with and without fix 11's `rgbPulse: "pos"`:

| merged tree, raw processor | no-pulse seconds showing a number (of 926) | right, synthetic pulses (of 1,728) | right, our recordings (of 6,679) |
|---|---|---|---|
| defaults | 476 | 538 | 1,373 |
| `engineFallback: false` | 310 | 80 | 105 |
| `rgbPulse: "pos"` | 631 | 1,698 | 1,900 |
| `rgbPulse: "pos"`, `engineFallback: false` | 464 | 1,668 | 1,127 |

No shown number changed value between any pair; only refused reads went blank. With fix 11 the option costs 30 of
1,698 synthetic right seconds (1.7%, over the 1% bar) and 773 of 1,900 on our recordings, so it stays opt-in on the
merged tree too. (The recordings column is our own data, context as above.)
