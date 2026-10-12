# Issue draft: the Rust engine's harmonic picker overrides a correct spectral peak

Status: issue only, no pull request. Measured 2026-10-10 on Elata main 49fdb41. Not opened.
Every number re-checked 2026-10-11 by an independent run (fresh clone of 49fdb41, probes rewritten from
this description); corrections from that run are folded in below. Re-checked again 2026-10-12: the npm
reproduction on the published 0.14.0, and the four sweep totals with the code attached at the end.

## Title

elata-rppg: `get_metrics` reads a clean 72 bpm signal as 48 and 140 bpm as no reading; the Welch peak is right and `select_harmonic_with_prior` moves it

## What happens

A clean, noise-free sine pushed through `RppgPipeline::push_sample` and read with `get_metrics`, 30 s of input:

| true bpm | 48 | 60 | 66 | 72 | 75 | 80 | 90 | 100 | 120 | 140 | 160 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| read (fs 30, window 10 s) | 58.8 | 66.0 | 46.2 | **48.0** (conf 0.88) | 49.2 | 51.0 | 90.0 | 100.2 | 120.0 | **none** | 160.2 |

The same pattern appears at fs 100 / window 5 s and fs 30 / window 5 s (72 reads 48.0 and 48.6, 60 reads 66.0 and
66.6, 140 reads none at both), so it is not a sample-rate or window mix-up.

Reproduced on 2026-10-11 by an independent run: all eleven values and the 0.88 confidence at fs 30 / window 10 s,
and the pattern at the two other settings as stated.

Reproduction on the published package (`npm install @elata-biosciences/rppg-web@0.14.0`, Node 22, `"type": "module"`), run exactly as written on 2026-10-12:

```js
import { readFileSync } from "node:fs";
import { initSync, WasmRppgPipeline } from "@elata-biosciences/rppg-web/pkg/rppg_wasm.js";
initSync({ module: readFileSync(new URL(import.meta.resolve("@elata-biosciences/rppg-web/pkg/rppg_wasm_bg.wasm"))) });
for (const bpm of [60, 72, 90, 140]) {
  const p = new WasmRppgPipeline(30, 10);
  for (let i = 0; i < 900; i++) p.push_sample(BigInt(Math.round((i / 30) * 1000)), 100 + Math.sin((2 * Math.PI * bpm * i) / 30 / 60));
  const m = JSON.parse(p.get_metrics());
  console.log(`clean sine at ${bpm} bpm reads ${m.bpm ?? "none"} (confidence ${m.confidence.toFixed(2)})`);
}
```

```
clean sine at 60 bpm reads 66 (confidence 0.99)
clean sine at 72 bpm reads 48 (confidence 0.88)
clean sine at 90 bpm reads 90 (confidence 0.82)
clean sine at 140 bpm reads none (confidence 0.00)
```

## Where it happens

Instrumenting `get_metrics_with_prior` (print `peak_f` and the chosen frequency) shows the Welch peak is right in
every case: 1.200 Hz for 72, 1.000 for 60, 2.330 for 140, 1.500 for 90 (within 2 bpm at every rate in the table
above; at 48 it is 0.77 Hz, the band-pass edge). `select_harmonic_with_prior` then moves it. Each cause below was
confirmed by switching off only that step and watching the right rate come back:

