import { faceBoxFromLandmarks } from "./faceFraming.js";
export const DEFAULT_CAPTURE_CONFIDENCE_CONFIG = {
    windowFrames: 45,
    minSamples: 8,
    okThreshold: 0.6,
    // Defaults assume the coarse `motion`-scalar fallback (0..1, gate ≈0.15,
    // excessive ≈0.35 elsewhere in the SDK) and displacements as a fraction of
    // the face-box diagonal. Heuristic — override per camera/cadence.
    tiBadAt: 0.3,
    faceMotionBadAt: 0.04,
    faceSizeMotionBadAt: 0.04,
    clipBadAt: 0.2,
    lumaLow: 0.2,
    lumaHigh: 0.9,
    skinMin: 0.25,
};
// Pearson correlations between each motion feature and HR error (paper Table 4).
// We use them as per-feature *reliabilities*, normalized so the strongest cue
// (TI) is 1.0 — i.e. how much a saturated value of that cue should count against
// motion confidence. The aggregation below is a noisy-OR, so any single strong
// artifact lowers confidence (a weighted mean would dilute it), while a weak cue
// (FSM) on its own only dents it.
const PCC = { ti: 0.594, fmy: 0.546, fmx: 0.512, fsm: 0.374 };
const PCC_MAX = Math.max(PCC.ti, PCC.fmy, PCC.fmx, PCC.fsm);
export const CAPTURE_MOTION_RELIABILITY = {
    ti: PCC.ti / PCC_MAX,
    fmx: PCC.fmx / PCC_MAX,
    fmy: PCC.fmy / PCC_MAX,
    fsm: PCC.fsm / PCC_MAX,
};
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const num = (v) => v != null && Number.isFinite(v) ? v : null;
/**
 * Pure scorer over already-extracted features — the math, isolated from frame
 * accumulation so it can be unit-tested directly.
 */
export function scoreCaptureFeatures(f, cfg = DEFAULT_CAPTURE_CONFIDENCE_CONFIG) {
    const tiBad = clamp01(f.ti / cfg.tiBadAt);
    const fmxBad = clamp01(f.fmx / cfg.faceMotionBadAt);
    const fmyBad = clamp01(f.fmy / cfg.faceMotionBadAt);
    const fsmBad = clamp01(f.fsm / cfg.faceSizeMotionBadAt);
    // Noisy-OR over reliability-scaled per-feature badness: motion confidence is
    // the probability that *no* cue indicates a corrupting artifact.
    const motion = (1 - CAPTURE_MOTION_RELIABILITY.ti * tiBad) *
        (1 - CAPTURE_MOTION_RELIABILITY.fmx * fmxBad) *
        (1 - CAPTURE_MOTION_RELIABILITY.fmy * fmyBad) *
        (1 - CAPTURE_MOTION_RELIABILITY.fsm * fsmBad);
    const clip = num(f.clipRatio);
    const skin = num(f.skinRatio);
    const luma = num(f.meanLuma);
    const clipBad = clip == null ? 0 : clamp01(clip / cfg.clipBadAt);
    const skinBad = skin == null ? 0 : clamp01((cfg.skinMin - skin) / cfg.skinMin);
    let lumaBad = 0;
    let lumaDark = false;
    if (luma != null) {
        if (luma < cfg.lumaLow) {
            lumaBad = clamp01((cfg.lumaLow - luma) / cfg.lumaLow);
            lumaDark = true;
        }
        else if (luma > cfg.lumaHigh) {
            lumaBad = clamp01((luma - cfg.lumaHigh) / (1 - cfg.lumaHigh));
        }
    }
    const lightingBad = Math.max(clipBad, skinBad, lumaBad);
    const lighting = 1 - lightingBad;
    const score = Math.min(motion, lighting);
    const reasons = [];
    if (tiBad > 0.5)
        reasons.push("high_ti");
    if (fmxBad > 0.5)
        reasons.push("face_translation_x");
    if (fmyBad > 0.5)
        reasons.push("face_translation_y");
    if (fsmBad > 0.5)
        reasons.push("face_size_motion");
    if (clipBad > 0.5)
        reasons.push("clipping");
    if (lumaBad > 0.5)
        reasons.push(lumaDark ? "low_light" : "bright_light");
    if (skinBad > 0.5)
        reasons.push("low_skin");
    const limiting = score >= cfg.okThreshold
        ? null
        : motion <= lighting
            ? "motion"
            : "lighting";
    return {
        score,
        motion,
        lighting,
        features: { ti: f.ti, fmx: f.fmx, fmy: f.fmy, fsm: f.fsm },
        limiting,
        reasons,
    };
}
/** Mean per-landmark |Δ| along each axis between two normalized landmark sets. */
function landmarkDisplacement(prev, cur) {
    const n = Math.min(prev.length, cur.length);
    if (n === 0)
        return null;
    let sx = 0;
    let sy = 0;
    for (let i = 0; i < n; i++) {
        sx += Math.abs(cur[i].x - prev[i].x);
        sy += Math.abs(cur[i].y - prev[i].y);
    }
    return { dx: sx / n, dy: sy / n };
}
const boxDiagonal = (b) => Math.sqrt(b.width * b.width + b.height * b.height) || 1;
const boxCenter = (b) => ({
    x: b.x + b.width / 2,
    y: b.y + b.height / 2,
});
/**
 * Stateful, frame-driven capture-confidence scorer. Push one
 * {@link CaptureFrameSample} per processed frame; `push` returns the current
 * {@link CaptureConfidenceResult} over the rolling window.
 */
