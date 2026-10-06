import type { FaceRoiName } from "./roiProfile.js";
export type ROI = {
    x: number;
    y: number;
    w: number;
    h: number;
};
export type FaceLandmarkPoint = {
    x: number;
    y: number;
    z?: number;
};
/** ARKit-style blendshape coefficient, as emitted by MediaPipe FaceLandmarker. */
export type FrameBlendshape = {
    categoryName: string;
    score: number;
};
export type Frame = {
    data: Uint8ClampedArray | number[];
    width: number;
    height: number;
    roi?: ROI;
    rois?: ROI[];
    namedRois?: Partial<Record<FaceRoiName, ROI>>;
    timestampMs?: number;
    /** Normalized face mesh landmarks (0..1), when a FaceLandmarker is active. */
    landmarks?: FaceLandmarkPoint[];
    /** Face blendshape coefficients (valence/arousal input), when available. */
    blendshapes?: FrameBlendshape[];
};
export interface FrameSource {
    onFrame: ((frame: Frame) => void) | null;
    start(): Promise<void>;
    stop(): Promise<void>;
}
export type FrameSourceErrorCode = "capture_failed" | "face_mesh_failed";
export type FrameSourceError = {
    code: FrameSourceErrorCode;
    stage: "capture" | "face_mesh";
    message: string;
    timestampMs: number;
    cause?: unknown;
};
export interface FrameSourceWithErrors extends FrameSource {
    onError: ((error: FrameSourceError) => void) | null;
    getLastError(): FrameSourceError | null;
}
export declare function averageGreenInROI(frame: Frame, x: number, y: number, w: number, h: number): number;
export declare function averageRgbInROI(frame: Frame, x: number, y: number, w: number, h: number): {
    r: number;
    g: number;
    b: number;
};
export declare function averageGreenInROIWithSkinMask(frame: Frame, x: number, y: number, w: number, h: number): number;
export declare function averageGreenInROIWithSkinMaskStats(frame: Frame, x: number, y: number, w: number, h: number): {
    intensity: number;
    skinRatio: number;
};
/**
 * Mean RGB (0..1) of the pixels in a box that do NOT look like skin (the same YCbCr skin test
 * as averageRgbInROIWithSkinMaskStats), or null when fewer than 10% of them qualify. For a
 * patch that must be wall: a face edge or an ear drifting into it carries the person's pulse.
 */
export declare function averageRgbInROINonSkin(frame: Frame, x: number, y: number, w: number, h: number): {
    r: number;
    g: number;
    b: number;
} | null;
export declare function averageRgbInROIWithSkinMaskStats(frame: Frame, x: number, y: number, w: number, h: number): {
    r: number;
    g: number;
    b: number;
    skinRatio: number;
    clipRatio: number;
};
//# sourceMappingURL=frameSource.d.ts.map