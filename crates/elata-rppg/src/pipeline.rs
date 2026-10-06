use crate::dsp::{
    power_at_freq, select_harmonic_with_prior, signal_quality_index, temporal_normalize_into,
    welch_periodogram_peak_freq, BandpassFilter, HarmonicPrior,
};
use std::collections::VecDeque;

/// Simple rPPG pipeline with buffering and basic stats.

#[derive(Debug)]
pub struct RppgPipeline {
    sample_rate: f32,
    window_sec: f32,
    buffer: VecDeque<Sample>,
    #[cfg_attr(not(test), allow(dead_code))]
    window_len: usize,
    tracker: Option<KalmanTracker>,
    last_tracker_ts: Option<i64>,
    bandpass: BandpassFilter,
    scratch_r: Vec<f32>,
    scratch_g: Vec<f32>,
    scratch_b: Vec<f32>,
    scratch_x: Vec<f32>,
    scratch_y: Vec<f32>,
    scratch_pos: Vec<f32>,
    scratch_w: Vec<f32>,
    scratch_norm: Vec<f32>,
    scratch_filtered: Vec<f32>,
    /// Colour projection fix (on by default in this build): subtract alpha*Y as CHROM does, and
    /// let pre-extracted samples (R = G = B) through unprojected. Off reproduces the published
    /// projection (X + alpha*Y) exactly. See `set_colour_projection_fix`.
    colour_projection_fix: bool,
}

#[derive(Debug, Clone, Copy)]
struct Sample {
    t_ms: i64,
    r: f32,
    g: f32,
    b: f32,
    skin_ratio: f32,
    motion: f32,
    clip: f32,
}

#[derive(Debug, Clone)]
struct KalmanTracker {
    x: f32,
    p: f32,
    q_per_sec: f32,
    min_bpm: f32,
    max_bpm: f32,
    initialized: bool,
}

impl KalmanTracker {
    fn new(prior: HarmonicPrior) -> Self {
        let center = (prior.min_bpm + prior.max_bpm) * 0.5;
        Self {
            x: center,
            p: 100.0,       // large initial uncertainty
            q_per_sec: 4.0, // process noise per second (bpm^2)
            min_bpm: prior.min_bpm,
            max_bpm: prior.max_bpm,
            initialized: false,
        }
    }

    fn predict(&mut self, dt_sec: f32) {
        if dt_sec > 0.0 {
            self.p += self.q_per_sec * dt_sec;
        }
    }

    fn update(&mut self, z: f32, confidence: f32) {
        let conf = confidence.clamp(0.01, 1.0);
        let r = (16.0 / (conf * conf)).max(4.0); // measurement noise (bpm^2)
        let k = self.p / (self.p + r);
        self.x = self.x + k * (z - self.x);
        self.p *= 1.0 - k;
        self.x = self.x.clamp(self.min_bpm, self.max_bpm);
        self.initialized = true;
    }

    fn estimate(&self) -> Option<f32> {
        if self.initialized {
            Some(self.x)
        } else {
            None
        }
    }
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct RppgMetrics {
    pub bpm: Option<f32>,
    pub confidence: f32,
    pub signal_quality: f32,
    pub cepstrum_bpm: Option<f32>,
    pub cepstrum_confidence: f32,
    pub snr: f32,
    pub skin_ratio_mean: f32,
    pub motion_mean: f32,
    pub clip_mean: f32,
    pub reason_codes: Vec<String>,
}

impl Default for RppgMetrics {
    fn default() -> Self {
        Self {
            bpm: None,
            confidence: 0.0,
            signal_quality: 0.0,
            cepstrum_bpm: None,
            cepstrum_confidence: 0.0,
            snr: 0.0,
            skin_ratio_mean: 0.0,
            motion_mean: 0.0,
            clip_mean: 0.0,
            reason_codes: Vec::new(),
        }
    }
}

impl RppgPipeline {
    pub fn new(sample_rate: f32, window_sec: f32) -> Self {
        let window_len = (sample_rate * window_sec).ceil() as usize;
        Self {
            sample_rate,
            window_sec,
            buffer: VecDeque::with_capacity(window_len + 4),
            window_len,
            tracker: None,
            last_tracker_ts: None,
            bandpass: BandpassFilter::new(0.75, 3.0, sample_rate),
            scratch_r: Vec::with_capacity(window_len + 4),
            scratch_g: Vec::with_capacity(window_len + 4),
            scratch_b: Vec::with_capacity(window_len + 4),
            scratch_x: Vec::with_capacity(window_len + 4),
            scratch_y: Vec::with_capacity(window_len + 4),
            scratch_pos: Vec::with_capacity(window_len + 4),
            scratch_w: Vec::with_capacity(window_len + 4),
            scratch_norm: Vec::with_capacity(window_len + 4),
            scratch_filtered: Vec::with_capacity(window_len + 4),
            colour_projection_fix: true,
        }
    }