export class CaptureConfidenceScorer {
    constructor(cfg = {}) {
        this.tiBuf = [];
        this.fmxBuf = [];
        this.fmyBuf = [];
        this.fsmBuf = [];
        this.prevLandmarks = null;
        this.prevBox = null;
        this.prevRoi = null;
        this.clipRatio = null;
        this.skinRatio = null;
        this.meanLuma = null;
        this.frames = 0;
        this.cfg = { ...DEFAULT_CAPTURE_CONFIDENCE_CONFIG, ...cfg };
    }
    reset() {
        this.tiBuf.length = 0;
        this.fmxBuf.length = 0;
        this.fmyBuf.length = 0;
        this.fsmBuf.length = 0;
        this.prevLandmarks = null;
        this.prevBox = null;
        this.prevRoi = null;
        this.clipRatio = null;
        this.skinRatio = null;
        this.meanLuma = null;
        this.frames = 0;
    }
    push(sample) {
        this.frames++;
        // Derive a usable face box: explicit, else from landmarks.
        const landmarks = sample.landmarks ?? null;
        const box = sample.faceBox ?? (landmarks ? faceBoxFromLandmarks(landmarks) : null);
        // --- TI (per frame): max over window of luminance-diff std (motion fallback)
        const ti = num(sample.luminanceDiffStd) ?? num(sample.motion) ?? 0;
        this.pushBuf(this.tiBuf, ti);
        // --- FMX/FMY (per pair): landmark displacement, else box-center delta,
        // normalized by face-box diagonal so it is scale-invariant.
        const diag = box
            ? boxDiagonal(box)
            : this.prevBox
                ? boxDiagonal(this.prevBox)
                : 1;
        let disp = null;
        if (landmarks && this.prevLandmarks) {
            disp = landmarkDisplacement(this.prevLandmarks, landmarks);
        }
        else if (box && this.prevBox) {
            const a = boxCenter(box);
            const b = boxCenter(this.prevBox);
            disp = { dx: Math.abs(a.x - b.x), dy: Math.abs(a.y - b.y) };
        }
        if (disp) {
            this.pushBuf(this.fmxBuf, disp.dx / diag);
            this.pushBuf(this.fmyBuf, disp.dy / diag);
        }
        // --- FSM (per pair): relative change in ROI pixel count (box-area fallback)
        const roi = num(sample.roiPixelCount) ?? (box ? box.width * box.height : null);
        if (roi != null && this.prevRoi != null) {
            const mean = (roi + this.prevRoi) / 2 || 1;
            this.pushBuf(this.fsmBuf, Math.abs(roi - this.prevRoi) / mean);
        }
        // --- Lighting cues: latest known value (changes slowly).
        if (num(sample.clipRatio) != null)
            this.clipRatio = sample.clipRatio;
        if (num(sample.skinRatio) != null)
            this.skinRatio = sample.skinRatio;
        if (num(sample.meanLuma) != null)
            this.meanLuma = sample.meanLuma;
        this.prevLandmarks = landmarks;
        this.prevBox = box;
        this.prevRoi = roi;
        const scored = scoreCaptureFeatures({
            ti: this.tiBuf.length ? Math.max(...this.tiBuf) : 0,
            fmx: mean(this.fmxBuf),
            fmy: mean(this.fmyBuf),
            fsm: mean(this.fsmBuf),
            clipRatio: this.clipRatio,
            skinRatio: this.skinRatio,
            meanLuma: this.meanLuma,
        }, this.cfg);
        return { ...scored, ready: this.frames >= this.cfg.minSamples };
    }
    pushBuf(buf, v) {
        buf.push(v);
        if (buf.length > this.cfg.windowFrames)
            buf.shift();
    }
}
function mean(xs) {
    if (!xs.length)
        return 0;
    let s = 0;
    for (const x of xs)
        s += x;
    return s / xs.length;
}
