# Fix 13: `bpm` shows a blend of two estimates that neither measured, not the processor's own resolved rate

Branch: `fix/no-calibration-blend` on github.com/AMelhede/elata-bio-sdk, tip 608e797, four commits on Elata main
49fdb41 (pushed 2026-10-12). Every commit message follows the repo's convention and none quotes private data, so
the branch itself can be opened; the local one-commit ref `pr/no-calibration-blend` (c4f98c2, same tree, parent
49fdb41, not pushed) is there if a single commit is preferred. Either way, please squash-merge with the PR title.

This started as the "seen along the way" item fix 11 named: the processor's autocorrelation halves clean rates
over 110, and its untrained calibration averages that with the spectral rate. Measured end to end, the halving is
real but is not what an app pays for: the averaging is. So this PR changes the averaging, and the halving is
described below as a separate issue with its numbers (see "Considered and not done").

## Issue

**Title:** `RppgProcessor.getMetrics().bpm` is the camera calibration's blend of the spectral and autocorrelation
rates, so when they disagree it shows a rate neither measured instead of the rate the processor resolved

**Who hits it.** Every app that reads `bpm` (from `RppgProcessor`, from `RppgSession.getMetrics()`, which on main
returns the processor's read, and through the gating controller's `publishBpm`), in every read the processor's
low-confidence gate passes. The published 0.14.0 has the same code.

**How it works today.** `computeAdvancedMetrics` (rppgProcessor.ts, 49fdb41):

```ts
calibratedBpm = this.cameraCalibration.predict(spectral.bpm, acf.bpm);        // line 1106
...
const resolvedChoice = chooseResolvedBpm(resolved, bayes);                     // line 1148
...
if (spectral && acf && resolvedBpm != null && resolvedConfidence >= 0.55) {   // line 1163
  this.cameraCalibration.train(spectral.bpm, acf.bpm, resolvedBpm);
  calibratedBpm = this.cameraCalibration.predict(spectral.bpm, acf.bpm);
}
...
const cameraCandidate = lowConfidenceGate ? null : calibratedBpm ?? resolvedBpm ?? base.bpm ?? null;   // 1194
...
bpm: fused.bpm ?? cameraCandidate ?? base.bpm ?? null,                         // line 1222
```

`MuseCalibrationModel` (line 308) is a linear model of the spectral and autocorrelation rates. Untrained it returns
their plain mean (line 318). Its only training is the line above: toward the processor's own resolved rate, by
`0.01 x error x rate x 0.001` per weight per read (lines 326 to 337). Nothing trains it against another sensor. So
the shown rate is a blend of two of the processor's estimators, not the choice its resolver and tracker made from
the engine's rate, the spectral, autocorrelation and peak rates, the rate history and the tracker. When the two
estimators agree, the blend equals them. When they disagree, it shows a number neither measured, and moves toward
the resolved rate only as fast as the training step allows.

Two disagreements an app meets on main every day:

- The autocorrelation halves every clean rate over 110 (`calculateBpmViaAutocorrelation`, pulseAnalysis.ts lines
  266 to 275): it moves to twice the lag it found when that lag's confidence is at least 0.95 of the found one's,
  and both confidences are clamped at 1 (line 245), so any clean periodic signal passes. A clean 120 reads 60.
- The spectral estimate doubles resting rates under 85 with a normal second harmonic (fix 5). A 72 reads 144.

**Reproduce (no data needed).** `npm i @elata-biosciences/rppg-web@0.14.0`, Node 20 or later. An engine that reports
the true rate, and a clean 120 bpm pulse fed as a fused sample (R = G = B), read once a second:

