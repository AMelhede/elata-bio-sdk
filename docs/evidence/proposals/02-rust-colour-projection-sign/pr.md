## Issue: the WASM core's CHROM colour step adds where CHROM subtracts

`pos_from_rgb_windowed_into` (crates/elata-rppg/src/pipeline.rs) uses CHROM's axes, X = 3R - 2G and Y = 1.5R + G - 1.5B on window-normalised channels (de Haan & Jeanne 2013), and combines them as X + alpha*Y. CHROM is X - alpha*Y, as the SDK's own JS `ChromPulseModel` does (`return xs - alpha * ys`). With these axes a lamp moves X and Y by the same amount, so adding doubles it, and a blood-volume pulse moves them in opposite directions, so adding cancels it. (POS adds, but on different axes; with CHROM's axes adding cannot cancel brightness: X = Y = d gives 2d.) The `+` has been there since the repository's first commit (a70e8a6); nothing in the history suggests it was chosen. This path runs whenever the fused multi-region path does not: `video_frame` mode, the FaceMesh fallback, `multiRoiFusion: false`, the skin mask off, low-skin frames, and direct `RppgProcessor.pushSampleRgb*` callers.

Reproduction on the published package (`npm install @elata-biosciences/rppg-web@0.14.0`, Node 22, `"type": "module"`): a 90 bpm pulse in blood-volume-pulse colour (0.33 : 0.77 : 0.53, de Haan & van Leest 2014, 0.4% in green) under a lamp flickering by 1% reads the lamp: 66.6 at 60 a minute, 120 at 120 a minute.

```js
import { readFileSync } from "node:fs";
import { initSync, WasmRppgPipeline } from "@elata-biosciences/rppg-web/pkg/rppg_wasm.js";
initSync({ module: readFileSync(new URL(import.meta.resolve("@elata-biosciences/rppg-web/pkg/rppg_wasm_bg.wasm"))) });
for (const lamp of [60, 120]) {
  const p = new WasmRppgPipeline(30, 10), a = 0.004 / 0.77;
  for (let i = 0; i < 360; i++) {
    const t = i / 30, s = Math.sin(3 * Math.PI * t), k = 1 + 0.01 * Math.sin((2 * Math.PI * lamp * t) / 60 + 0.7);
    p.push_sample_rgb(BigInt(Math.trunc(t * 1000)), 150 * k * (1 - 0.33 * a * s), 120 * k * (1 - 0.77 * a * s), 100 * k * (1 - 0.53 * a * s), 1);
  }
  console.log(`lamp ${lamp}/min, pulse 90: reads ${JSON.parse(p.get_metrics()).bpm}`);
}
```

## PR: fix(rppg): subtract in the CHROM projection so brightness cancels and the pulse survives

**What changes.** One sign in `pos_from_rgb_windowed_into`: `x - alpha * y`, as CHROM is written. A window where every sample has R = G = B (what `push_sample` stores, for example the multi-region fuser's pulse) has no colour to separate, and the plain flip would cancel it, so such a window keeps the exact expression it had before, `x + alpha * y`. Nothing else: no API, option or default changes.

**Why a window of R = G = B samples keeps the old expression.** With R = G = B, X = Y only up to float rounding, so `x + alpha * y` is 2X to about 3e-7. An earlier version of this branch used X alone there; that is the same signal in exact arithmetic, but it changed the `confidence` or `snr` bits in 198 of 210 fused-only runs of the harness below (never the rate), and in a session check through `DemoRunner` with fusion on it moved the shown `bpm` in 169 of 1,920 seconds by up to 1.3 bpm, through near-ties downstream. Keeping the old expression makes the default fused path bit for bit what it was: all 210 harness runs identical to main in `bpm`, `confidence` and `snr` bits, and 0 of the 1,920 session seconds different. `pre_extracted_window_is_projected_as_before` pins it (red with X alone).

**Why per window, not per sample.** A window that mixes camera RGB with fused samples goes through CHROM whole. Normalisation turns the jump between camera-scale values and the fuser's zero-mean values into an equal step on R, G and B, which is brightness, so CHROM cancels it. Decided per sample, the jump stays and sets the reading: `switch_from_camera_rgb_to_fused_reads_the_pulse` reads 66 as 79.8, 90 as 83.4 and 120 as 79.2 that way, and goes red.

**Tests (red on main, green here).**

- `rgb_input_reads_the_pulse_not_the_lamp`: the snippet's input in Rust. Main reads 66.6 and 120.0; this reads 90.0 and 89.4.
- `projection_cancels_brightness_and_keeps_pulse_colour`: the projection itself; a 1% lamp must come out under a tenth of a 0.3% pulse.
- `switch_from_camera_rgb_to_fused_reads_the_pulse`: 9 s of camera RGB then 1 s of fused samples in the window. Reads 66.6, 90.0 and 119.4 for 66, 90 and 120; main reads 89.4 at all three.
- `fused_samples_keep_their_rate` and `pre_extracted_window_is_projected_as_before`: the fused path. Both pass on main; the first goes red with a plain flip (72 reads as 111, along with the existing `metrics_estimate_bpm_on_sine`, `steady_change_is_adopted` and `ffi_wrapper_basic`), the second with X alone.
- `cargo test -p elata-rppg --all-targets` 30/30 plus its doctest; elata-rppg-ffi, elata-rppg-wasm, elata-eeg-ffi and elata-eeg-wasm pass; rppg-web jest 350/350 (its WASM is mocked there). Clippy for elata-rppg clean with `-D warnings`; pipeline.rs rustfmt-clean and rustdoc-clean (workspace fmt and clippy already fail on main in other crates).

**Known answers, every count reproducible.** From the seeded harness at the end (public API only, so the same file runs on main: copy it into `crates/elata-rppg/tests/` on each tree). Right means within 5 bpm of the synthetic rate. Each cell is right / wrong / no reading.

| input | runs | main 49fdb41 | this PR |
|---|---|---|---|
| S1: 13 s camera RGB, then 1 s fused | 62 | 5 / 57 / 0 | 54 / 6 / 2 |
| S2: fused samples only (14 s, 30 s, noisy) | 210 | bits identical to main in all 210 | |
| S3: pulse alone in camera colour, sensor noise | 48 | 0 / 15 / 33 | 48 / 0 / 0 |
| S4: pulse under a 1% lamp, lamp 48 to 168 a minute | 61 | 1 / 60 / 0 (46 of the 60 at the lamp's rate) | 60 / 0 / 1 |
| S5: camera frames at random among fused, 14 s, 10% | 310 | 22 / 64 / 224 | 87 / 39 / 184 |
| same, 30% | 310 | 5 / 74 / 231 | 220 / 24 / 66 |
| same, 50% | 310 | 5 / 70 / 235 | 246 / 38 / 26 |
| same, 30 s, 10% | 310 | 11 / 52 / 247 | 88 / 41 / 181 |
| same, 30 s, 30% | 310 | 3 / 69 / 238 | 214 / 33 / 63 |
| same, 30 s, 50% | 310 | 4 / 74 / 232 | 238 / 47 / 25 |
| S6: camera then fused, or fused then camera, 9 split points | 558 | 312 / 129 / 117 | 423 / 79 / 56 |

Fewer wrong readings than main in every row. S5 and S6 are stress cases: on 10 real webcam recordings played through main's runner routing (our own observation, not reproducible from this PR), 0 of 8,812 windows mixed the two kinds of sample; mixing needs the face to be lost for a moment over a coloured background.

**Through the package** (main's `RppgProcessor`, `pushSampleRgb`, with this branch's WASM; script at the end). Noise-free snippet input: `resolved_bpm` goes from 66.6 to 89.0 (lamp 60) and from 120.0 to 88.7 (lamp 120). `getMetrics().bpm` there is 64.6 and 81.0 on both builds: it also blends the package's JS estimators, which misread this lamp by themselves, so it moves only where the core's estimate decides it. With sensor noise of 0.15 grey levels and the lamp at 60 a minute, seeds 1, 2 and 3, 30 s: `bpm` within 5 of the pulse in 15, 3 and 14 of the last 15 seconds here, 0, 0 and 0 on main; the core's `snr` at 30 s is 4.56, 5.21 and 4.83 here against 39.6, 59.1 and 48.9 on main (the lamp's inflated SNR). Lamp at 72 a minute and no pulse: a rate shown in 0, 2 and 0 of 15 seconds here, 15 of 15 on main for every seed.

**What gets worse, and why.** In short: on the camera-RGB path without a lamp, the share of shown seconds that are wrong falls from 85 in 100 (220 of 259) to 71 in 100 (336 of 476), and right seconds rise from 39 to 140. The raw count of wrong seconds rises (220 to 336) only because this PR shows a number in 476 seconds where main showed one in 259. With a 1% lamp the share falls from 80 in 100 (385 of 480) to 59 in 100 (283 of 480). The detail: on the camera-RGB path at the session level (`DemoRunner` with `multiRoiFusion: false`, synthetic 96 x 96 face frames with one grey level of pixel noise, 8 pulse rates from 66 to 135, 3 seeds, the last 20 s of 40 judged, 480 seconds per cell; script at the end), right / wrong / no reading:

| lamp | main | this PR | this PR with the harmonic picker off (attribution only, not proposed) |
|---|---|---|---|
| none | 39 / 220 / 221 | 140 / 336 / 4 | 232 / 248 / 0 |
| 1% at 60 a minute | 95 / 385 / 0 | 197 / 283 / 0 | 255 / 225 / 0 |

With a lamp this is better on both counts. Without one it shows 101 more right seconds and also 116 more wrong ones, because main mostly withheld (it had cancelled the pulse) and this now passes the core's own estimator errors through: the harmonic picker reads 72 as 48 and 81 as 51 on clean input (separate issue, linked below). Switching the picker off for attribution removes 88 of the 116. So on a camera-RGB path without flicker, a user of this fix alone sees a number in 476 of 480 seconds instead of 259, right in 140 instead of 39 and wrong in 336 instead of 220: the sign is right, and the estimator behind it is now what limits the reading.

**Real captures** (contributor-side, private; the recordings cannot be shared): 35 captures of one person on one webcam, each with an optical reference (one whole-bpm value per capture), three-region mean RGB replayed through `RppgPipeline` with `push_sample_rgb`, a reading every second from 10 s, 4,879 judged seconds, right within 5 bpm. Main: 1,523 right of 3,994 shown (38.1%), 2,471 wrong. This PR: 1,630 right of 4,030 shown (40.4%), 2,400 wrong. More right seconds in 21 captures, fewer in 12, the same in 2 (two-sided sign test p = 0.16). A modest gain on one person; not evidence on its own.

**Cost, measured.** `get_metrics` best-of-7 mean on a full 10 s window, release build, two runs each: fused samples 5.1 to 5.3 ms on both; camera RGB under the lamp 11.5 and 12.7 ms here against 13.4 ms on main (the signal differs, so the estimator's path differs). The window check is one comparison pass over 48 samples per 1.6 s window.

**Considered and not taken.**

- Plain sign flip: cancels the fused path (72 reads as 111) and breaks three existing tests and `ffi_wrapper_basic`.
- Bypass decided per sample: the switch test goes red (66 reads 79.8).
- X alone for R = G = B windows (this branch before 06f93f6): same signal in exact arithmetic, but not bit-identical on the default path (numbers above).
- An explicit "pre-extracted" flag stored with each sample instead of comparing R, G and B: the same result for `push_sample` input. For a camera that sends R = G = B through `push_sample_rgb` (a greyscale or infrared sensor, or a fully clipped region) it would apply CHROM to a window with no colour and cancel it, as the plain flip does; comparing the values keeps such a camera reading as it does on main. It would also add a field to every stored sample.
- Resetting the core's buffer in JS when `DemoRunner` switches between camera RGB and fused samples: it removes mixed windows but not the sign error on pure camera RGB, which is what the lamp and pulse-alone rows measure, and it costs up to a full window of history at every switch.
- A separate path for pre-extracted samples without per-window normalisation: changes every reading on the default fused path, which this PR keeps bit for bit; it belongs with the fuser's near-zero-mean issue below.
- POS's axes in the core (X = G - B, Y = -2R + G + B, X + alpha * Y; R = G = B windows as here), measured as a scratch variant on the same inputs: S1 57 / 3 / 2, S3 and S4 the same as this PR, S6 427 / 75 / 56, but S5 fewer right in every cell (79 against 87 at 14 s and 10%, 78 against 88 at 30 s and 10%). On the 35 private captures above it reads 1,863 right of 4,230 shown (44.0%), 2,367 wrong; more right seconds than this PR in 24 captures, fewer in 9 (p = 0.01). Not taken here because it replaces the method rather than restoring the one the code names, and it was not better on every known answer. That real-capture lead was found on those 35, so it was checked on 15 other private captures of the same person that had not been used to find it: there it read 607 right against this PR's 617, better in 6 captures and worse in 8, with more wrong seconds (1,198 against 1,156). The lead did not hold, so it is not proposed, now or as a follow-up. On synthetic input it is more robust in one case (a lamp with a noisy blue channel, where this PR's alpha drifts from 1 and the lamp leaks), recorded on the fork's `fix/rust-pos-axes`.

**Docs.** Rustdoc on `push_sample` and `get_metrics` says how pre-extracted samples are treated. The design note and the implementation plan called the core's projection POS-style; they now say CHROM, and POS moves to the planned views. The private function keeps its `pos_` name to keep this diff small; renaming it is a separate, mechanical change.

**Versioning.** elata-rppg is a public crate (0.1.0 on crates.io): its next release changes `get_metrics` output for RGB input (a fix, patch). Crate versions are bumped in Cargo.toml at release, per docs/releasing.md. The rppg-web changeset is a patch.

**Commits.** One commit on 49fdb41. (The working history, five commits ending 06f93f6, stays on the fork's `fix/rust-colour-projection-sign`; its first commit predates review and its body carries a claim corrected later.)

**Found along the way, separate issues:** the Rust estimator reads a clean 72 bpm sine as 48 and 140 as none on main and here; the fuser's zero-mean output is divided by a near-zero window mean in this function; the package's JS estimators read this 90 bpm pulse under a 1% lamp as 62 and 77 (`calibrated_bpm`) with either WASM. "Restores CHROM's sign" rather than "is now CHROM": CHROM band-passes X and Y before alpha, which this code does not (older, out of scope).

<details><summary>The seeded harness (crates/elata-rppg/tests/colour_projection_counts.rs, not part of this PR)</summary>

```rust
//! Counts quoted in the CHROM sign PR, reproducible on any tree with the same public API.
//! Copy into crates/elata-rppg/tests/ and run:
//!   cargo test --release -p elata-rppg --test colour_projection_counts -- --ignored --nocapture
//! Synthetic input only: a pulse in blood-volume-pulse colour (R : G : B = 0.33 : 0.77 : 0.53,
//! 0.4% in green), optional 1% lamp flicker, optional sensor noise from a seeded generator.
//! "Right" means within 5 bpm of the true rate.
use elata_rppg::pipeline::RppgPipeline;
use std::f32::consts::PI;

const FS: f32 = 30.0;
const A: f32 = 0.004 / 0.77;

struct Lcg(u64);
impl Lcg {
    fn uni(&mut self) -> f32 {
        self.0 = self
            .0
            .wrapping_mul(6364136223846793005)
            .wrapping_add(1442695040888963407);
        (self.0 >> 40) as f32 / (1u64 << 24) as f32
    }
    fn gauss(&mut self) -> f32 {
        (0..12).map(|_| self.uni()).sum::<f32>() - 6.0
    }
}

fn camera(t: f32, bpm: f32, lamp: Option<f32>, noise: f32, rng: &mut Lcg) -> (f32, f32, f32) {
    let p = (2.0 * PI * bpm / 60.0 * t).sin();
    let k = lamp.map_or(1.0, |l| 1.0 + 0.01 * (2.0 * PI * l / 60.0 * t + 0.7).sin());
    (
        150.0 * k * (1.0 - 0.33 * A * p) + noise * rng.gauss(),
        120.0 * k * (1.0 - 0.77 * A * p) + noise * rng.gauss(),
        100.0 * k * (1.0 - 0.53 * A * p) + noise * rng.gauss(),
    )
}

fn fused(t: f32, bpm: f32) -> f32 {
    (2.0 * PI * bpm / 60.0 * t).sin()
}

fn ts(t: f32) -> i64 {
    (t * 1000.0) as i64
}

#[derive(Default)]
struct Tally {
    right: u32,
    wrong: u32,
    none: u32,
}
impl Tally {
    fn add(&mut self, got: Option<f32>, bpm: f32) {
        match got {
            None => self.none += 1,
            Some(b) if (b - bpm).abs() <= 5.0 => self.right += 1,
            Some(_) => self.wrong += 1,
        }
    }
    fn show(&self) -> String {
        format!(
            "right {} wrong {} none {} of {}",
            self.right,
            self.wrong,
            self.none,
            self.right + self.wrong + self.none
        )
    }
}

/// Fails loudly if the harness itself cannot read a clean pulse or miscounts samples.
fn self_check() {
    let n = (14.0 * FS) as usize;
    assert_eq!(n, 420, "sample count");
    let mut p = RppgPipeline::new(FS, 10.0);
    for i in 0..n {
        let t = i as f32 / FS;
        p.push_sample(ts(t), 100.0 + fused(t, 90.0));
    }
    let got = p.get_metrics().bpm;
    assert!(
        got.is_some_and(|b| (b - 90.0).abs() <= 2.0),
        "self-check: clean 90 read {got:?}"
    );
}

#[test]
#[ignore]
fn colour_projection_counts() {
    self_check();

    // S1: 13 s of camera RGB, then 1 s of fused samples (the moment a runner switches to the fuser).
    let mut s1 = Tally::default();
    for k in 0..62 {
        let bpm = 48.0 + 2.0 * k as f32;
        let mut rng = Lcg(1);
        let mut p = RppgPipeline::new(FS, 10.0);
        for i in 0..(14.0 * FS) as usize {
            let t = i as f32 / FS;
            if t < 13.0 {
                let (r, g, b) = camera(t, bpm, None, 0.0, &mut rng);
                p.push_sample_rgb(ts(t), r, g, b, 1.0);
            } else {
                p.push_sample(ts(t), fused(t, bpm));
            }
        }
        s1.add(p.get_metrics().bpm, bpm);
    }
    println!("S1 switch camera->fused, 62 rates 48..170: {}", s1.show());

    // S2: fused samples only. Printed in full so two trees can be diffed character for character.
    let mut s2 = vec![];
    for &(dur, noise) in &[(14.0_f32, 0.0_f32), (30.0, 0.0), (14.0, 0.05)] {
        for k in 0..70 {
            let bpm = 42.0 + 2.0 * k as f32;
            let mut rng = Lcg(7 + k as u64);
            let mut p = RppgPipeline::new(FS, 10.0);
            for i in 0..(dur * FS) as usize {
                let t = i as f32 / FS;
                p.push_sample(ts(t), fused(t, bpm) + noise * rng.gauss());
            }
            let m = p.get_metrics();
            s2.push(format!(
                "{bpm}:{:?}/{:?}/{:?}",
                m.bpm.map(f32::to_bits),
                m.confidence.to_bits(),
                m.snr.to_bits()
            ));
        }
    }
    println!("S2 fused only (bits of bpm/confidence/snr): {}", s2.join(" "));

    // S3: a pulse alone in camera colour, sensor noise 0.15 levels, 20 s.
    let mut s3 = Tally::default();
    for k in 0..16 {
        let bpm = 87.0 + 3.0 * k as f32;
        for seed in 1..=3u64 {
            let mut rng = Lcg(seed * 7919 + k as u64);
            let mut p = RppgPipeline::new(FS, 10.0);
            for i in 0..(20.0 * FS) as usize {
                let t = i as f32 / FS;
                let (r, g, b) = camera(t, bpm, None, 0.15, &mut rng);
                p.push_sample_rgb(ts(t), r, g, b, 1.0);
            }
            s3.add(p.get_metrics().bpm, bpm);
        }
    }
    println!("S3 pulse alone in camera colour, 16 rates 87..132 x 3 seeds: {}", s3.show());

    // S4: a pulse under a 1% lamp, lamp rates 48..168 not within 10 of the pulse, its half or double.
    let (mut s4, mut at_lamp) = (Tally::default(), 0);
    for &bpm in &[90.0_f32, 99.0, 108.0, 120.0] {
        for j in 0..21 {
            let lamp = 48.0 + 6.0 * j as f32;
            if [bpm, bpm / 2.0, bpm * 2.0].iter().any(|x| (lamp - x).abs() < 10.0) {
                continue;
            }
            let mut rng = Lcg(1000 + j as u64 + bpm as u64);
            let mut p = RppgPipeline::new(FS, 10.0);
            for i in 0..(20.0 * FS) as usize {
                let t = i as f32 / FS;
                let (r, g, b) = camera(t, bpm, Some(lamp), 0.15, &mut rng);
                p.push_sample_rgb(ts(t), r, g, b, 1.0);
            }
            let got = p.get_metrics().bpm;
            if got.is_some_and(|b| (b - bpm).abs() > 5.0 && (b - lamp).abs() <= 5.0) {
                at_lamp += 1;
            }
            s4.add(got, bpm);
        }
    }
    println!("S4 pulse under a 1% lamp: {} (wrong at the lamp's rate {at_lamp})", s4.show());

    // S5: camera RGB frames interleaved at random into fused frames.
    for &dur in &[14.0_f32, 30.0] {
        for &frac in &[0.1_f32, 0.3, 0.5] {
            let mut s5 = Tally::default();
            for seed in 0..5u64 {
                for k in 0..62 {
                    let bpm = 48.0 + 2.0 * k as f32;
                    let mut rng = Lcg(seed * 1_000_003 + k as u64 * 7 + 11);
                    let mut p = RppgPipeline::new(FS, 10.0);
                    for i in 0..(dur * FS) as usize {
                        let t = i as f32 / FS;
                        if rng.uni() < frac {
                            let (r, g, b) = camera(t, bpm, None, 0.0, &mut rng);
                            p.push_sample_rgb(ts(t), r, g, b, 1.0);
                        } else {
                            p.push_sample(ts(t), fused(t, bpm));
                        }
                    }
                    s5.add(p.get_metrics().bpm, bpm);
                }
            }
            println!("S5 random interleave {dur} s, {:.0}% camera, 5 seeds x 62 rates: {}", frac * 100.0, s5.show());
        }
    }

    // S6: sequential mixes inside one 14 s run: camera then fused, and fused then camera.
    let mut s6 = Tally::default();
    for k in 0..62 {
        let bpm = 48.0 + 2.0 * k as f32;
        for &(split, camera_first) in &[
            (6.0_f32, true),
            (8.0, true),
            (10.0, true),
            (12.0, true),
            (13.0, true),
            (6.0, false),
            (8.0, false),
            (10.0, false),
            (12.0, false),
        ] {
            let mut rng = Lcg(3);
            let mut p = RppgPipeline::new(FS, 10.0);
            for i in 0..(14.0 * FS) as usize {
                let t = i as f32 / FS;
                if (t < split) == camera_first {
                    let (r, g, b) = camera(t, bpm, None, 0.0, &mut rng);
                    p.push_sample_rgb(ts(t), r, g, b, 1.0);
                } else {
                    p.push_sample(ts(t), fused(t, bpm));
                }
            }
            s6.add(p.get_metrics().bpm, bpm);
        }
    }
    println!("S6 sequential mixes, 62 rates x 9 splits: {}", s6.show());

    // S7: cost. get_metrics on a full 10 s window of camera RGB and of fused samples, best of 7 x 300 calls.
    let time = |p: &mut RppgPipeline| {
        let _ = p.get_metrics();
        let mut best = f64::MAX;
        for _ in 0..7 {
            let t0 = std::time::Instant::now();
            for _ in 0..300 {
                std::hint::black_box(p.get_metrics());
            }
            best = best.min(t0.elapsed().as_secs_f64() / 300.0);
        }
        best * 1e6
    };
    let (mut cam, mut fus, mut rng) = (RppgPipeline::new(FS, 10.0), RppgPipeline::new(FS, 10.0), Lcg(9));
    for i in 0..(12.0 * FS) as usize {
        let t = i as f32 / FS;
        let (r, g, b) = camera(t, 90.0, Some(60.0), 0.15, &mut rng);
        cam.push_sample_rgb(ts(t), r, g, b, 1.0);
        fus.push_sample(ts(t), fused(t, 90.0));
    }
    println!("S7 get_metrics best-of-7 mean: camera RGB {:.0} us, fused {:.0} us", time(&mut cam), time(&mut fus));
}
```

It checks itself first: a clean 90 bpm `push_sample` sine must read within 2 bpm and 14 s must be 420 samples; both checks were broken once on purpose and panicked. S7 prints the timing above.

</details>

<details><summary>Package-level script (Node 22; a folder with main's built `dist/` and this branch's wasm-bindgen `pkg/`)</summary>

```js
// Package-level lamp check: RppgProcessor.pushSampleRgb with a pulse under a flickering lamp (Node, real WASM).
// Usage: node pkglamp.mjs <dir with dist/ and pkg/> <pulse bpm or 0> <lamp per min> <noise sd> <seconds> [seed]
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
const [DIR, PULSE, LAMP, NOISE, SECS, SEED = "1"] = process.argv.slice(2);
const sdk = await import(pathToFileURL(`${DIR}/dist/index.js`).href);
const wasm = readFileSync(`${DIR}/pkg/rppg_wasm_bg.wasm`);
const backend = await sdk.loadWasmBackend(async (u) => { const m = await import(u); m.initSync?.({ module: wasm }); return m; }, { strict: true, jsUrl: pathToFileURL(`${DIR}/pkg/rppg_wasm.js`).href });
if (!backend) throw new Error("no backend");
const proc = new sdk.RppgProcessor(backend, 30, 10);
let s = Number(SEED) >>> 0 || 1; const u = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) + 0.5) / 2 ** 32;
const gauss = () => { let a = 0; for (let i = 0; i < 12; i++) a += u(); return a - 6; };
const a = 0.004 / 0.77, nz = Number(NOISE), pulse = Number(PULSE), lamp = Number(LAMP);
const rows = [];
for (let i = 0; i < Number(SECS) * 30; i++) {
  const t = i / 30, p = pulse ? Math.sin((2 * Math.PI * pulse * t) / 60) : 0;
  const k = 1 + 0.01 * Math.sin((2 * Math.PI * lamp * t) / 60 + 0.7);
  proc.pushSampleRgb(Math.trunc(t * 1000), 150 * k * (1 - 0.33 * a * p) + nz * gauss(), 120 * k * (1 - 0.77 * a * p) + nz * gauss(), 100 * k * (1 - 0.53 * a * p) + nz * gauss(), 1);
  if ((i + 1) % 30 === 0) { const m = proc.getMetrics(); rows.push(m); }
}
const f = (x, d = 1) => (x == null || Number.isNaN(x) ? "-" : Number(x).toFixed(d));
const last = rows[rows.length - 1];
const lastN = rows.slice(-15);
console.log(JSON.stringify({ dir: DIR.split("/").pop(), pulse, lamp, noise: nz, end: { bpm: f(last.bpm), resolved: f(last.resolved_bpm), snr: f(last.snr, 2), conf: f(last.confidence, 2) },
  last15bpm: lastN.map((m) => f(m.bpm, 0)).join(" "), last15resolved: lastN.map((m) => f(m.resolved_bpm, 0)).join(" ") }));
```

Run as `node pkglamp.mjs <dir> 90 60 0.15 30 <seed>` and `node pkglamp.mjs <dir> 0 72 0.15 30 <seed>` for seeds 1 to 3.

</details>

<details><summary>Session-level script (same folder layout)</summary>

```js
// Session-level check: synthetic face frames, pulse in BVP colour under a 1% flickering lamp, through
// DemoRunner -> RppgProcessor -> RppgSession with the real WASM core (Node). multiRoiFusion off or on.
// Usage: node session.mjs <dir dist/+pkg/> <pulse bpm> <lamp per min> <fusion on|off> <seed>
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
const [DIR, BPM, LAMP, FUSION, SEED = "1"] = process.argv.slice(2);
const sdk = await import(pathToFileURL(`${DIR}/dist/index.js`).href);
const wasm = readFileSync(`${DIR}/pkg/rppg_wasm_bg.wasm`);
const backend = await sdk.loadWasmBackend(async (u) => { const m = await import(u); m.initSync?.({ module: wasm }); return m; }, { strict: true, jsUrl: pathToFileURL(`${DIR}/pkg/rppg_wasm.js`).href });
const source = { onFrame: null, async start() {}, async stop() {} };
const processor = new sdk.RppgProcessor(backend, 30, 10);
const runner = new sdk.DemoRunner(source, processor, { sampleRate: 30, useSkinMask: true, multiRoiFusion: FUSION === "on" });
const session = new sdk.RppgSession(source, processor, runner, "wasm", "face_mesh");
await session.start();
const W = 96, H = 96, rois = [{ x: 33, y: 10, w: 30, h: 14 }, { x: 14, y: 40, w: 22, h: 22 }, { x: 60, y: 40, w: 22, h: 22 }];
const landmarks = Array.from({ length: 478 }, (_, i) => ({ x: (10 + ((i % 22) / 21) * 76) / W, y: (5 + (Math.floor(i / 22) / 21) * 86) / H, z: 0 }));
let s = Number(SEED) >>> 0 || 1; const u = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) + 0.5) / 2 ** 32;
const bpm = Number(BPM), lamp = Number(LAMP), a = 0.004 / 0.77;
const shown = [], core = [];
for (let i = 0; i < 40 * 30; i++) {
  const t = (i * 1000) / 30; const q = bpm ? a * Math.sin((2 * Math.PI * bpm * t) / 60000) : 0;
  const k = 1 + 0.01 * Math.sin((2 * Math.PI * lamp * t) / 60000 + 0.7);
  const data = new Uint8ClampedArray(W * H * 4);
  for (let p = 0; p < W * H; p++) {
    data[4 * p] = 190 * k * (1 - 0.33 * q) + (u() - 0.5) * 2; data[4 * p + 1] = 130 * k * (1 - 0.77 * q) + (u() - 0.5) * 2;
    data[4 * p + 2] = 110 * k * (1 - 0.53 * q) + (u() - 0.5) * 2; data[4 * p + 3] = 255;
  }
  source.onFrame({ data, width: W, height: H, rois, roi: { x: 10, y: 5, w: 76, h: 86 }, landmarks, timestampMs: t });
  if ((i + 1) % 30 === 0) { const m = session.getMetrics(); shown.push(m.bpm == null ? null : m.bpm); core.push(m.resolved_bpm ?? null); }
}
await session.stop();
const last = shown.slice(-20), lastCore = core.slice(-20);
const within = (x) => x != null && Math.abs(x - bpm) <= 5;
console.log(JSON.stringify({ dir: DIR.split("/").pop(), bpm, lamp, fusion: FUSION, seed: SEED,
  shownRight: last.filter(within).length, shownAny: last.filter((x) => x != null).length, shownAtLamp: last.filter((x) => x != null && Math.abs(x - lamp) <= 5).length,
  resolvedRight: lastCore.filter(within).length, last20: last.map((x) => (x == null ? "-" : Math.round(x))).join(" ") }));
```

Run as `node session.mjs <dir> <bpm> <lamp 0 or 60> off <seed>` for bpm 66, 72, 81, 90, 99, 108, 120, 135 and seeds 1 to 3; right, wrong and no reading are summed over the last 20 seconds.

</details>

### Merging with the other fixes

No conflicts with any of the other fixes; recommended second, after the no-face fix, though any position merges cleanly. Checked on all of them merged together (a local branch, not pushed), last on 2026-10-12 with this branch at 06f93f6: `cargo test -p elata-rppg --all-targets` 30/30 plus the doctest, clippy with `-D warnings` clean, elata-rppg-ffi and elata-rppg-wasm pass, and each new test still goes red when its part is removed (main's sign: 3 red; no bypass: 3 red, two of them existing tests; bypass decided per sample: 1 red; X alone for pre-extracted windows: 1 red).

With POS in the fuser and the fuser's zero-mean output: the WASM core was built from the merged tree twice, once with this fix and once with main's `pipeline.rs`, and driven through the merged `DemoRunner` and `RppgProcessor` (synthetic face frames, a chromatic pulse 0.4% deep with one grey level of sensor noise, 54 to 140 bpm, POS and CHROM in the fuser, three seeds: 144 runs at 30 and 15 fps read at 15, 20 and 25 s, and 72 runs at 30 fps read every second from 5 to 12 s). The core's rate was identical with and without this fix in every run, including the reads whose window holds the switch from camera RGB to fused samples. That matches what this PR states for windows of fused samples: on the default fused path it changes nothing (bit for bit, since 06f93f6), and its effect is on the camera-RGB paths. The mixed windows did not move a reading because each 1.6 s window of the fuser's zero-mean values is divided by its own near-zero mean, which makes those samples far larger than the camera RGB beside them (the separate issue named above).
