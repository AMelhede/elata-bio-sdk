import type { Frame, ROI } from "./frameSource.js";
import type { FaceRoiName } from "./roiProfile.js";
export interface RppgRoiStatistics {
    /** RGB means normalized to 0..1. */
    r: number;
    g: number;
    b: number;
    /** Actual fraction of pixels accepted by the skin predicate. */
    skinFraction: number;
    /**
     * Compatibility quality value. The current SDK floors this when it falls
     * back to unmasked RGB; new model code should prefer `skinFraction`.
     */
    effectiveSkinFraction: number;
    clipRatio: number;
    meanLuma: number;
    lumaStd: number;
    pixelCount: number;
    skinPixelCount: number;
    usedSkinPixels: boolean;
}
export interface RoiPixelSampler {
    readonly id: string;
    sample(frame: Frame, roi: ROI): RppgRoiStatistics;
}
export interface RppgRoiSampleV1 {
    schema: "elata.rppg.roi-sample/v1";
    timestampMs: number;
    roi: FaceRoiName;
    rgb: {
        r: number;
        g: number;
        b: number;
    };
    quality: {
        skinFraction: number;
        effectiveSkinFraction: number;
        clipRatio: number;
        meanLuma: number;
        lumaStd: number;
        pixelCount: number;
        skinPixelCount: number;
        usedSkinPixels: boolean;
    };
    geometryProfileId: string;
    pixelSamplerId: string;
}
export declare function isYcbcrSkinPixel(r: number, g: number, b: number): boolean;
export declare function isTradeLockSkinPixel(r: number, g: number, b: number): boolean;
export declare function tradeLockSpatialWeight(x: number, y: number, width: number, height: number): number;
export declare const ELATA_YCBCR_V1_PIXEL_SAMPLER: RoiPixelSampler;
export declare const TRADELOCK_RGB_WEIGHTED_V1_PIXEL_SAMPLER: RoiPixelSampler;
export declare function sampleRppgRoi(frame: Frame, roi: FaceRoiName, rect: ROI, geometryProfileId: string, pixelSampler?: RoiPixelSampler): RppgRoiSampleV1;
//# sourceMappingURL=roiPixelSampler.d.ts.map