```js
import { RppgProcessor } from "@elata-biosciences/rppg-web";
const engine = { newPipeline: () => ({ push_sample_rgb_meta() {}, get_metrics: () => ({ bpm: 120, confidence: 0.8, signal_quality: 0.9 }) }) };
const p = new RppgProcessor(engine, 30, 10); // on this PR's branch: new RppgProcessor(engine, 30, 10, { calibrationBlend: false })
const shown = [];
for (let i = 0; i < 30 * 30; i++) {
  const x = (2 * Math.PI * 120 * i) / (60 * 30), v = 0.5 + 0.02 * (Math.sin(x) + 0.4 * Math.sin(2 * x + 0.8));
  p.pushSampleRgbMeta((i * 1000) / 30, v, v, v, 1, 0, 0);
  if ((i + 1) % 30 === 0 && i >= 16 * 30) shown.push(p.getMetrics().bpm.toFixed(1));
}
const m = p.getMetrics();
console.log(`bpm each second from 17 s: ${shown.join(" ")}`);
console.log(`last read: bpm ${m.bpm.toFixed(1)}, calibrated_bpm ${m.calibrated_bpm.toFixed(1)}, resolved_bpm ${m.resolved_bpm.toFixed(1)}, spectral_bpm ${m.spectral_bpm.toFixed(1)}, acf_bpm ${m.acf_bpm.toFixed(1)}`);
```

On 0.14.0, and identically on main (49fdb41) and on this branch with the option left out:

```
bpm each second from 17 s: 95.7 100.3 104.1 107.1 109.5 111.5 113.1 114.4 114.4 114.4 114.4 114.4 114.4 115.5
last read: bpm 116.4, calibrated_bpm 116.4, resolved_bpm 120.0, spectral_bpm 120.0, acf_bpm 60.0
```

On this branch with `{ calibrationBlend: false }`: `120.0` in every second, and `bpm 120.0` (with `calibrated_bpm`
118.7) in the last read. The engine, the spectral estimate and the resolver all said 120 from the first read.

## Pull request

**Title:** feat(rppg-web): add calibrationBlend: false so bpm shows the processor's resolved rate

Closes the issue above.

**What changes**

- New option `calibrationBlend?: boolean` on `RppgProcessor`'s fourth constructor argument, passed on by
  `createRppgSession`. With `false`, the camera rate in a read the gate passes is `resolvedBpm ?? base.bpm`
  instead of `calibratedBpm ?? resolvedBpm ?? base.bpm`. (Its `?? base.bpm` cannot be reached, as on main: a null
  resolved rate fires the gate.)
- `true`, the default, is the previous behaviour, value for value.
- Docs: a minor changeset; a README paragraph after the backend notes in "Recommended Vs Advanced"; the option's
  doc comment on `RppgProcessor` and on `CreateRppgSessionOptions`.

**What does not change**

- The default. With the option left out, every field of every read is the previous one (the reproduce output
  above, and this branch's build at its default against main's on both end-to-end suites below: 4,671 reads, every
  field the same).
- With `false`: the calibration still trains as before, `calibrated_bpm` still reports its prediction, and it is
  still one of the resolver's candidates once trained. Every refusal of the gate, the confidence, the early reads
  and the Muse paths are unchanged; a test pins that a refused read shows nothing either way.
- No estimator: the spectral, autocorrelation and peak estimates, the resolver, the tracker and the WASM core are
  untouched.

**The tradeoff, and why it is opt-in.** We wrote the rule for the default before measuring: on by default only if
(1) right seconds lost are at most the right seconds gained, and at most 1% of the seconds scored, in each suite,
(2) with no pulse, seconds showing a number do not rise, and (3) it is not worse on our recordings. It fails (1) and
(2) on main by small margins, alongside large gains:

Main (49fdb41) built here from source, the published 0.14.0 WASM core, in Node, read once a second as an app polls,
paired read for read against the same build with the option left out. Right = within 5 bpm.

| suite | seconds with a pulse | right, default -> `false` | lost / gained | no pulse: seconds showing a number |
|---|---|---|---|---|
| raw processor, grey pulse (50, 72, 100, 120, 140, 160 bpm; 15, 20 and 30 fps; two noise levels; 3 seeds; seconds 16 to 40) | 2,592 | 1,813 -> 2,053 | 7 / 247 | 220 -> 218 of 432 |
| `createRppgSession`'s path (DemoRunner with the multi-region fuser, tracker on), a synthetic face at 50, 72, 120, 140, 160 bpm, 20 and 30 fps, 3 seeds, from 16 s | 1,320 | 590 -> 856 | 23 / 289 | 284 -> 288 of 327 |

These were measured with a build of main carrying the same one-line change behind a test hook; this branch's own
build with `calibrationBlend: false` gives the same value in every field of every read on both suites (and on the
recordings below).