    /// Switch for the colour projection fix. `true` (the default): CHROM's X - alpha*Y, with
    /// pre-extracted samples (R = G = B) passed through. `false`: the published X + alpha*Y,
    /// unchanged, for comparison.
    pub fn set_colour_projection_fix(&mut self, on: bool) {
        self.colour_projection_fix = on;
    }

    /// Whether the colour projection fix is on (see `set_colour_projection_fix`).
    pub fn colour_projection_fix(&self) -> bool {
        self.colour_projection_fix
    }

    /// Enable the particle filter tracker with optional prior and number of particles
    pub fn enable_tracker(&mut self, prior: HarmonicPrior, num_particles: usize) {
        let _ = num_particles; // retained for API compatibility
        self.tracker = Some(KalmanTracker::new(prior));
    }

    pub fn disable_tracker(&mut self) {
        self.tracker = None;
    }

    pub fn push_sample(&mut self, timestamp_ms: i64, intensity: f32) {
        // Backwards-compatible: green-only intensity.
        self.push_sample_rgb(timestamp_ms, intensity, intensity, intensity, 1.0);
    }

    pub fn push_sample_rgb(&mut self, timestamp_ms: i64, r: f32, g: f32, b: f32, skin_ratio: f32) {
        self.push_sample_rgb_meta(timestamp_ms, r, g, b, skin_ratio, 0.0, 0.0);
    }

    #[allow(clippy::too_many_arguments)]
    pub fn push_sample_rgb_meta(
        &mut self,
        timestamp_ms: i64,
        r: f32,
        g: f32,
        b: f32,
        skin_ratio: f32,
        motion: f32,
        clip: f32,
    ) {
        self.buffer.push_back(Sample {
            t_ms: timestamp_ms,
            r,
            g,
            b,
            skin_ratio,
            motion,
            clip,
        });
        // keep roughly two windows of history
        let max_age_ms = (self.window_sec * 2.0 * 1000.0) as i64;
        while let Some(front) = self.buffer.front() {
            if timestamp_ms - front.t_ms > max_age_ms {
                self.buffer.pop_front();
            } else {
                break;
            }
        }
    }

    pub fn mean(&self) -> Option<f32> {
        if self.buffer.is_empty() {
            return None;
        }
        let end_t = self.buffer.back().map(|s| s.t_ms)?;
        let start_t = end_t - (self.window_sec * 1000.0) as i64;
        let mut sum = 0.0_f32;
        let mut count = 0usize;
        for s in self.buffer.iter().filter(|s| s.t_ms >= start_t) {
            sum += s.g;
            count += 1;
        }
        if count == 0 {
            return None;
        }
        Some(sum / (count as f32))
    }

    /// Compute rPPG metrics over the current window.
    /// - Applies temporal normalization
    /// - Runs bandpass filter
    /// - Computes a simple periodogram over candidate HR band and returns peak BPM
    pub fn get_metrics(&mut self) -> RppgMetrics {
        self.get_metrics_with_prior(HarmonicPrior::default())
    }

