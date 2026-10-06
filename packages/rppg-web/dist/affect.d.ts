export interface FaceBlendshapeCategory {
    categoryName: string;
    score: number;
}
export interface ValenceArousal {
    /** -1 (unpleasant) .. +1 (pleasant). */
    valence: number;
    /** 0 (calm) .. 1 (activated). */
    arousal: number;
}
/** Estimate valence + (face-only) arousal from MediaPipe blendshape categories. */
export declare function blendshapeValenceArousal(categories: FaceBlendshapeCategory[]): ValenceArousal | null;
/**
 * Physiological arousal (0..1) from heart-rate elevation + HRV suppression
 * relative to the personal resting baseline. Sympathetic activation raises HR
 * and drops RMSSD. HR is weighted higher (more reliable from a camera).
 */
export declare function physiologyArousal(bpm: number | null, rmssd: number | null, baseline: {
    bpm: number;
    rmssd: number;
} | null): number | null;
export interface AffectState {
    valence: number;
    arousal: number;
    arousalSource: "fused" | "physiology" | "face" | "none";
}
/**
 * Fuse face + physiology into one affect estimate: valence from the face,
 * arousal primarily from physiology (face arousal is down-weighted), each gated
 * by its own confidence (rPPG SNR for physiology, face presence for face).
 */
export declare function fuseAffect(faceValence: number | null, faceArousal: number | null, physioArousal: number | null, physioConfidence: number, faceConfidence: number): AffectState;
/**
 * Map an affect state to a 0..100 stress contribution: stress is the
 * activated-and-unpleasant quadrant. High arousal alone is partial stress;
 * negative valence amplifies it toward full.
 */
export declare function affectStress(affect: AffectState): number;
export type AffectLabel = "Neutral" | "Excited" | "Stressed" | "Alert" | "Engaged" | "Tense" | "Calm" | "Relaxed" | "Fatigued";
/**
 * Map the fused valence-arousal to a single emotional-state label via Russell's
 * circumplex. Prefer this for display: it reflects autonomic arousal the face
 * hides. `Calm` is low arousal at neutral valence; `Neutral` is the mid-arousal
 * resting center.
 */
export declare function classifyAffectLabel(valence: number, arousal: number): AffectLabel;
//# sourceMappingURL=affect.d.ts.map