By rate, the session path: 50 bpm 127 -> 127 of 264, 72 bpm 215 -> 256, 120 bpm 124 -> 224, 140 bpm 79 -> 168,
160 bpm 45 -> 81. The raw processor: 50 bpm 310 -> 396 of 432, 72 bpm 128 -> 212, 100 bpm 430 -> 431, 120 bpm
359 -> 386, 140 bpm 327 -> 342, 160 bpm 259 -> 286. The 23 lost seconds on the session path are 1.7% of 1,320,
over the 1% the rule allows, and the no-pulse fixture (a synthetic face with no pulse, and a pulseless capture
recorded from a synthetic camera) shows a number in 4 more seconds of 327; both come from the reads after a
changed one (the rate history and the tracker follow what was shown), since a single read with `false` can never
show a number where the default shows none.

The raw processor row needs nothing but a built package, so it can be rerun here with the script below (Node
20+; a source build has no `pkg/`, so point `WASM_PKG` at the published 0.14.0's; this PR does not touch the WASM
core). It reads `p.samples` only for its window self-check. From this branch's `packages/rppg-web`, built:

```
B_OPTS='{"calibrationBlend":false}' node grey-suite.mjs . .
# A: right 1813 of 2592 seconds with a pulse; no pulse: a number in 220 of 432; by rate {"50":310,"72":128,"100":430,"120":359,"140":327,"160":259}
# B: right 2053 of 2592 seconds with a pulse; no pulse: a number in 218 of 432; by rate {"50":396,"72":212,"100":431,"120":386,"140":342,"160":286}
# B against A: 7 right seconds lost, 247 gained
```

and against the published 0.14.0 with the option left out (`node grey-suite.mjs node_modules/@elata-biosciences/rppg-web
.`) every count is the same on both sides. The session-path row needs a face-region shim around `DemoRunner` and is
not packaged.

<details><summary>grey-suite.mjs</summary>

