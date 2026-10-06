import type { ROI } from "./frameSource.js";
import { type FaceRoiFraction, type FaceRoiName, type LandmarkLike, type RoiGeometryProfile } from "./roiProfile.js";
export { ELATA_FACE_YCBCR_V1_FRACTIONS as FACE_ROI_FRACTIONS, FUSION_ROI_NAMES, } from "./roiProfile.js";
export type { FaceRoiName, LandmarkLike } from "./roiProfile.js";
/**
 * Pixel rectangles for each named face ROI, derived from the 5th/95th-percentile
 * bounding box of the landmarks. This compatibility wrapper preserves the
 * original SDK API; new code may use a {@link RoiGeometryProfile} directly.
 */
export declare function computeFaceRoiRects(landmarks: LandmarkLike[], width: number, height: number, fractions?: Partial<Record<FaceRoiName, FaceRoiFraction>>): Partial<Record<FaceRoiName, ROI>>;
/**
 * Ordered forehead and cheek sub-ROIs sampled for the pulse signal.
 */
export declare function computeFusionSubRois(landmarks: LandmarkLike[], width: number, height: number, profile?: RoiGeometryProfile): ROI[];
export interface MeshConnection {
    start: number;
    end: number;
}
export interface DrawFaceOverlayOptions {
    /**
     * Mesh tessellation connections (for example,
     * `FaceLandmarker.FACE_LANDMARKS_TESSELATION`). When omitted, only the ROI
     * boxes are drawn.
     */
    tessellation?: ReadonlyArray<MeshConnection>;
    /** Which ROIs to box (default forehead plus both cheeks). */
    rois?: readonly FaceRoiName[];
    /** Live per-ROI fusion weights (0..1); drives box brightness and labels. */
    weights?: Partial<Record<FaceRoiName, number>>;
    /** Geometry profile used for the boxes (defaults to the SDK profile). */
    geometryProfile?: RoiGeometryProfile;
    /**
     * Set when the canvas is CSS-mirrored to match a flipped selfie video, so
     * labels are counter-flipped to render correctly (default true).
     */
    mirrored?: boolean;
}
/**
 * Draw the face mesh tessellation and rPPG ROI boxes onto a 2D canvas.
 */
export declare function drawFaceOverlay(ctx: CanvasRenderingContext2D, landmarks: LandmarkLike[], width: number, height: number, options?: DrawFaceOverlayOptions): void;
//# sourceMappingURL=faceRoiOverlay.d.ts.map