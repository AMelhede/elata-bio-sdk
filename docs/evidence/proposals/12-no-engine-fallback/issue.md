# Issue: `bpm` shows the core's raw rate after the processor's own checks refused one

Written 2026-10-12 from fix12.md, which stays as the record of the withdrawn code change. This is what we send
instead of a pull request: an issue only, no code. The option fix 12 added (`engineFallback: false`) is not
proposed, because the field below already carries the checked rate, read for read.

**Title:** `RppgProcessor.getMetrics().bpm` falls back to the WASM core's raw rate when the processor has refused a
rate, and `fused_bpm`'s doc comment hides it

## What happens

**Who hits it.** Every app that reads `bpm`: from `RppgProcessor.getMetrics()`, from `RppgSession.getMetrics()`
(which on main returns the processor's read unchanged, `rppgSession.ts` line 203), and through the gating
controller, which passes `bpm` on as `publishBpm` whenever it is not in a motion hold (`rppgGating.ts` line 242).
The README's quick start shows `bpm` whenever it is not null. The published 0.14.0 has the same code.

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

When the gate fires, `cameraCandidate` is null and, with no fresh Muse rate, so is `fused.bpm`. `bpm` then falls
through to `base.bpm`, the WASM core's raw rate. The same read says `fused_bpm: null`, `fused_source: "none"` and
caps `confidence` at 0.3. So the processor has refused the rate and shows the core's number anyway. The two early
returns (fewer than 24 samples, or no window analysis, lines 1047 and 1060) carry no `bpm`, so there `bpm` is the
core's raw rate outright; the core reports from 10 samples on (`pipeline.rs` line 220). The core withholds only when
the window is "severe" (line 361), so on noise it nearly always has a number.

(`cameraCandidate`'s own `?? base.bpm` cannot be reached: a null resolved rate means confidence 0, which fires the
gate.)

## Reproduce (no data needed)

`npm i @elata-biosciences/rppg-web@0.14.0`, Node 20 or later. An engine that always answers 88, and a colour feed
with no pulse at all:

```js
import { RppgProcessor } from "@elata-biosciences/rppg-web";
const engine = { newPipeline: () => ({ push_sample_rgb() {}, get_metrics: () => ({ bpm: 88, confidence: 0.2, signal_quality: 0.8 }) }) };
let s = 1;
const u = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) + 0.5) / 2 ** 32;
const noise = () => 0.05 * Math.sqrt(-2 * Math.log(u())) * Math.cos(2 * Math.PI * u());
const p = new RppgProcessor(engine, 30, 10);
const shown = [];
for (let i = 0; i < 20 * 30; i++) {
  p.pushSampleRgb((i * 1000) / 30, 170 + noise(), 120 + noise(), 100 + noise(), 1); // no pulse at all
  if ((i + 1) % 30 === 0) shown.push(`${p.getMetrics().bpm ?? "none"}`);
}
const m = p.getMetrics();
console.log(`bpm each second: ${shown.join(" ")}`);
console.log(`last read: bpm ${m.bpm}, fused_bpm ${m.fused_bpm}, fused_source ${m.fused_source}, confidence ${m.confidence.toFixed(2)}`);
```

On 0.14.0 and on main:

```
bpm each second: 88 88 88 88 88 88 88 88 88 88 88 88 88 88 88 88 88 88 88 88
last read: bpm 88, fused_bpm null, fused_source none, confidence 0.20
```

**With the real core** [synthetic]. Main's TypeScript with the 0.14.0 core, a raw processor fed one colour sample
per frame and read once a second, seconds 16 to 40, three seeds per cell. `realcore.mjs` (in fix12.md, runnable on
main without the option) prints these:

| input (no pulse) | seconds | `bpm` shown | of those, the core's rate after the gate refused |
|---|---|---|---|
| sensor noise, 0.05 / 0.2 / 0.5 grey levels, 20 and 30 fps | 432 | 249 | 33 |
| a brightness wander (1% at 0.25 Hz plus a random walk) | 144 | 141 | 70 |
| a lamp flicker in band (1% at 1.2 Hz and at 2 Hz, on every channel) | 288 | 288 | 142 |

The rest of the shown numbers are the processor's own estimates passing its gate on noise; that is the gate itself,
not this fallback. Before 24 samples (0.8 s at 30 fps, 1.6 s at 15) the core's rate is shown from 11 samples on;
none of the 17 such first numbers we read was within 5 bpm of a true rate.

## What apps can do today

Read `fused_bpm` instead of `bpm`. With no Muse, in every read the gate refused `fused_bpm` is null, and in every
read it passed `fused_bpm` is the shown rate. We checked this against an opt-in that blanks the fallback
(`fix/no-engine-fallback` on our fork, not proposed): `fused_bpm` equalled that option's `bpm` in 1,572 of 1,572
reads with 24 or more samples, and 5,440 of 5,440 in a wider run (30, 20 and 15 fps, three noise levels, lamp
wander and flicker). The only differences were early reads (under 24 samples), where `fused_bpm` is the core's rate
too, labelled `fused_source: "camera"`. An app can feed `{ ...m, bpm: m.fused_bpm }` to the gating controller.

## What we ask for

1. Correct `fused_bpm`'s doc comment (rppgProcessor.ts line 116). It says the field is "Same as `bpm` when no
   external source is active". That is false in every refused read: the reproduction above prints `bpm 88` beside
   `fused_bpm null`.
2. Name `fused_bpm` in the README as the rate the processor's checks passed, next to the quick start that shows
   `bpm`.
3. Optional, the maintainer's call: say in the README that the first reads (under 24 samples) are the core's
   unchecked rate.

## What we do not ask for, and why

- **An option to blank the fallback** (our fix 12). It duplicates `fused_bpm`, read for read, from 24 samples on.
- **Blank the early reads by default.** We set a rule before measuring: lose at most 1% of right seconds, and blank
  at least 10 wrong numbers for every right one. On synthetic pulses it held. On our own recordings (one person,
  cannot be shared, context only) it blanked 11 wrong and 2 right, under the 10 to 1 bar, so it failed.
- **Turn the fallback off by default.** On main's colour path it removes nearly every right second, because that
  path's own estimates are wrong (see "Related").

## Related

- In reads the gate passes, `bpm` is the untrained calibration's blend of the spectral and autocorrelation rates,
  not the resolver's choice. Our fix 13 (`calibrationBlend: false`, opt-in) is about that.
- The processor's own colour path reads the wrong rate; our fix 11 (`rgbPulse: "pos"`, opt-in) is about that.
- A pulse-presence check is the place to stop numbers on noise; the gate's thresholds are not.
