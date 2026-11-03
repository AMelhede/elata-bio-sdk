//! The engine's rate must not depend on where the frame clock starts. Android hands the camera's
//! capture time (device uptime) as the frame time, so a phone up for days sends times near 2^30 ms.
use elata_rppg::pipeline::RppgPipeline;

/// Median engine rate over seconds 20 to 40 of a clean 90 bpm pulse at 30 frames a second,
/// with every frame time shifted by `t0_ms`.
fn median_bpm(t0_ms: i64) -> Option<f32> {
    let mut p = RppgPipeline::new(30.0, 5.0);
    let mut out = Vec::new();
    for frame in 0..(30 * 40) {
        let s = frame as f32 / 30.0;
        let ph = (2.0 * std::f32::consts::PI * 1.5 * s).sin();
        let t = t0_ms + (s as f64 * 1000.0).round() as i64;
        p.push_sample(t, 0.5 + 0.004 * ph);
        if s >= 20.0 && frame % 30 == 0 {
            if let Some(b) = p.get_metrics().bpm {
                out.push(b);
            }
        }
    }
    if out.len() < 15 {
        return None;
    }
    out.sort_by(|a, b| a.total_cmp(b));
    Some(out[out.len() / 2])
}

fn check(t0_ms: i64) {
    let base = median_bpm(10_000).expect("a rate at a small clock");
    assert!((base - 90.0).abs() <= 1.0, "small clock: {base} against 90");
    let got = median_bpm(t0_ms);
    eprintln!("t0 {t0_ms}: {got:?} against {base}");
    let got = got.expect("a rate in at least 15 of 20 seconds");
    assert!((got - base).abs() <= 1.0, "t0 {t0_ms}: {got} against {base}");
}

#[test]
fn rate_at_one_day_of_uptime() { check(100_000_000); }
#[test]
fn rate_at_three_and_a_half_days() { check(300_000_000); }
#[test]
fn rate_at_nine_days() { check(800_000_000); }
#[test]
fn rate_past_2_pow_30_ms() { check(1_139_124_495); }
#[test]
fn rate_past_a_year() { check(40_000_000_000); }
