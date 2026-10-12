# Fix 5: the spectral estimator doubles normal resting heart rates

Branch: `fix/no-rate-doubling` on github.com/AMelhede/elata-bio-sdk, tip ea12c6b, six commits on Elata main
49fdb41. Open the PR from a fresh one-commit branch cut from ea12c6b, not from this branch: the first commit's
message names two datasets, quotes private numbers measured on a different base and refers to a change that is not
on main, and GitHub's default squash message for a multi-commit PR lists every commit message, so a squash merge
alone would carry it into main unless the merger edits it (the commits would also stay visible on the PR). The local one-commit ref `pr/no-rate-doubling` (1a73b09, not pushed) is that branch: same tree as ea12c6b, parent
49fdb41, a clean message; open the PR from it. Third maintainer-style review ran on 2026-10-11:
every claim below was re-run, and three commits were added on top: two test commits (5 new tests, 9 in all) and
one that corrects the code comment and the changeset.

**What this PR claims, narrowed after review (2026-10-12).** The doubling rule is a defect on synthetic known
answers: removing it takes 105 clean resting pulses from 69 right to 105 right, and HRV within 30% from 19 to 105
cases. On real camera recordings it does not, on its own, give more right seconds: on our own 50 recordings it
changes nothing measurable (1,296 against 1,289 right seconds of 6,679, p 0.87), and it gains only together with
fix 13's `calibrationBlend: false` (1,625 against 1,653, p 0.05). Those recordings are one person's and cannot be
shared, so they are context. If fix 13's option is not taken, this PR rests on the synthetic cases and the HRV
result, and claims no real-world gain.

## Issue

**Title:** `estimateDominantBpm` turns a correct resting rate into twice that rate when the pulse has a normal second harmonic

`estimateDominantBpm` (exported, the spectral estimate in `analyzePulseWindow`, and so the source of
`RppgProcessor`'s `spectral_bpm`) replaces the strongest rate with twice that rate whenever the strongest rate is
under 85 bpm and the magnitude at twice the rate is more than 35% of it. A pulse wave is not a sine, so the line at twice the rate is never empty. How strong it is varies. On contact
finger PPG, one study of 173 adults reports the second harmonic's amplitude at 0.12 of the fundamental's on average
(SD 0.05, range 0.01 to 0.35; Park et al., Medicine 102(35):e34200, 2023, PMC10476820), so a clean contact pulse
rarely crosses the rule's 0.35. A camera signal is noisier, and noise at twice the rate counts too: on our own camera
recordings (context, see the last section) the ratio at a correct resting rate passed 0.35 in 7 of every 100
analysis windows (median 0.18, 90th percentile 0.34). So correct resting rates are doubled, not always but
routinely. The synthetic cases below put the harmonic at 0.4 to 0.6 so that the rule fires for certain; that range
is chosen to make the defect visible, not drawn from a population. The spectral rate also seeds the peak and
beat-timing (HRV) estimators and is a candidate for the processor's resolved and final rates, so the doubling
reaches the numbers apps read.

**Reproduce on the published package** (`npm i @elata-biosciences/rppg-web@0.14.0`, Node 20+):

```js
import { estimateDominantBpm } from "@elata-biosciences/rppg-web";
const fs = 30, f = 65 / 60;
const x = Array.from({ length: fs * 10 }, (_, i) =>
  Math.sin(2 * Math.PI * f * i / fs) + 0.6 * Math.sin(2 * Math.PI * 2 * f * i / fs + 0.8));
console.log(estimateDominantBpm(x, fs, 0.7, 3.3).bpm); // 132 on 0.14.0; 66 with this fix
```

And through the processor, with a backend that offers no rate of its own:

```js
import { RppgProcessor } from "@elata-biosciences/rppg-web";
const idle = () => ({ bpm: null, confidence: 0.1, signal_quality: 0.9 });
const backend = { newPipeline: () => ({ push_sample_rgb_meta() {}, get_metrics: idle, getMetrics: idle, free() {} }) };
const fs = 30;
for (const [bpm, h2] of [[60, 0.5], [72, 0.4]]) {
  const p = new RppgProcessor(backend, fs, 10), f = bpm / 60;
  for (let i = 0; i < fs * 30; i++) {
    const v = 0.5 + 0.02 * (Math.sin(2 * Math.PI * f * i / fs) + h2 * Math.sin(2 * Math.PI * 2 * f * i / fs + 0.8));
    p.pushSampleRgbMeta(i * 1000 / fs, v, v, v, 0.9, 0.01, 0.01);
  }
  const m = p.getMetrics();
  console.log(bpm, m.bpm, m.confidence.toFixed(2));
}
// 0.14.0: 60 null 0.30 (withheld), 72 98.3 0.83 (confidently wrong); with this fix: 60 60.0 0.94, 72 72.0 0.94
```

Across 105 such clean pulses (50 to 84 bpm, second harmonic at 0.4, 0.5 and 0.6 of the fundamental; "right" here
and below means within 5 bpm of the true rate), 0.14.0's
processor reads 69 right, 12 wrong (about 1.3 times the rate, for example 60 read 84) and withholds 24; with the
fix all 105 read right. `analyzePulseWindow` on 0.14.0 reports double from the spectrum for all 105 and double from
the beats for 70. With a known beat-to-beat variation added to the same 105 pulses (the model in the HRV test), its
HRV (RMSSD) misses the true value by 66 ms on average on 0.14.0 and is within 30% of it in 19; with the fix the
miss is 10 ms on average and all 105 are within 30%.

The rule came in with the repository's initial import (a70e8a6, then in `rppgProcessor.ts`; moved to
`pulseAnalysis.ts` and exported in 61404a0) with no test and no stated reason. No existing test depends on it (the
one test named "double frequency detection" only asserts a non-null rate, at 36 bpm, below the band).