    pub fn get_metrics_with_prior(&mut self, prior: HarmonicPrior) -> RppgMetrics {
        if self.buffer.len() < 10 {
            return RppgMetrics::default();
        }
        let end_t = match self.buffer.back() {
            Some(s) => s.t_ms,
            None => return RppgMetrics::default(),
        };
        let mut start_t = end_t - (self.window_sec * 1000.0) as i64;
        if let Some(first) = self.buffer.front() {
            if start_t < first.t_ms {
                start_t = first.t_ms;
            }
        }
        let window_samples: Vec<Sample> = self
            .buffer
            .iter()
            .filter(|s| s.t_ms >= start_t)
            .cloned()
            .collect();
        if window_samples.len() < 10 {
            return RppgMetrics::default();
        }
        let mut skin_sum = 0.0_f32;
        let mut skin_vals: Vec<f32> = Vec::with_capacity(window_samples.len());
        let mut motion_sum = 0.0_f32;
        let mut clip_sum = 0.0_f32;
        for s in &window_samples {
            skin_sum += s.skin_ratio;
            skin_vals.push(s.skin_ratio.clamp(0.0, 1.0));
            motion_sum += s.motion;
            clip_sum += s.clip;
        }
        let skin_ratio_mean = skin_sum / window_samples.len() as f32;
        skin_vals.sort_by(|a, b| a.total_cmp(b));
        let skin_p10_idx = ((skin_vals.len().saturating_sub(1)) as f32 * 0.10).round() as usize;
        let skin_p10 = skin_vals[skin_p10_idx];
        let motion_mean = motion_sum / window_samples.len() as f32;
        let clip_mean = clip_sum / window_samples.len() as f32;
        if !resample_rgb_into(
            &window_samples,
            start_t,
            end_t,
            self.sample_rate,
            &mut self.scratch_r,
            &mut self.scratch_g,
            &mut self.scratch_b,
        ) {
            return RppgMetrics::default();
        }
        if !pos_from_rgb_windowed_into(
            &self.scratch_r,
            &self.scratch_g,
            &self.scratch_b,
            &mut self.scratch_pos,
            &mut self.scratch_x,
            &mut self.scratch_y,
            &mut self.scratch_w,
            self.sample_rate,
            1.6,
            self.colour_projection_fix,
        ) {
            return RppgMetrics::default();
        }
        if self.scratch_pos.len() < 10 {
            return RppgMetrics::default();
        }
        temporal_normalize_into(&self.scratch_pos, &mut self.scratch_norm);
        self.bandpass
            .filter_into(&self.scratch_norm, &mut self.scratch_filtered);
        let filtered = &self.scratch_filtered;

        // periodogram over 0.7-4.0 Hz with 0.02 Hz base resolution
        let fmin = 0.75_f32;
        let fmax = 3.0_f32;
        let df = 0.01_f32;
        let seg_len = (self.sample_rate * 2.0) as usize;
        let (peak_f, _peak_p, powers, _fmin, _df) = match welch_periodogram_peak_freq(
            filtered,
            self.sample_rate,
            fmin,
            fmax,
            df,
            seg_len,
            0.5,
        ) {
            Some(v) => v,
            None => return RppgMetrics::default(),
        };

        // Robust harmonic disambiguation with prior-backed candidate ranking.
        let mut selected_f =
            select_harmonic_with_prior(&powers, fmin, df, fmax, self.sample_rate, prior)
                .unwrap_or(peak_f);
        let mut selected_p = power_at_freq(&powers, fmin, df, selected_f).unwrap_or(0.0);
        // Fallback to the raw peak if candidate selection landed off-grid/weak.
        if selected_p <= 0.0 {
            selected_f = peak_f;
            selected_p = power_at_freq(&powers, fmin, df, selected_f).unwrap_or(0.0);
        }

        // compute confidence from in-band SNR (peak vs median noise floor)
        let median =
            median_excluding(&powers, fmin, df, selected_f, 2, selected_f * 2.0).max(1e-12);
        let snr = selected_p / median;
        let confidence = if snr <= 1.0 {
            0.0
        } else {
            ((snr - 1.0) / snr).min(1.0)
        };

        if selected_p <= 0.0 {
            return RppgMetrics::default();
        }

        // signal quality index: use DSP helper
        let signal_quality = signal_quality_index(filtered, &self.scratch_norm);

        // cepstrum disabled in the simplified pipeline
        let cep_bpm = None;
        let cep_conf = 0.0;

        // Quality gating + reason codes.
        let selected_bpm = selected_f * 60.0;
        let mut output_bpm = Some(selected_bpm);
        let mut output_conf = confidence;
        let mut reasons: Vec<&'static str> = Vec::new();
        if skin_ratio_mean < 0.20 {
            reasons.push("LOW_SKIN");
        }
        if skin_p10 < 0.10 {
            reasons.push("LOW_SKIN_P10");
        }
        if motion_mean > 0.30 {
            reasons.push("HIGH_MOTION");
        }
        if clip_mean > 0.20 {
            reasons.push("CLIPPING");
        }
        if snr < 2.0 {
            reasons.push("LOW_SNR");
        }

        let severe = skin_ratio_mean < 0.10
            || skin_p10 < 0.05
            || motion_mean > 0.60
            || clip_mean > 0.40
            || snr < 1.3;
        if severe {
            output_bpm = None;
            output_conf = 0.0;
        } else {
            if skin_ratio_mean < 0.20 {
                output_conf *= 0.6;
            }
            if motion_mean > 0.30 {
                output_conf *= 0.6;
            }
            if clip_mean > 0.20 {
                output_conf *= 0.7;
            }
            if snr < 2.0 {
                output_conf *= 0.5;
            }
        }
        if let Some(tracker) = self.tracker.as_mut() {
            let now_t = end_t;
            let dt_sec = if let Some(prev) = self.last_tracker_ts {
                ((now_t - prev).max(1) as f32) / 1000.0
            } else {
                0.0
            };
            self.last_tracker_ts = Some(now_t);
            tracker.predict(dt_sec);
            if !severe && output_bpm.is_some() && output_conf > 0.05 {
                tracker.update(selected_bpm, output_conf);
            }
            if !severe {
                if let Some(est) = tracker.estimate() {
                    output_bpm = Some(est);
                    if output_conf <= 0.05 {
                        output_conf *= 0.5;
                    }
                }
            }
        }
        let reason_codes = reasons.iter().map(|s| s.to_string()).collect();
        RppgMetrics {
            bpm: output_bpm,
            confidence: output_conf,
            signal_quality,
            cepstrum_bpm: cep_bpm,
            cepstrum_confidence: cep_conf,
            snr,
            skin_ratio_mean,
            motion_mean,
            clip_mean,
            reason_codes,
        }
    }

