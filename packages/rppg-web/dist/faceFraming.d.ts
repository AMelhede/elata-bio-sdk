/**
 * Face-framing guidance: turn a detected face's position/size in the frame into
 * a one-line "move closer / center / sit up" hint. A mis-framed face is *why*
 * SNR drops, so positioning is signal-domain logic that belongs alongside the
 * gating controller and is shared by every consumer (no per-app reimplementation).
 *
 * Pure by design — plain `{ x, y }` points, no MediaPipe import — so it can run
 * anywhere: the SDK derives the box from the FaceLandmarker it already runs for
 * its ROI crop (see {@link MediaPipeFaceFrameSource}), and the {@link RppgGatingController}
 * folds the result into its progressive guidance.
 */
export type FramingCode = "ok" | "no_face" | "move_closer" | "move_back" | "center_face" | "face_too_high" | "face_too_low";
export interface FramingGuidance {
    code: FramingCode;
    /** User-facing, head-relative (unambiguous regardless of camera mount). */
    message: string;
}
/** Normalized face box: x/y top-left, width/height as fractions of the frame. */
export interface FaceBox {
    x: number;
    y: number;
    width: number;
    height: number;
}
export interface FramingThresholds {
    /** Face width fraction below which the face is too far (move closer). */
    minWidth: number;
    /** Face width fraction above which the face is too close (move back). */
    maxWidth: number;
    /** Allowed |center − 0.5| on each axis before we nudge. */
    centerTol: number;
}
export declare const DEFAULT_FRAMING_THRESHOLDS: FramingThresholds;
export declare const FRAMING_MESSAGES: Record<FramingCode, string>;
/**
 * Map a face box to a single framing hint. Distance is corrected before
 * position (no point centering a face that's about to be re-sized), and
 * horizontal before vertical. Returns `ok` when the face is well-framed.
 */
export declare function faceFramingFromBox(box: FaceBox | null, t?: FramingThresholds): FramingGuidance;
/**
 * The FaceLandmarker mesh spans brow→chin, cheek→cheek — it omits the skull
 * above the brow and the head's full width (ears/hair). Users frame their whole
 * *head*, so steering off the bare mesh box reads low and small. We pad it
 * outward to approximate the head: a generous slab above (skull), a little to
 * each side, a touch below the jaw. Apply once at the source so the on-screen
 * box and the framing math operate on the same head box and can't drift apart.
 * Values may land outside 0..1 (head cropped by the frame) — the framing center
 * stays meaningful and any indicator clamps for drawing.
 */
export declare function padFaceBoxToHead(box: FaceBox): FaceBox;
/**
 * Bounding box of normalized face landmarks (e.g. MediaPipe's 478 points,
 * already in 0..1 frame coordinates). Returns null for an empty set.
 */
export declare function faceBoxFromLandmarks(landmarks: {
    x: number;
    y: number;
}[]): FaceBox | null;
//# sourceMappingURL=faceFraming.d.ts.map