## Pull request

**Title:** fix(rppg-web): stop the spectral estimator doubling the strongest rate

**What changes.** The doubling block in `estimateDominantBpm` is removed; the strongest line in the band is
returned. One comment says why and what it gives up. Changeset (patch, rppg-web): names `estimateDominantBpm` and
`analyzePulseWindow` and says the peak and beat-timing (HRV) estimates and `RppgProcessor`'s resolved and final
rates change with it.

**What does not change, and what follows from it.** No other estimator's code, the band, or the confidence formula.
But wherever the rule used to fire, everything built on the spectral rate moves with it: the peak estimate (122 to
60 for a 60 bpm pulse with a harmonic at 0.5), the beat-timing HRV estimate (it is centred on the spectral rate:
163 to 58.7 ms against a true 67.7 at 60 bpm), and the processor's resolved, Bayes and final rates and confidence
(withheld to 60). The spectral confidence in those cases rises (0.18 to 0.32 in the first reproduction) because it
is now the magnitude of the line actually returned. The autocorrelation and respiration estimates did not move in
any of the 105 sweep cases. `ppg-web` calls `analyzePulseWindow`: for the same 60 bpm pulse at its 64 Hz its
`spectralBpm` goes from 120 to 60, `peaksBpm` from 121 to 60, `rmssdMs` from 164 to 1 on a perfectly regular
pulse, confidence from 0.26 to 0.71, and the `estimators_disagree` reason disappears. Swept (`PpgProcessor`, one channel at 64 Hz, 45 to 180 bpm,
harmonic 0, 0.4, 0.5 and 0.6, clean and with noise, 608 cases): its `bpm` is right in exactly the same cases on
main and here (423 of 608, 0 lost, 0 gained; the 185 wrong on both are true rates from 111 up read at about half,
the autocorrelation halving fix 13 describes, not this change). Where the rule used to fire its `bpm` moves by under
1 bpm, including at 85 itself (the 0.05 Hz grid point nearest 85 is 84.9999, inside the old rule). Its HRV against
an RMSSD solved from the beat times of a pulse with a known phase wander (50 to 84 bpm, harmonic 0.4 to 0.6, 105
cases): within 30% in 23 on main and in 105 here, mean miss 67.9 ms on main and 8.9 here. Its own code and its 8 tests are unchanged. The committed `packages/ppg-web/demo/main.js` bundle
still inlines the old rule; upstream regenerates it in demo builds (it needs the EEG WASM), not in source commits,
so it is left alone. The Rust engine's harmonic picker is separate and untouched.

