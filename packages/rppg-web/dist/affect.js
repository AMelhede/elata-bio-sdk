//! Dimensional affect (valence-arousal) from face blendshapes fused with rPPG
//! physiology.
//!
//! Faces read valence (pleasant<->unpleasant) well but under-report arousal;
//! autonomic arousal (HR elevation + HRV suppression) from the rPPG signal is a
//! more valid arousal cue. So valence comes from the face and arousal is taken
//! primarily from physiology, each gated by its own confidence. The fused
//! valence-arousal is mapped to a single emotional-state label via Russell's
//! circumplex — the recommended value to display, rather than a face-only
//! discrete expression classifier.
//!
//! `blendshapeValenceArousal` consumes MediaPipe-style blendshape categories
//! (ARKit names, e.g. `mouthSmileLeft`); `physiologyArousal` consumes the
//! processor's bpm + hrv_rmssd against a personal resting baseline.
function clamp01(v) {
    return Math.min(1, Math.max(0, v));
}
function clampSigned(v) {
    return Math.min(1, Math.max(-1, v));
}
function average(values) {
    return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}
/** Estimate valence + (face-only) arousal from MediaPipe blendshape categories. */
export function blendshapeValenceArousal(categories) {
    if (!categories.length)
        return null;
    const scores = new Map();
    for (const c of categories)
        scores.set(c.categoryName, c.score);
    const pick = (...names) => Math.max(...names.map((n) => scores.get(n) ?? 0));
    const avg = (...names) => average(names.map((n) => scores.get(n) ?? 0));
    const smile = avg("mouthSmileLeft", "mouthSmileRight");
    const cheekSquint = avg("cheekSquintLeft", "cheekSquintRight"); // Duchenne (genuine) marker
    const frown = avg("mouthFrownLeft", "mouthFrownRight");
    const browDown = avg("browDownLeft", "browDownRight");
    const mouthPress = pick("mouthPressLeft", "mouthPressRight");
    // Valence: positive cues raise, negative cues lower.
    const positive = smile + 0.5 * cheekSquint;
    const negative = frown + 0.7 * browDown + 0.4 * mouthPress;
    const valence = clampSigned(positive - negative);
    // Face arousal: overall expressive activation (any high-energy AU), regardless
    // of sign. Deliberately conservative — the face under-reports arousal.
    const eyeWide = avg("eyeWideLeft", "eyeWideRight");
    const browInnerUp = pick("browInnerUp");
    const jawOpen = pick("jawOpen");
    const mouthStretch = avg("mouthStretchLeft", "mouthStretchRight");
    const arousal = clamp01(0.5 * eyeWide + 0.4 * browInnerUp + 0.4 * jawOpen + 0.3 * browDown + 0.25 * smile + 0.2 * mouthStretch);
    return { valence, arousal };
}
/**
 * Physiological arousal (0..1) from heart-rate elevation + HRV suppression
 * relative to the personal resting baseline. Sympathetic activation raises HR
 * and drops RMSSD. HR is weighted higher (more reliable from a camera).
 */
export function physiologyArousal(bpm, rmssd, baseline) {
    if (bpm == null || !baseline || baseline.bpm <= 0)
        return null;
    const hrElevation = clamp01((bpm - baseline.bpm) / 35); // +35 bpm => full scale
    let hrvDrop = 0;
    if (rmssd != null && baseline.rmssd > 0) {
        hrvDrop = clamp01((baseline.rmssd - rmssd) / baseline.rmssd);
    }
    return clamp01(hrElevation * 0.65 + hrvDrop * 0.35);
}
/**
 * Fuse face + physiology into one affect estimate: valence from the face,
 * arousal primarily from physiology (face arousal is down-weighted), each gated
 * by its own confidence (rPPG SNR for physiology, face presence for face).
 */
export function fuseAffect(faceValence, faceArousal, physioArousal, physioConfidence, faceConfidence) {
    const valence = clampSigned(faceValence ?? 0);
    const wP = physioArousal != null ? clamp01(physioConfidence) : 0;
    const wF = faceArousal != null ? clamp01(faceConfidence) * 0.5 : 0; // face arousal less trusted
    let arousal = 0;
    let arousalSource = "none";
    if (wP + wF > 0) {
        arousal = clamp01(((physioArousal ?? 0) * wP + (faceArousal ?? 0) * wF) / (wP + wF));
        arousalSource = wP > 0 && wF > 0 ? "fused" : wP > 0 ? "physiology" : "face";
    }
    return { valence, arousal, arousalSource };
}
/**
 * Map an affect state to a 0..100 stress contribution: stress is the
 * activated-and-unpleasant quadrant. High arousal alone is partial stress;
 * negative valence amplifies it toward full.
 */
export function affectStress(affect) {
    const negativity = clamp01(-affect.valence);
    return clamp01(affect.arousal * (0.5 + 0.5 * negativity)) * 100;
}
/**
 * Map the fused valence-arousal to a single emotional-state label via Russell's
 * circumplex. Prefer this for display: it reflects autonomic arousal the face
 * hides. `Calm` is low arousal at neutral valence; `Neutral` is the mid-arousal
 * resting center.
 */
export function classifyAffectLabel(valence, arousal) {
    const v = clampSigned(valence);
    const a = clamp01(arousal);
    const pos = v > 0.15;
    const neg = v < -0.15;
    if (a >= 0.6) {
        // High arousal.
        if (pos)
            return "Excited";
        if (neg)
            return "Stressed";
        return "Alert";
    }
    if (a <= 0.3) {
        // Low arousal.
        if (pos)
            return "Relaxed";
        if (neg)
            return "Fatigued";
        return "Calm";
    }
    // Mid arousal (0.3-0.6): neutral valence is the resting center.
    if (pos)
        return "Engaged";
    if (neg)
        return "Tense";
    return "Neutral";
}