```js
// Grey-pulse suite for RppgProcessor, public API only, no data. Node 20+.
//   node grey-suite.mjs <A> [<B>]        A, B: a built rppg-web package dir (dist/ + pkg/), e.g. node_modules/@elata-biosciences/rppg-web
//   env A_OPTS / B_OPTS: JSON for RppgProcessor's 4th argument, e.g. B_OPTS='{"calibrationBlend":false}'
//   env WASM_PKG: a pkg/ dir to use for both (a source build of main has no pkg/; copy it from the published 0.14.0)
// Feed: R = G = B = 0.5 + 0.02 (sin + 0.4 sin(2x + 0.8)) + Gaussian noise; 0 bpm = noise only. Read getMetrics() once a
// second from 16 s to 39 s, as an app polls. Right = within 5 bpm of the true rate. With B, every second is paired.
import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';
const [A, B] = process.argv.slice(2);
const BREAK = process.env.BREAK ?? ''; // rate | window | nogate: each breaks one self-check on purpose
async function load(dir) {
  const sdk = await import(pathToFileURL(`${dir}/dist/index.js`).href);
  const pkg = process.env.WASM_PKG ?? `${dir}/pkg`;
  const bytes = readFileSync(`${pkg}/rppg_wasm_bg.wasm`);
  const backend = await sdk.loadWasmBackend(async (u) => { const m = await import(u); m.initSync?.({ module: bytes }); return m; }, { strict: true, jsUrl: pathToFileURL(`${pkg}/rppg_wasm.js`).href });
  return { sdk, backend };
}
function grey({ bpm, fps, seconds = 40, noise = 0.005, seed = 1 }) {
  let s = seed >>> 0; const u = () => { s = (s * 1664525 + 1013904223) >>> 0; return (s + 0.5) / 2 ** 32; };
  const g = () => Math.sqrt(-2 * Math.log(u())) * Math.cos(2 * Math.PI * u());
  return Array.from({ length: Math.round(seconds * fps) }, (_, i) => { const t = (i * 1000) / fps, ph = (2 * Math.PI * bpm * t) / 60000;
    return { t, v: 0.5 + (bpm > 0 ? 0.02 * (Math.sin(ph) + 0.4 * Math.sin(2 * ph + 0.8)) : 0) + noise * g() }; });
}
function run({ sdk, backend }, opts, frames, fps, readFrom = 16) {
  const p = opts ? new sdk.RppgProcessor(backend, fps, 10, opts) : new sdk.RppgProcessor(backend, fps, 10);
  let next = 1000; const out = [];
  for (const f of frames) { p.pushSampleRgb(f.t, f.v, f.v, f.v, 1);
    if (f.t >= next - 1e-6) { next += 1000; const m = p.getMetrics(); const sec = Math.round(f.t / 1000); if (sec >= readFrom) out.push(Number.isFinite(m.bpm) ? m.bpm : null); } }
  const n = p.samples?.length ?? 0, span = n > 1 ? (p.samples[n - 1].timestampMs - p.samples[0].timestampMs) / 1000 : 0;
  p.dispose?.(); return { out, n, span };
}
const median = (a) => { const s = a.filter((x) => x != null).sort((x, y) => x - y); return s.length ? s[s.length >> 1] : null; };
async function selfCheck(name, b, opts) {
  const k = run(b, opts, grey({ bpm: 72, fps: 30, seconds: 60, noise: 0 }), 30, 20);
  const med = median(k.out), want = BREAK === 'rate' ? 68 : 72;
  if (med == null || Math.abs(med - want) > 2) throw new Error(`${name} self-check: known 72 reads ${med}`);
  const wantS = BREAK === 'window' ? 30 : 45;
  if (Math.abs(k.span - wantS) > 1) throw new Error(`${name} self-check: window ${k.span.toFixed(1)} s, expected ${wantS}`);
  const nogate = b.sdk.estimateDominantBpm(grey({ bpm: 0, fps: 30, seconds: 10 }).map((f) => f.v), 30, 0.7, 3.3);
  if ((BREAK === 'nogate' ? null : nogate?.bpm) == null) throw new Error(`${name} self-check: the no-gate spectral estimate gave nothing on a pulseless input`);
  console.error(`${name}: self-check ok (known 72 -> ${med.toFixed(1)}, window ${k.span.toFixed(1)} s, no-gate ${nogate.bpm.toFixed(1)} on noise)`);
}
const arms = [{ name: 'A', b: await load(A), opts: process.env.A_OPTS ? JSON.parse(process.env.A_OPTS) : undefined }];
if (B) arms.push({ name: 'B', b: await load(B), opts: process.env.B_OPTS ? JSON.parse(process.env.B_OPTS) : undefined });
for (const a of arms) await selfCheck(a.name, a.b, a.opts);
if (BREAK) process.exit(0);
const tot = arms.map(() => ({ right: 0, scored: 0, nopulse: 0, nopulseShown: 0, byRate: {} })); let lost = 0, gained = 0;
for (const fps of [30, 20, 15]) for (const noise of [0.005, 0.02]) for (const bpm of [0, 50, 72, 100, 120, 140, 160]) for (const seed of [1, 2, 3]) {
  const frames = grey({ bpm, fps, noise, seed });
  const res = arms.map((a) => run(a.b, a.opts, frames, fps).out);
  res.forEach((out, i) => { const T = tot[i]; for (const v of out) { if (bpm === 0) { T.nopulse++; if (v != null) T.nopulseShown++; } else { const ok = v != null && Math.abs(v - bpm) <= 5; T.scored++; T.right += ok; T.byRate[bpm] = (T.byRate[bpm] ?? 0) + ok; } } });
  if (res.length === 2 && bpm > 0) res[0].forEach((v, j) => { const ok = (x) => x != null && Math.abs(x - bpm) <= 5; if (ok(v) && !ok(res[1][j])) lost++; if (!ok(v) && ok(res[1][j])) gained++; });
}
tot.forEach((T, i) => console.log(`${arms[i].name}: right ${T.right} of ${T.scored} seconds with a pulse; no pulse: a number in ${T.nopulseShown} of ${T.nopulse}; by rate ${JSON.stringify(T.byRate)}`));
if (arms.length === 2) console.log(`B against A: ${lost} right seconds lost, ${gained} gained`);
```

</details>

So `true` stays the default. We think `false` is the better default on main and would rather you decide that with
these numbers than have it decided by this PR.

**How it was tested**