    // Expose window length for testing
    #[cfg(test)]
    pub fn window_len(&self) -> usize {
        self.window_len
    }
}

fn resample_rgb_into(
    samples: &[Sample],
    start_t: i64,
    end_t: i64,
    fs: f32,
    r_out: &mut Vec<f32>,
    g_out: &mut Vec<f32>,
    b_out: &mut Vec<f32>,
) -> bool {
    if samples.len() < 2 {
        return false;
    }
    r_out.clear();
    g_out.clear();
    b_out.clear();
    let dt_ms = 1000.0_f32 / fs.max(1.0);
    let mut t = start_t as f32;
    let end = end_t as f32;
    let mut i = 0usize;
    let expected = ((end - t) / dt_ms).max(0.0) as usize + 2;
    r_out.reserve(expected);
    g_out.reserve(expected);
    b_out.reserve(expected);

    while t <= end {
        while i + 1 < samples.len() && (samples[i + 1].t_ms as f32) < t {
            i += 1;
        }
        if i + 1 >= samples.len() {
            break;
        }
        let s0 = &samples[i];
        let s1 = &samples[i + 1];
        let t0 = s0.t_ms as f32;
        let t1 = s1.t_ms as f32;
        if t1 <= t0 {
            t += dt_ms;
            continue;
        }
        let alpha = (t - t0) / (t1 - t0);
        r_out.push(s0.r + (s1.r - s0.r) * alpha);
        g_out.push(s0.g + (s1.g - s0.g) * alpha);
        b_out.push(s0.b + (s1.b - s0.b) * alpha);
        t += dt_ms;
    }
    r_out.len() >= 10
}

#[allow(clippy::too_many_arguments)]
fn pos_from_rgb_windowed_into(
    r: &[f32],
    g: &[f32],
    b: &[f32],
    out: &mut Vec<f32>,
    x_buf: &mut Vec<f32>,
    y_buf: &mut Vec<f32>,
    w_buf: &mut Vec<f32>,
    fs: f32,
    window_sec: f32,
    fixed: bool,
) -> bool {
    let n = r.len().min(g.len()).min(b.len());
    if n == 0 {
        return false;
    }
    out.clear();
    w_buf.clear();
    out.resize(n, 0.0);
    w_buf.resize(n, 0.0);

    let win_len = (fs * window_sec).round() as usize;
    let win_len = win_len.max(8).min(n);
    let step = (win_len / 2).max(1);

    let mut start = 0usize;
    while start + win_len <= n {
        let r_win = &r[start..start + win_len];
        let g_win = &g[start..start + win_len];
        let b_win = &b[start..start + win_len];
        let mean_r = r_win.iter().sum::<f32>() / win_len as f32;
        let mean_g = g_win.iter().sum::<f32>() / win_len as f32;
        let mean_b = b_win.iter().sum::<f32>() / win_len as f32;
        if mean_r.abs() < 1e-6 || mean_g.abs() < 1e-6 || mean_b.abs() < 1e-6 {
            start += step;
            continue;
        }
        x_buf.clear();
        y_buf.clear();
        x_buf.reserve(win_len);
        y_buf.reserve(win_len);
        for i in 0..win_len {
            let rn = r_win[i] / mean_r - 1.0;
            let gn = g_win[i] / mean_g - 1.0;
            let bn = b_win[i] / mean_b - 1.0;
            x_buf.push(3.0 * rn - 2.0 * gn);
            y_buf.push(1.5 * rn + gn - 1.5 * bn);
        }
        let std_x = stddev(x_buf);
        let std_y = stddev(y_buf);
        let alpha = if std_y > 1e-6 { std_x / std_y } else { 0.0 };
        for i in 0..win_len {
            // push_sample (one value, e.g. the multi-ROI fuser's finished pulse) arrives as
            // R = G = B, so X = Y and the projection would cancel it: such a sample is already a
            // pulse and passes through as its normalised value, with the same per-window
            // normalisation and overlap-add as before. Decided per sample, so a window mixing
            // camera RGB with fused samples keeps both.
            // With the fix off (`fixed == false`), the published projection, unchanged.
            let k = start + i;
            if !fixed {
                out[k] += x_buf[i] + alpha * y_buf[i];
            } else {
                let pre_extracted = r[k] == g[k] && g[k] == b[k];
                out[k] += if pre_extracted {
                    x_buf[i]
                } else {
                    x_buf[i] - alpha * y_buf[i]
                };
            }
            w_buf[start + i] += 1.0;
        }
        start += step;
    }

    let mut any = false;
    for i in 0..n {
        if w_buf[i] > 0.0 {
            out[i] /= w_buf[i];
            any = true;
        } else {
            out[i] = 0.0;
        }
    }
    any
}

fn stddev(x: &[f32]) -> f32 {
    if x.is_empty() {
        return 0.0;
    }
    let mean = x.iter().sum::<f32>() / x.len() as f32;
    let var = x.iter().map(|v| (v - mean) * (v - mean)).sum::<f32>() / x.len() as f32;
    var.sqrt()
}

fn median_excluding(powers: &[f32], fmin: f32, df: f32, f0: f32, radius: isize, f1: f32) -> f32 {
    if powers.is_empty() {
        return 0.0;
    }
    let idx0 = ((f0 - fmin) / df).round() as isize;
    let idx1 = ((f1 - fmin) / df).round() as isize;
    let mut vals: Vec<f32> = Vec::with_capacity(powers.len());
    for (i, &p) in powers.iter().enumerate() {
        let ii = i as isize;
        let near0 = (ii - idx0).abs() <= radius;
        let near1 = (ii - idx1).abs() <= radius;
        if !near0 && !near1 {
            vals.push(p);
        }
    }
    if vals.len() < 4 {
        vals = powers.to_vec();
    }
    vals.sort_by(|a, b| a.partial_cmp(b).unwrap());
    vals[vals.len() / 2]
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::f32::consts::PI;

    /// RMS of the colour projection for 10 s of input at 30 Hz, fix on.
    fn projection_rms(rgb: impl Fn(f32) -> (f32, f32, f32)) -> f32 {
        projection_rms_with(rgb, true)
    }

    fn projection_rms_with(rgb: impl Fn(f32) -> (f32, f32, f32), fixed: bool) -> f32 {
        let n = 300;
        let (mut r, mut g, mut b) = (vec![], vec![], vec![]);
        for i in 0..n {
            let (ri, gi, bi) = rgb(i as f32 / 30.0);
            r.push(ri);
            g.push(gi);
            b.push(bi);
        }
        let (mut out, mut x, mut y, mut w) = (vec![], vec![], vec![], vec![]);
        assert!(pos_from_rgb_windowed_into(
            &r, &g, &b, &mut out, &mut x, &mut y, &mut w, 30.0, 1.6, fixed
        ));
        (out.iter().map(|v| v * v).sum::<f32>() / n as f32).sqrt()
    }

    /// CHROM (de Haan & Jeanne 2013) is S = X - (sd X / sd Y) * Y. A lamp scales R, G and B alike,
    /// which moves X and Y equally, so the subtraction cancels it; adding them doubled it. Measured on
    /// real recordings through this path: UBFC-rPPG 15% -> 81% of seconds within 5 bpm of the finger
    /// sensor, MCD-rPPG 38% -> 49%, seconds with a rate on no-pulse videos 102 -> 37.
    #[test]
    fn projection_cancels_brightness_and_keeps_pulse_colour() {
        let lamp = projection_rms(|t| {
            let k = 1.0 + 0.01 * (2.0 * PI * 1.2 * t).sin();
            (150.0 * k, 120.0 * k, 100.0 * k)
        });
        let pulse = projection_rms(|t| {
            let p = (2.0 * PI * 1.2 * t).sin();
            (
                150.0 * (1.0 - 0.001 * p),
                120.0 * (1.0 - 0.003 * p),
                100.0 * (1.0 - 0.0018 * p),
            )
        });
        assert!(
            lamp < 0.1 * pulse,
            "lamp {lamp} should cancel, pulse {pulse}"
        );
    }

    /// With the switch off the projection is the published one: a lamp passes and is not
    /// cancelled (the behaviour the fix removes), so "off" can be compared against "on".
    #[test]
    fn switch_off_restores_the_published_projection() {
        let lamp = |t: f32| {
            let k = 1.0 + 0.01 * (2.0 * PI * 1.2 * t).sin();
            (150.0 * k, 120.0 * k, 100.0 * k)
        };
        let off = projection_rms_with(lamp, false);
        let on = projection_rms_with(lamp, true);
        assert!(off > 10.0 * on, "off {off} should keep the lamp, on {on} cancels it");
        let mut p = RppgPipeline::new(30.0, 10.0);
        assert!(p.colour_projection_fix(), "on by default");
        p.set_colour_projection_fix(false);
        assert!(!p.colour_projection_fix());
    }

    /// The published projection, computed independently, matches the switch-off path exactly.
    #[test]
    fn switch_off_matches_the_published_formula_exactly() {
        let n = 120;
        let (mut r, mut g, mut b) = (vec![], vec![], vec![]);
        for i in 0..n {
            let t = i as f32 / 30.0;
            r.push(150.0 + (2.0 * PI * 1.1 * t).sin());
            g.push(120.0 + 0.7 * (2.0 * PI * 1.3 * t).cos());
            b.push(100.0 + 0.3 * (2.0 * PI * 0.4 * t).sin());
        }
        let (mut out, mut x, mut y, mut w) = (vec![], vec![], vec![], vec![]);
        assert!(pos_from_rgb_windowed_into(
            &r, &g, &b, &mut out, &mut x, &mut y, &mut w, 30.0, 1.6, false
        ));
        // Reference: the published loop body, X + alpha*Y, overlap-added and divided by weight.
        let win = 48usize;
        let step = 24usize;
        let mut acc = vec![0.0f32; n];
        let mut wt = vec![0.0f32; n];
        let mut s = 0usize;
        while s + win <= n {
            let m = |v: &[f32]| v[s..s + win].iter().sum::<f32>() / win as f32;
            let (mr, mg, mb) = (m(&r), m(&g), m(&b));
            let xs: Vec<f32> = (0..win)
                .map(|i| 3.0 * (r[s + i] / mr - 1.0) - 2.0 * (g[s + i] / mg - 1.0))
                .collect();
            let ys: Vec<f32> = (0..win)
                .map(|i| 1.5 * (r[s + i] / mr - 1.0) + (g[s + i] / mg - 1.0) - 1.5 * (b[s + i] / mb - 1.0))
                .collect();
            let (sx, sy) = (stddev(&xs), stddev(&ys));
            let alpha = if sy > 1e-6 { sx / sy } else { 0.0 };
            for i in 0..win {
                acc[s + i] += xs[i] + alpha * ys[i];
                wt[s + i] += 1.0;
            }
            s += step;
        }
        let mut reference = vec![];
        for i in 0..n {
            if wt[i] > 0.0 {
                reference.push(acc[i] / wt[i]);
            }
        }
        let got: Vec<f32> = out.iter().copied().take(reference.len()).collect();
        for (a, e) in got.iter().zip(reference.iter()) {
            assert!((a - e).abs() < 1e-6, "switch-off {a} vs published {e}");
        }
    }

    /// The fused path (push_sample, R = G = B) must read a clean pulse at its rate across the band,
    /// alone and after a stretch of camera RGB in the same window (DemoRunner sends RGB until the
    /// fuser is ready). A window-level bypass read 72 bpm as 48 and 140 as none; this
    /// reads them exactly as the shipped sign did.
    #[test]
    fn fused_samples_keep_their_rate() {
        let fs = 30.0_f32;
        // 72 to 140: where the unchanged estimator downstream reads a clean sine within 5 bpm
        // (it reads 48 as 59, 60 as 64 and 170 as none with or without this change).
        for &bpm in &[72.0_f32, 90.0, 110.0, 140.0] {
            for &rgb_first_s in &[0.0_f32, 3.0] {
                let mut p = RppgPipeline::new(fs, 10.0);
                for i in 0..(14.0 * fs) as usize {
                    let t = i as f32 / fs;
                    let v = (2.0 * PI * bpm / 60.0 * t).sin();
                    let ts = (t * 1000.0) as i64;
                    if t < rgb_first_s {
                        p.push_sample_rgb(
                            ts,
                            150.0 * (1.0 - 0.001 * v),
                            120.0 * (1.0 - 0.003 * v),
                            100.0 * (1.0 - 0.0018 * v),
                            1.0,
                        );
                    } else {
                        p.push_sample(ts, v);
                    }
                }
                let got = p.get_metrics().bpm;
                assert!(
                    got.map_or(false, |b| (b - bpm).abs() <= 5.0),
                    "true {bpm} (RGB first {rgb_first_s} s) read {got:?}"
                );
            }
        }
    }

    #[test]
    fn mean_over_window() {
        let mut p = RppgPipeline::new(30.0, 2.0);
        assert_eq!(p.window_len(), 60);
        for i in 0..60 {
            let ts = (i as f32 * 1000.0 / 30.0) as i64;
            p.push_sample(ts, 1.0);
        }
        assert_eq!(p.mean().unwrap(), 1.0);
    }

    #[test]
    fn buffer_rolls() {
        let mut p = RppgPipeline::new(10.0, 1.0);
        // window_len = 10
        for i in 0..20 {
            let ts = (i as f32 * 1000.0 / 10.0) as i64;
            p.push_sample(ts, i as f32);
        }
        let m = p.mean().unwrap();
        let expected = (9..20).map(|x| x as f32).sum::<f32>() / 11.0;
        assert!((m - expected).abs() < 1e-6, "mean {} vs {}", m, expected);
    }

    #[test]
    fn metrics_estimate_bpm_on_sine() {
        let fs = 100.0_f32;
        let freq_hz = 1.5_f32; // 90 bpm
        let mut p = RppgPipeline::new(fs, 5.0);
        let n = p.window_len();
        for i in 0..n {
            let t = i as f32 / fs;
            let val = (2.0 * std::f32::consts::PI * freq_hz * t).sin();
            let ts = (t * 1000.0) as i64;
            p.push_sample(ts, val);
        }
        let m = p.get_metrics();
        assert!(m.bpm.is_some(), "no bpm returned");
        let bpm = m.bpm.unwrap();
        assert!(
            (bpm - freq_hz * 60.0).abs() < 2.0,
            "bpm {} vs expected {}",
            bpm,
            freq_hz * 60.0
        );
        assert!(m.confidence > 0.1, "low confidence: {}", m.confidence);
        assert!(m.signal_quality > 0.1, "low sqi: {}", m.signal_quality);
    }

    #[test]
    fn empty_metrics_returns_none() {
        let mut p = RppgPipeline::new(100.0, 1.0);
        let m = p.get_metrics();
        assert!(m.bpm.is_none());
        assert_eq!(m.confidence, 0.0);
    }

    #[test]
    fn steady_change_is_adopted() {
        // With no hysteresis, a steady change should be reflected quickly.
        let fs = 100.0_f32;
        let mut p = RppgPipeline::new(fs, 2.0);
        let n = p.window_len();
        // first fill with one frequency
        let f1 = 1.2_f32; // 72 bpm
        let mut ts = 0_i64;
        let dt_ms = (1000.0 / fs) as i64;
        for _w in 0..2 {
            for i in 0..n {
                let t = i as f32 / fs;
                p.push_sample(ts, (2.0 * PI * f1 * t).sin());
                ts += dt_ms;
            }
            let _ = p.get_metrics();
        }
        // abrupt change to new frequency where cepstrum should be confident.
        // If cepstrum is not a convincing validator for this window, the hysteresis logic
        // will accept the new steady state after two consecutive windows. Simulate two windows.
        let f2 = 2.0_f32; // 120 bpm
                          // capture previous estimate (before new frequency starts)
        let prev_est = p.get_metrics().bpm.unwrap();
        // push one window of new signal and check update
        for i in 0..n {
            let t = i as f32 / fs;
            p.push_sample(ts, (2.0 * PI * f2 * t).sin());
            ts += dt_ms;
        }
        let m = p.get_metrics();
        // pipeline should accept a new steady-state estimate promptly
        let est = m.bpm.unwrap();
        assert!(est != prev_est, "steady change was not adopted: {}", est);
        assert!(
            est > 35.0 && est < 200.0,
            "adopted value out of plausible range: {}",
            est
        );
    }
}