- **72 -> 48: the post-hoc tie-break.** `rank_harmonic_candidates` adds `f_peak / 3` for every local peak; a tiny
  local maximum at 2.41 Hz (0.08% of the peak's power) yields a 0.8 Hz candidate. The post-hoc tie-break walks
  the candidates in rank order and requires harmonic support (`support > 0`). The true 1.2 Hz fails that, because
  a clean sine has no harmonic: power at 2.4 Hz is 0.08% of the peak, against a threshold of 38%. 0.8 Hz passes,
  because its second harmonic (1.6 Hz) and its own bin both sit on spectral leakage of the true 1.2 Hz peak (44%
  and 42% of the peak's power), which also meets `has_peak` and `explains_peak`. Without the tie-break: 72.0.
- **60 -> 66: the prior.** The ranking multiplies by the default prior, centred at 102.5 bpm (55 to 150). The
  1.1 Hz candidate is not a peak of its own: it is half of a small ripple maximum at 2.2 Hz, and it sits on the
  shoulder of the true peak (95% of its power). The prior favours 66 over 60 by 1.52 times, which is enough for
  1.1 Hz to outscore the true 1.0 Hz peak (1.37 against 1.01; before the prior the true peak leads, 5.0 against
  4.5). With a flat prior: 60.0.
- **140 -> none: a half-rate candidate, then the severe gate.** The ranking puts 1.16 Hz (half of the 2.33 Hz peak)
  first; the decisive push is the cepstrum boost (the cepstrum points at 1.13 Hz with confidence 1.0, so 1.16 Hz
  gets 4 times its score). Power at 1.16 Hz is 0.17% of the peak, so SNR falls to 0.01 and the severe gate
  (SNR < 1.3) drops the reading. Without the cepstrum boost it reads 133.2 (no longer none, still 7 bpm
  wrong); with the whole picker off, 139.8.

**Why leakage reaches that far.** `welch_periodogram_peak_freq` is called with `seg_len = sample_rate * 2.0`:
2-second Hann segments, whose main lobe is about 1 Hz wide on each side (about 60 bpm). At 60 bpm a segment holds
two beats. Measured at 72 bpm: the peak is 0.72 Hz wide at half power with 2 s segments, against 0.15 Hz with
10 s segments, where no leakage candidate passes the tie-break. Peaks this wide make "is there a peak here" and
"is this a harmonic" questions unanswerable.

Reproduced on 2026-10-11 by an independent instrumented run (`peak_f`, `selected_f`, the candidate scores and
which stage returned): the three mechanisms as stated, with the details above added from that run.

## Known-answer sweep (reproducible, below)

828 synthetic inputs: 46 rates (45 to 180 bpm in 3 bpm steps) times six signal kinds, each offset by 100 and
pushed through `push_sample` for 30 s at fs 30, window 10 s, read once at the end. Right = within 3 bpm.

- three noise-free kinds, one input per rate: a clean sine; a sine with a second harmonic at 0.6 and a third at
  0.3 of the fundamental; a pulse whose second harmonic (1.0) is stronger than its fundamental (0.6), third 0.3;
- the same three with Gaussian noise of sd 1 (equal to the fundamental's amplitude; the two harmonic kinds keep
  only their second harmonic), 5 noise seeds per rate.

| Welch segment | harmonic picker | right (of 828) |
|---|---|---|
| 2 s (today) | on (today) | 448 |
| 2 s | off (plain Welch peak) | 669 |
| 10 s | on | 698 |
| 10 s | off | 728 |

By signal kind (right, of 46 for the noise-free kinds and of 230 for the noisy ones):

| kind | 2 s, on (today) | 2 s, off | 10 s, on | 10 s, off |
|---|---|---|---|---|
| clean | 22 | 46 | 44 | 46 |
| harmonics 0.6 / 0.3 | 34 | 45 | 45 | 45 |
| second harmonic stronger | 26 | 31 | 43 | 31 |
| clean + noise | 151 | 224 | 202 | 230 |
| harmonic 0.6 + noise | 141 | 209 | 206 | 221 |
| second harmonic stronger + noise | 74 | 114 | 158 | 155 |

The picker only helps in one case: a noise-free signal whose second harmonic is stronger than its fundamental, at
10 s segments (43 of 46 against 31). With noise added to that same case it no longer reliably helps: 158 against
155 of 230 with the noise above, 141 against 157 with a second, unrelated noise generator. At today's 2 s
segments it hurts even that case (26 against 31, and 74 against 114 with noise). Today's estimator also gives no
reading at all for 294 of the 828 inputs; with the picker off, 11.

Reproduced on 2026-10-11 by an independent run: 448 / 669 / 698 / 728 exactly, and every per-kind count. The
earlier draft said 1,012 inputs; the six kinds above make 828 (3 x 46 + 3 x 230), and the counts are of 828.
With a second noise generator (xorshift and Box-Muller, other seeds) in place of the first, the four totals are
440 / 676 / 688 / 728: the same order and the same conclusion.

## What a user sees

`push_sample` input is what the default fused path sends, so these misreads reach `getMetrics()` through the
core's share of the reading. Where they show most is the camera-RGB path once the CHROM sign PR is in (it stops
that path from cancelling the pulse, so the core's own estimate becomes visible). At the session level
(`DemoRunner` with `multiRoiFusion: false`, synthetic face frames with one grey level of pixel noise, pulse rates
66 to 135, 3 seeds, the last 20 s of 40 judged, 480 seconds per cell), right / wrong / no reading of the shown
`bpm`, with the sign fix in:

| lamp | picker on (today) | picker off (plain Welch peak) |
|---|---|---|
| none | 140 / 336 / 4 | 232 / 248 / 0 |
| 1% flicker at 60 a minute | 197 / 283 / 0 | 255 / 225 / 0 |

The repeated wrong values in those runs are the table above: 48 for a true 72, 51 for a true 81. On the default
fused path the fuser's own errors dominate and this harness could not isolate the picker's share. The CHROM sign
PR does not change any number in this issue on fused input: it projects windows of `push_sample` values bit for
bit as main does.

## What it does NOT explain (real recordings)

35 real captures from one person and one webcam, each with an optical reference (Oura, 1 bpm resolution, one value
per capture), replayed through the Rust pipeline with region-mean RGB, a reading every second after 10 s,
4,879 judged seconds. Right = within 5 bpm of the reference. Contributor-side measurement; the recordings cannot be
shared.

| colour projection | estimator | seconds shown | right | right, share of shown |
|---|---|---|---|---|
| main | 2 s + picker (today) | 4,005 | 1,502 | 37.5% |
| main | 2 s, plain peak | 4,616 | 1,589 | 34.4% |
| main | 10 s, plain peak | 4,849 | 1,457 | 30.0% |
| sign fixed (`x - alpha * y`) | 2 s + picker | 4,032 | 1,640 | 40.7% |
| sign fixed | 2 s, plain peak | 4,666 | 1,833 | 39.3% |
| sign fixed | 10 s, plain peak | 4,845 | 1,924 | 39.7% |

"Sign fixed" is the separate CHROM sign issue (the colour step adds `alpha * y` where CHROM subtracts it), applied
here as a plain sign flip. The sign PR's exact code (06f93f6: the flip, with windows of R = G = B samples kept as on
main), re-run 2026-10-12 with the every-whole-second judging rule described below, reads 1,630 right of 4,030 shown
(40.4%) against 1,523 of 3,994 (38.1%) for main under the same rule; more right seconds in 21 captures, fewer in 12.

On real captures no estimator variant raises the share of right seconds: there the pulse is often not the strongest
line in the band at all (with the sign fixed and 10 s segments, the plain Welch peak is more than 5 bpm from the
reference in 2,921 of 4,845 shown seconds), and no peak picker can fix that. Removing the picker shows more seconds (4,005 to 4,616 on
main at 2 s), but the share right stays the same or falls (37.5% to 34.4% and 30.0% on main; 40.7% to 39.3% and 39.7%
with the sign fixed). So the picker is a real defect on known answers, but it is not the main reason real
readings are wrong. The colour-sign fix is the one
change here that raises the share right on real captures (37.5% to 40.7%), though modestly: per capture it is
higher in 20 of the 35 and lower in 15.

Reproduced on 2026-10-11 by an independent run: all six rows exactly (same 35 captures, same 4,879 judged
seconds; all 35 from one webcam model at 640 x 480, 30 fps, with a whole-bpm reference typed in at capture). With
a different judging rule (every whole second from 10 s, on the samples up to that second, instead of the first
sample at or after it) every share moves by under 1 point and the conclusion holds.

(On our own test build, which carries the colour-sign fix, the reproduction test below prints identical
readings at all 46 rates and the sweep gives the same 448 of 828. That build is not published by Elata;
this is context, not something to check.)

## Suggested direction (for the maintainers to choose)

1. Score the Welch peak directly, or keep the picker but only accept a candidate that is a local maximum outside
   the main lobe of the best peak and whose support harmonics are local maxima too.
2. Longer Welch segments (half or all of the analysis window) if the picker stays.
3. A unit test sweeping 45 to 180 bpm through `get_metrics`, which today's code fails at 24 of 46 rates (16 misread, 8 with no reading). Three of the 24 sit at the band edges (45, 48 and 180 bpm; the band is 0.75 to 3.0 Hz); excluding them, 21 of the 43 interior rates still fail.

We are not proposing a patch: the evidence we have is synthetic plus one person's camera, and the change touches
every app's rate.

## Reproduction (drop into crates/elata-rppg/tests/, run `cargo test -p elata-rppg --test sine_sweep -- --nocapture`)

```rust
use elata_rppg::pipeline::RppgPipeline;

fn read(fs: f32, win: f32, bpm: f32) -> (Option<f32>, f32) {
    let mut p = RppgPipeline::new(fs, win);
    for i in 0..(fs * 30.0) as usize {
        let t = i as f32 / fs;
        let v = 100.0 + (2.0 * std::f32::consts::PI * bpm / 60.0 * t).sin();
        p.push_sample((t * 1000.0).round() as i64, v);
    }
    let m = p.get_metrics();
    (m.bpm, m.confidence)
}

#[test]
fn clean_sines_read_their_rate() {
    let mut bad = Vec::new();
    for k in 0..=45 {
        let bpm = 45.0 + 3.0 * k as f32;
        let (b, c) = read(30.0, 10.0, bpm);
        println!("{bpm} -> {:?} ({c:.2})", b);
        if b.map_or(true, |x| (x - bpm).abs() > 3.0) { bad.push(bpm); }
    }
    assert!(bad.is_empty(), "misread rates: {bad:?}");
}
```

To see the stage: print `peak_f` and `selected_f` right after `select_harmonic_with_prior` in
`get_metrics_with_prior` (pipeline.rs).

Reproduced on 2026-10-11 by running this test exactly as written on 49fdb41: it fails with
`misread rates: [45.0, 48.0, 51.0, 57.0, 60.0, 63.0, 66.0, 69.0, 72.0, 75.0, 78.0, 81.0, 84.0, 135.0, 138.0,
141.0, 144.0, 147.0, 150.0, 153.0, 156.0, 159.0, 162.0, 180.0]`, 24 of 46 (16 wrong, 8 with no reading, 138 to 159).

## The known-answer sweep, as code

Drop into `crates/elata-rppg/tests/issue1_sweep.rs` and run
`cargo test --release -p elata-rppg --test issue1_sweep -- --nocapture`. The "picker off" and "10 s" columns
need the two environment toggles below in `get_metrics_with_prior` (scratch only, not a proposal); without them
the test prints the "today" column. `RPK_NOISE=xs` switches to the second noise generator. Re-run 2026-10-12 on
49fdb41 with exactly this code and patch: 448, 669, 698 and 728 of 828, and every per-kind count in the table above.

```diff
diff --git a/crates/elata-rppg/src/pipeline.rs b/crates/elata-rppg/src/pipeline.rs
index 062a862..305ab4b 100644
--- a/crates/elata-rppg/src/pipeline.rs
+++ b/crates/elata-rppg/src/pipeline.rs
@@ -291,7 +291,8 @@ impl RppgPipeline {
         let fmin = 0.75_f32;
         let fmax = 3.0_f32;
         let df = 0.01_f32;
-        let seg_len = (self.sample_rate * 2.0) as usize;
+        let seg_sec: f32 = std::env::var("RPK_SEG_SEC").ok().and_then(|v| v.parse().ok()).unwrap_or(2.0);
+        let seg_len = (self.sample_rate * seg_sec) as usize;
         let (peak_f, _peak_p, powers, _fmin, _df) = match welch_periodogram_peak_freq(
             filtered,
             self.sample_rate,
@@ -306,9 +307,12 @@ impl RppgPipeline {
         };
 
         // Robust harmonic disambiguation with prior-backed candidate ranking.
-        let mut selected_f =
+        let mut selected_f = if std::env::var("RPK_NO_PICK").is_ok() {
+            peak_f
+        } else {
             select_harmonic_with_prior(&powers, fmin, df, fmax, self.sample_rate, prior)
-                .unwrap_or(peak_f);
+                .unwrap_or(peak_f)
+        };
         let mut selected_p = power_at_freq(&powers, fmin, df, selected_f).unwrap_or(0.0);
         // Fallback to the raw peak if candidate selection landed off-grid/weak.
         if selected_p <= 0.0 {
```

```rust
// Independent rebuild of the synthetic known-answer sweep.
use elata_rppg::pipeline::RppgPipeline;
use std::f32::consts::PI;

// Noise source 1: the recipe the draft describes (LCG, 12 uniforms summed: sd 1).
struct Lcg(u64);
impl Lcg {
    fn uni(&mut self) -> f32 {
        self.0 = self.0.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
        ((self.0 >> 33) as f32 / (1u64 << 31) as f32) - 0.5
    }
}
// Noise source 2: a different generator entirely (xorshift64*, Box-Muller), different seeds.
struct Xs(u64, Option<f32>);
impl Xs {
    fn u01(&mut self) -> f64 {
        self.0 ^= self.0 >> 12; self.0 ^= self.0 << 25; self.0 ^= self.0 >> 27;
        let v = self.0.wrapping_mul(0x2545F4914F6CDD1D);
        ((v >> 11) as f64 + 0.5) / (1u64 << 53) as f64
    }
    fn gauss(&mut self) -> f32 {
        if let Some(z) = self.1.take() { return z; }
        let (u1, u2) = (self.u01(), self.u01());
        let r = (-2.0 * u1.ln()).sqrt();
        self.1 = Some((r * (2.0 * std::f64::consts::PI * u2).sin()) as f32);
        (r * (2.0 * std::f64::consts::PI * u2).cos()) as f32
    }
}
enum Noise { L(Lcg), X(Xs) }
impl Noise {
    fn g(&mut self) -> f32 { match self { Noise::L(l) => (0..12).map(|_| l.uni()).sum(), Noise::X(x) => x.gauss() } }
}

fn signal(kind: &str, w: f32, n: &mut Noise) -> f32 {
    match kind {
        "clean" => w.sin(),
        "harm" => w.sin() + 0.6 * (2.0 * w + 0.5).sin() + 0.3 * (3.0 * w + 1.0).sin(),
        "strong2" => 0.6 * w.sin() + (2.0 * w + 0.5).sin() + 0.3 * (3.0 * w + 1.0).sin(),
        "noisy" => w.sin() + n.g(),
        "harmnoisy" => w.sin() + 0.6 * (2.0 * w + 0.5).sin() + n.g(),
        "strong2noisy" => 0.6 * w.sin() + (2.0 * w + 0.5).sin() + n.g(),
        _ => unreachable!(),
    }
}

fn read(bpm: f32, kind: &str, noise: &mut Noise) -> Option<f32> {
    let fs = 30.0_f32;
    let mut p = RppgPipeline::new(fs, 10.0);
    for i in 0..(fs * 30.0) as usize {
        let t = i as f32 / fs;
        let w = 2.0 * PI * bpm / 60.0 * t;
        p.push_sample((t * 1000.0).round() as i64, 100.0 + signal(kind, w, noise));
    }
    p.get_metrics().bpm
}

#[test]
fn sweep() {
    let gen = std::env::var("RPK_NOISE").unwrap_or("lcg".into());
    let tag = format!("seg={} pick={} noise={gen}",
        std::env::var("RPK_SEG_SEC").unwrap_or("2".into()),
        if std::env::var("RPK_NO_PICK").is_ok() { "off" } else { "on" });
    let (mut tot_ok, mut tot_n, mut tot_none) = (0, 0, 0);
    let mut parts = Vec::new();
    for kind in ["clean", "harm", "strong2", "noisy", "harmnoisy", "strong2noisy"] {
        let seeds: Vec<u64> = if kind.ends_with("noisy") { (1..=5).collect() } else { vec![1] };
        let (mut ok, mut n, mut none) = (0, 0, 0);
        for k in 0..=45 {
            let b = 45.0 + 3.0 * k as f32;
            for &sd in &seeds {
                let mut nz = if gen == "lcg" { Noise::L(Lcg(sd)) } else { Noise::X(Xs(0x9E3779B97F4A7C15 ^ (sd + 100), None)) };
                n += 1;
                match read(b, kind, &mut nz) {
                    None => none += 1,
                    Some(x) if (x - b).abs() <= 3.0 => ok += 1,
                    Some(_) => {}
                }
            }
        }
        parts.push(format!("{kind} {ok}/{n} (none {none})"));
        tot_ok += ok; tot_n += n; tot_none += none;
    }
    println!("SWEEP {tag}: right {tot_ok}/{tot_n} none {tot_none} | {}", parts.join(" | "));
}
```

---

# Issue draft 2: the fused pulse is divided by its own near-zero average

Status: issue only, not opened. Measured 2026-10-10 on Elata main 49fdb41. Also present on our test build
(release/test-1), whose per-sample pass-through keeps "the same per-window normalisation" (re-checked 2026-10-11:
the table below reproduces there exactly).

## Title

rppg-web + elata-rppg: `pushFusedSample` feeds a zero-mean pulse to `push_sample`, and the Rust projection divides
each 1.6 s window by that window's mean, which is close to zero

## What happens

`DemoRunner` (multi-ROI fusion, the default with face mesh) calls `RppgProcessor.pushFusedSample`, which calls
`pushSample(fusedValue)`, which reaches the WASM `push_sample` as R = G = B = the fused value. The fuser's output is
band-passed, so it averages zero. `pos_from_rgb_windowed_into` normalises every 1.6 s window as `x / mean(x) - 1`.
With a mean near zero, each window gets an arbitrary gain, and its sign flips whenever the window mean changes sign.
Overlap-add then joins windows of unrelated gain every 0.8 s. For a noise-free zero-mean sine over 10 s at fs 30
(11 windows), the gain 1/|mean| ranges from 5 to 50 at 60 bpm and from 17 to 82 at 120 bpm, and the sign flips
between 4 (60 bpm) and 8 (120 bpm) of the 10 neighbouring window pairs.

## Known-answer measurement (Rust only, reproducible)

46 rates from 45 to 180 bpm, 3 noise seeds each, 30 s, fs 30, window 10 s; right = within 3 bpm:

| input | no noise | Gaussian noise, sd 0.3 (pulse amplitude 1) |
|---|---|---|
| sine + offset 100 (camera-like) | 66 of 138 | 105 of 138 |
| zero-mean sine (what the fused path sends) | 72 of 138 | 73 of 138 |

(Without noise the three seeds are the same input, so 66 of 138 is 22 of the 46 rates, three times.)

Without noise both are dominated by issue 1 (the harmonic picker). With noise the zero-mean input loses about a
third of the right readings (105 to 73). With the harmonic picker bypassed (plain Welch peak), which isolates
this issue from issue 1:

| input, picker bypassed | no noise | Gaussian noise, sd 0.3 |
|---|---|---|
| sine + offset 100 | 138 of 138 | 138 of 138 |
| zero-mean sine | 84 of 138 | 87 of 138 |

So the near-zero division alone costs about 51 to 54 of 138.

Reproduced on 2026-10-11 by an independent run: 66 / 72 / 105 / 73 exactly on 49fdb41, and identically on
release/test-1. The picker-bypassed rows are new from that run.

## Suggested direction

Smallest: in `pushFusedSample`, push `1 + fusedValue` (or any constant well above the fused amplitude) so the window
mean is the constant and the normalisation becomes a fixed gain. Checked on known answers in Rust only: with the
pulse at amplitude 0.001, 0.01 or 0.05 (noise 0.3 times that), a zero-mean input reads 72 to 73 of 138 right and
the same input plus 1 reads 104 to 105, the camera-like figure above. Alternative: let the Rust pipeline skip the
per-window mean normalisation for pre-extracted samples. Either needs the before and after numbers on real captures
in an app before it ships, since it changes the WASM-reported rate for every app on the default path.

## Addendum 2026-10-12: the same picker on the processor's colour path (not the cause of the raw-processor misread)

Found while root-causing why `RppgProcessor` fed colour directly (`pushSampleRgb`, no fuser) misreads. That misread
is in the JavaScript side (the processor's own window signal), not here; this is only what the engine itself did on
the same input, for the record. Input: a chromatic pulse in the blood-volume direction (relative R/G/B strength
0.33/0.77/0.53, 0.77% at green) on a 170/120/100 grey-level skin colour, 0.05 grey levels of noise, 30 frames a
second, `newPipeline(30, 10)`, `get_metrics()` read once a second, seconds 16 to 40, three seeds.

- with the colour projection fix (our test build's engine, contributor-side): a true 72 reads 47 to 48 (two thirds of 72) at confidence about
  0.88 in 17% of seconds right overall (the rest 47 to 48); a true 50 reads 49 to 64 (49% right); a true 120 reads
  120 (100%). At 20 frames a second: 72 right 26%, 50 right 75%, 120 right 100%.
- 0.14.0 and Elata main 49fdb41 engines on the same input: no rate in most seconds (LOW_SNR), wrong when there is
  one (85 for 50, 111 for 72, 77 for 120): the published projection adds alpha times Y and cancels the pulse colour
  (that is the colour projection fix, not this issue).

So the picker's 72 to 48 jump shows on the plain colour path too, not only on fused samples. The processor's own
estimators outvote it once they read (see the processor colour-path PR, option `rgbPulse`), which is why it is
not the cause there.