- `processorCalibrationBlend.test.ts` (new, 9 tests), `RppgProcessor` with an engine that reports the true rate and
  grey samples with a second harmonic at 0.4:
  - with `false`, read once after 30 s, a clean 120 at 30 and at 20 fps, 140 at 30 fps and 72 at 30 fps show the
    resolved rate (within 1 of the truth), and the calibration is still trained and reported (on main: 95.7,
    95.7, 114.1, 98.3);
  - by default, 120 and 140 show 95.7 and 114.1, equal to `calibrated_bpm`, with `calibrationBlend` left out and
    set to `true` (passes on main, by design: it pins the default);
  - with `false`, read once a second from 17 s, a clean 120 shows 120 in every read; the default starts under 100
    and climbs;
  - where the estimators agree (90 bpm), every read is the same rate either way to a millionth of a beat (passes
    on main);
  - a read the gate refuses (an engine with no rate) shows nothing either way (passes on main).
- `createRppgSession.lifecycle.test.ts` (+1): the session passes the option on (95.7 by default, 120 with `false`).
- On main both files stop at compile errors (TS2345 on the processor's options, TS2353 on the session's). With
  type-checking off, 6 of the 16 tests fail by assertion; the 10 that pass are the 6 existing lifecycle tests and
  the 4 that pin unchanged behaviour (the two default cases, the agreeing case and the refused read).
- Break on purpose, each alone, both files run:

| change | red |
|---|---|
| the processor ignores the option | 6 |
| `false` still shows the blend | 6 |
| the default flipped to `false` | 5 |
| the session drops the option | 1 |

- Full suites at the tip: rppg-web jest 44 suites, 360 tests (main 43 and 350); `tsc` for the build and the test
  config clean; Biome lint clean; Biome format: no new findings (rppgProcessor.ts 105 lines of format drift on main,
  103 here; rppgSession.ts none either way); package build and `verify-dist-esm` pass; the consumer Node smoke
  passes (run with `TMPDIR` on the same filesystem as the checkout: from a RAM disk the script's rename into the
  system temp dir fails with EXDEV before any check, unrelated to this change); `scripts/audit-repo.mjs` passes.
  Not run: Rust tests (no Rust change), Playwright (no demo change).

**Considered and not done**

- Fixing the autocorrelation's halving instead (the change fix 11 pointed at). The doubling-lag test compares
  clamped confidences and, with no hint, prefers the longer lag on a tie; we built a version that compares the
  unclamped scores and keeps the shorter lag unless the plain correlation at twice the lag is larger. On a sweep of
  clean and noisy synthetic pulses (40 to 180 bpm, 15, 20 and 30 fps, 10, 20 and 45 s windows) it loses no read and
  gains 191 to 234 of 3,654 per path. But end to end it does little: through the session path above it gains 15 of
  792 fast seconds and changes nothing slow, and on the raw processor at 15 and 20 fps it loses more than it gains
  (64 against 58), because a near-right autocorrelation on the whole-sample lag grid (120 at 15 fps reads lag 7,
  128.6) now enters the blend at full weight, where the halved value used to be discounted. With the blend gone it
  still costs those raw-path seconds. So the halving is filed as its own issue below, with interpolation of the lag
  as the lead.
- Removing the calibration model, or its training: it is exported, persisted by `getStateSnapshot()`, and one of
  the resolver's candidates; the option leaves all of that as it is.
- Training it against a Muse reference instead of the resolver: no test or app in this repo feeds it one, so there
  is nothing to measure that against.

**Seen along the way, not changed**

- The autocorrelation (pulseAnalysis.ts, `calculateBpmViaAutocorrelation`): (1) the halving above, also with the
  true rate as the hint; the rule fires on clean signals and almost never on noisy ones (10 of 1,620 noisy fast
  reads in the sweep), so it halves the cleanest signals; (2) no sub-lag interpolation, so at 15 fps 95 and 105 both
  read 100 and 140 reads 150; (3) the 1.3 hint weight covers every lag within 15 bpm of the hint, so a hint 20%
  low pulls 100 to 94.7; (4) on a smooth signal the plain sum falls from lag 0, and the search returns the range's
  edge (over 180 bpm). A version with the clamp removed, the tie kept on the shorter lag and parabolic interpolation
  of the lag read every clean rate in that sweep right, and on the raw path above gained 310 fast seconds at no
  loss, but lost 103 noisy reads of the sweep (an interpolated noisy peak moved off the grid point that was right),
  so it needs its own work before a proposal.
