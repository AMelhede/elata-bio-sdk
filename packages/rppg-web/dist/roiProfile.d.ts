import type { FaceLandmarkPoint, ROI } from "./frameSource.js";
export type LandmarkLike = Pick<FaceLandmarkPoint, "x" | "y">;
export type FaceRoiName = "forehead" | "leftCheek" | "rightCheek" | "centralFace" | "broadFace";
export type FaceRoiFraction = readonly [
    x0: number,
    y0: number,
    x1: number,
    y1: number
];
export type FaceRoiFractions = Readonly<Partial<Record<FaceRoiName, FaceRoiFraction>>>;
export interface RoiGeometryProfile {
    readonly id: string;
    readonly roiNames: readonly FaceRoiName[];
    compute(landmarks: readonly LandmarkLike[], width: number, height: number): Partial<Record<FaceRoiName, ROI>>;
}
/**
 * Current Elata production geometry. Changing these fractions requires a new
 * profile ID so recorded diagnostics and learned-model inputs remain traceable.
 */
export declare const ELATA_FACE_YCBCR_V1_FRACTIONS: FaceRoiFractions;
/**
 * Frozen five-ROI geometry used to train the waveform proxy model.
 * It intentionally differs from the current Elata forehead geometry.
 */
export declare const MCD_PROXY_INPUT_V1_FRACTIONS: FaceRoiFractions;
export declare const FUSION_ROI_NAMES: readonly FaceRoiName[];
export declare const ALL_FACE_ROI_NAMES: readonly FaceRoiName[];
export declare function computeFractionalFaceRoiRects(landmarks: readonly LandmarkLike[], width: number, height: number, fractions: FaceRoiFractions): Partial<Record<FaceRoiName, ROI>>;
export declare const ELATA_FACE_YCBCR_V1_PROFILE: RoiGeometryProfile;
export declare const MCD_PROXY_INPUT_V1_PROFILE: RoiGeometryProfile;
/**
 * TradeLock's primary live forehead rectangle. This is a replay/ablation
 * profile, not the SDK default and not the five-ROI waveform-model profile.
 */
export declare const TRADELOCK_LIVE_FOREHEAD_V1_PROFILE: RoiGeometryProfile;
//# sourceMappingURL=roiProfile.d.ts.map