**The tradeoff, stated.** The rule existed to catch a half-rate error: a signal whose strongest line sits at half
its true rate. That spectrum is the same as a normal pulse with a strong second harmonic, so the estimator cannot
tell them apart: a true 140 with a stronger line at 70 now reads 69, the 0.05 Hz grid point nearest 70 (main read
138 for it, exactly as for a true 70, since the two are the same signal). The normal pulse is the common case;
recovering the rare one needs harmonic evidence the other estimators already carry (the autocorrelation's harmonic
relation, the Bayes tracker's harmonic modes), not a fixed rule on the spectrum. A rate whose second harmonic is the
strongest line (55 bpm with it at 1.5 times, line at 110) reads 110 on main and here, since 110 is above the old
rule's 85 bpm limit; it is pinned as unchanged.

**What it costs, measured.** Right = within 5 bpm of the true rate throughout.

- Noise, where the old rule could only have helped by rescuing a fast rate whose strongest line had fallen to half:
  `estimateDominantBpm` on 10 s windows at 30 fps, the pulse above with harmonic 0.4, 27 rates from 50 to 180,
  white noise at 1, 2 and 3 times the fundamental's amplitude and a random-walk drift at 0.1, 0.2 and 0.4, 20 seeds:
  3,240 windows. This change loses 0 right reads in every noise class and gains 69 to 133 per class, all under 90
  bpm. Through `RppgProcessor` (14 rates from 50 to 180, white 1 and drift 0.2, 5 seeds, 140 runs): 0 lost, 3 gained.
- The processor end to end with the real WASM engine (the grey suite below: R = G = B pulse, 50 to 160 bpm, 15, 20
  and 30 fps, two noise levels, 3 seeds, read once a second from 16 s to 39 s, 2,592 scored seconds): 0.14.0 and
  main 1,813 right, this branch 2,237; 0 lost, 424 gained (50 bpm 310 -> 430 of 432, 72 bpm 128 -> 432; every rate
  from 100 up unchanged). With no pulse (432 seconds of noise only) a number is shown in 230 seconds against 220:
  10 more. That is the one cost on this suite, and it is a number shown where main withheld one, not a right number
  lost.
- The session path (`DemoRunner` with the multi-region fuser and the tracker, a synthetic face whose pulse is a pure
  sine, so the doubling case never arises; 50, 72, 120, 140 and 160 bpm, 20 and 30 fps, 3 seeds, 1,320 seconds):
  main 590, this branch 586; 10 lost and 6 gained. All 10 losses are one 120 bpm run at 20 fps where the spectral,
  autocorrelation and resolved rates read 120 on both builds and the branch shows 134.8: the calibration blend
  (fix 13), whose trained state carries earlier reads. With no pulse, 284 -> 282 of 327 seconds show a number.
  With fix 13's `calibrationBlend: false` on both builds: 856 -> 851, 5 lost (2 at 50 bpm, 3 at 140), 0 gained.
- Not everything doubled is undone: the peak estimate (`analyzePulseWindow().peaks`) is still wrong in 6 of the 105
  clean pulses, all with harmonic 0.6: double at 50 to 54 bpm, and 55 reads 73 (main: double in 70). The processor reads all 105 right.
- `ppg-web`: no right rate lost (above).

The grey suite needs nothing but a built package, so it can be rerun here (Node 20+; a source build of main has no
`pkg/`, so point `WASM_PKG` at the published 0.14.0's; nothing in this PR touches the WASM core). It reads
`p.samples` only for its window self-check:

```
node grey-suite.mjs node_modules/@elata-biosciences/rppg-web packages/rppg-web
# A: right 1813 of 2592 seconds with a pulse; no pulse: a number in 220 of 432; by rate {"50":310,"72":128,"100":430,"120":359,"140":327,"160":259}
# B: right 2237 of 2592 seconds with a pulse; no pulse: a number in 230 of 432; by rate {"50":430,"72":432,"100":430,"120":359,"140":327,"160":259}
# B against A: 0 right seconds lost, 424 gained
```

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

**Considered and not done.**

- Keeping the rule with a higher threshold. On our camera recordings (context, last section) the rule fired in
  1,682 analysis windows. Away from the band's lower edge it never once turned a half-rate read into the right rate,
  and it turned a right rate into a wrong one 41 times. All 183 times its doubled rate was right, the strongest line
  sat at the band's lower edge (42 or 45 bpm, low-frequency drift, not a pulse) and doubling it gave 84 or 90, which
  matched only because those people's rates were 79 to 89; of 1,048 such edge doublings, 865 were wrong. Raising the
  threshold to 0.5 still breaks 6 right reads and keeps 56 lucky edge reads; at 0.7 it breaks none and keeps 18.
  Any threshold keeps the edge behaviour, which shows a fixed 84 or 90 for a window with no pulse in it, so we did
  not propose one.
- Doubling only when another estimator agrees with twice the rate: that is what the resolver and the Bayes tracker
  already do with the autocorrelation and peak candidates, so the spectral estimate does not need its own rule.

**How it was tested.** `spectralNoDoubling.test.ts`, synthetic known answers, 9 tests; 8 are red on main by
assertion and green here: 60, 70 and 80 bpm with second harmonics at 0.5, 0.6 and 0.45 read as themselves (main
reads 120, 138, 162); `analyzePulseWindow` reads 60 from both the spectrum and the beats of a 60 bpm pulse (main 120
and 122; the beats assertion was also checked red on its own); its HRV is within 30% of the RMSSD solved from the
beat times of a pulse with a known phase wander, at 60 and 72 bpm (true 67.7 and 42.4 ms; main 163 and 157, the fix
58.7 and 35.7; across 50 to 84 bpm the fix reads that pulse 11 to 27% low, a separate bias of the estimator, and
main up to four times high); `RppgProcessor` reads 60 with a harmonic at 0.5 and 72 with one at 0.4 (main: withheld,
and 98.3). The ninth, the 55 to 110 case, passes on main too, by design. Full suites at ea12c6b: rppg-web jest 44
suites, 359 tests (main 43 and 350, the difference is the new file); ppg-web 8 of 8 on both; `tsc -p
tsconfig.test.json` clean; package build and the Node consumer smoke pass; repo audit passes; Biome lint clean and
no new format findings (`pulseAnalysis.ts` carries the same 29 lines of format drift as on main; tests and
changesets are outside Biome's scope). Not run: Rust tests (no Rust change) and the Playwright e2e (no rate
assertions, demo untouched).

**Our own observation (not reproducible from the PR):** on private recordings with a contact sensor as truth,
whose licence does not allow sharing their numbers, removing the rule alone made no measurable difference either;
the numbers are in the private appendix (ask Andreas Melhede).

Our own 50 phone and laptop camera recordings of one person [owner] with a reference rate each (45 of them under 85
bpm), each recording's three face-region colours fed as the session path's three regions (`DemoRunner` with the
fuser, tracker on), main's build with the published core, `bpm` read once a second from 20 s. The harmonic ratio
figures in the issue come from this set. Removing the rule alone: 1,296 -> 1,289 right seconds of 6,679 (155 lost, 148 gained; 18 recordings better, 20 worse, sign test p 0.87); seconds reading double 33 -> 15. By the rule we wrote
before running it (lost at most gained) that is a small loss, indistinguishable from none. 99 of the 155 lost seconds are reads where main's gate refused (the estimators disagreed) and showed the engine's raw rate, which was
right, while this branch's gate passed and showed the calibration blend, which was not: the mechanism fix 13 is
about. With fix 13's `calibrationBlend: false` on both: 1,625 -> 1,653 (60 lost, 88 gained; 19 better, 8 worse,
p 0.05). So on real camera signals this change pays only once the shown rate stops being the calibration's blend.

The recordings cannot be shared, so all of this is context, not evidence for the PR.