- The half-lag rule (lines 254 to 264) has the same clamped comparison; it doubled 3 of 3,654 sweep reads, none clean.
- The halving reaches `ppg-web` directly: its `PpgProcessor` (64 Hz, one channel) reads every rate from 111 bpm up
  at about half (185 of 608 swept cases, clean and noisy, on main and with fix 5 alike), because its own resolver
  anchors on the most confident estimator and the halved autocorrelation reports full confidence.

**Our own observation (not reproducible from the PR):** 50 recordings we hold, each with a reference rate, each
recording's three face-region colours fed as the three face regions of the session path above (DemoRunner with the
multi-region fuser, tracker on), main's build with the published core, `bpm` read once a second from 20 s, right
within 5 bpm. The default 1,296 of 6,679 seconds right (19.4%); `calibrationBlend: false` 1,625 (24.3%), 35
recordings better, 7 worse (sign test p < 0.001), 421 right seconds gained and 92 lost (1.4%, over the 1% the rule
allows). In the reads where the default shows the blend, the blend was right in 93 and the resolved rate in 378.
On Elata main with fix 4 (POS in the fuser), through the same harness and recordings, the option took 1,895 to 2,282
right seconds (37 recordings better, 8 worse, sign test p < 0.001), and with fixes 4 and 5 from 1,964 to 2,265 (38
better, 11 worse, p < 0.001); seconds reading double the reference fell from 70 and 82 to 0. On our own test build
(test.19), which carries other changes Elata main does not have, the option did not help (2,047 right seconds with
it against 2,094 without, 24 recordings better, 24 worse). The change that takes its value is fix 3 (real frame
rate), shown both ways on 2026-10-13: adding fix 3 to Elata main with fixes 1 and 4 leaves the option no gain (1,942
to 2,015, 25 better, 21 worse, p 0.66), and switching fix 3 off in test.19 brings the gain back (1,902 to 2,114, 30
better, 15 worse, p 0.04). The recordings run at 15 to 29 frames a second; once fix 3 corrects for that, the blend
is right about as often as the resolved rate the option shows, so there is nothing left for the option to correct.
So the option helps on Elata main as it is and with fix 4, and adds nothing on these recordings once fix 3 lands.
Fix 3 is held from the first round, so in that round the option keeps its value. The recordings cannot be shared,
so this is context, not evidence for the PR.

### Merging with the other fixes

No textual conflict with any of the twelve: `git merge-tree` is clean against each branch and against the local
merged tree of all of them (`wip/all-fixes`, now 32ce8b1 with this branch merged twice, the second time for the
test change below). The `import { DemoRunner }` line in the lifecycle test is the same line fixes 1, 4, 11 and 12
add, so it merges once.

Fix 5 removes the spectral doubling, so on a tree with fix 5 the 72 bpm pulse no longer makes the estimators
disagree: the blend is 72 there too. The default-pin test therefore pins only the autocorrelation's disagreement
(120, 140), which no other fix changes (608e797). On main's CHROM fuser the two help each other on real signals: on the 50 recordings
above, through the same session path, fix 5 alone moves 1,296 -> 1,289 right seconds (its lost seconds are mostly
reads where the gate now passes and the blend is shown), this option alone 1,296 -> 1,625, and both 1,653 (fix 5
on top of the option: 60 lost, 88 gained, 19 recordings better, 8 worse). With fix 4 in the tree, as in the first
round, fix 5 adds nothing on top of the option (2,282 -> 2,265, 17 better, 20 worse, p 0.74), so the option's value
does not depend on fix 5. Private, context only.

On the merged tree (all twelve and this one): rppg-web jest 55 suites, 461 tests; `tsc` both configs and Biome lint
clean. With the processor made to ignore the option there, 5 tests turn red (the 72 case cannot fail there, for the
reason above). Fix 12's `engineFallback: false` and this option act on different reads (refused and passed) and
combine without interaction. (Fix 12 is now withdrawn as code and sent as an issue; this note stays as a record.)
First round, 2026-10-12: the eleven fixes being proposed (without the held fix 3 and the withdrawn fix 12), this
branch last, merged onto 49fdb41 with no conflict for it: rppg-web jest 53 suites, 437 tests pass; `tsc` both
configs and Biome lint clean.
