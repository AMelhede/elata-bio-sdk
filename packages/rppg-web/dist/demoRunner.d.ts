import { FrameSource, type FrameBlendshape } from "./frameSource.js";
import { type FaceBox } from "./faceFraming.js";
import { type ResolvedRppgFixSwitches, type RppgFixesOption } from "./fixSwitches.js";
import { type FusionProjection, type FusionRoiName } from "./multiRoiFusion.js";
import { type PulseCheck } from "./pulseCheck.js";
import { RppgProcessor } from "./rppgProcessor.js";
import { type RoiPixelSampler, type RppgRoiSampleV1 } from "./roiPixelSampler.js";
import { type RoiGeometryProfile } from "./roiProfile.js";
export type LastBlendshapes = {
    blendshapes: FrameBlendshape[];
    atMs: number;
};
export type LastFaceBox = {
    /** Normalized (0..1) head box — the mesh bounds padded out to the head. */
    box: FaceBox;
    atMs: number;
};
export type DemoRunnerOptions = {
    /**
     * Fix switches (see fixSwitches.ts). All on unless set to false. The runner applies
     * noFaceNoReading, realFrameRate and posFusion; the processor applies the other two.
     */
    fixes?: RppgFixesOption;
    /**
     * The real-pulse check (see pulseCheck.ts), fed the same three face regions the fuser
     * reads plus a patch of wall beside the face. The session creates it (`pulseCheck`);
     * null or left out: no check.
     */
    pulseChecker?: PulseCheck | null;
    roi?: {
        x: number;
        y: number;
        w: number;
        h: number;
    } | null;
    /** Face-mesh ROI geometry profile. */
    roiGeometryProfile?: RoiGeometryProfile;
    sampleRate?: number;
    roiSmoothingAlpha?: number;
    useSkinMask?: boolean;
    onStats?: (stats: {
        intensity: number;
        skinRatio: number;
        fps: number | null;
        r: number;
        g: number;
        b: number;
        clipRatio: number;
        motion: number;
    }) => void;
    onDiagnostics?: (diagnostics: DemoRunnerDiagnostics) => void;
    onError?: (error: DemoRunnerError) => void;
    skinRatioSmoothingAlpha?: number;
    /**
     * Multi-ROI rPPG fusion: run CHROM + bandpass per face region (forehead +
     * both cheeks) and blend by in-band spectral SNR, so glare/hair/occlusion on
     * one region no longer poisons the estimate. Requires sub-ROIs on the frame
     * (face-mesh mode) + the skin mask. Defaults to on; falls back to the single
     * aggregated-ROI path when sub-ROIs are unavailable.
     */
    multiRoiFusion?: boolean;
    /**
     * Per-region projection inside the fuser: "pos" or "chrom". Left out, it follows the
     * `posFusion` fix switch ("pos" when on, "chrom", as published, when off).
     */
    fusionProjection?: FusionProjection;
    /**
     * Face tracking is on. With the `noFaceNoReading` fix switch on, a frame with no face is
     * then dropped instead of read. Otherwise the runner reads a 100x100 square in the middle
     * of the frame, which is right for whole-frame mode and wrong with face tracking on: every
     * published rppg-web (0.1.1 to 0.14.0) then kept reporting a heart rate from a plain wall
     * (27 of 41 seconds on real wall footage, demo settings).
     */
    requireFace?: boolean;
    /**
     * Pixel-selection and spatial-weighting profile. When omitted, the original
     * SDK YCbCr helper is used unchanged.
     */
    roiPixelSampler?: RoiPixelSampler;
    onRoiSamples?: (samples: readonly RppgRoiSampleV1[]) => void;
};
export type DemoRunnerDropReason = "frame_invalid" | "roi_missing" | "no_face" | "non_finite_intensity" | "processor_error";
export type DemoRunnerDiagnostics = {
    framesSeen: number;
    framesWithFaceRoi: number;
    framesWithFallbackRoi: number;
    framesWithMultiRoi: number;
    samplesPushed: number;
    droppedFrames: number;
    lastDropReason: DemoRunnerDropReason | null;
    lastTimestampMs: number | null;
    lastIntensity: number | null;
    lastSkinRatio: number | null;
    lastClipRatio: number | null;
    lastMotion: number | null;
    lastProcessorMethod: "rgb_meta" | "rgb" | "intensity" | "fused" | null;
    lastRoiSource: "multi_roi" | "face_roi" | "fallback_roi" | null;
    /** Frames fed through the multi-ROI fuser (subset of framesWithMultiRoi). */
    framesWithFusion: number;
    /** Per-region fusion weights (sum to 1), SNR-driven; null until fusion runs. */
    lastFusionWeights: Record<FusionRoiName, number> | null;
    /** In-band spectral SNR (linear) of the fused signal, or null. */
    lastFusedSnr: number | null;
    /** Versioned ROI contracts active for this runner. */
    roiGeometryProfileId: string;
    roiPixelSamplerId: string;
};
export type DemoRunnerError = {
    code: "processor_error";
    stage: "processor";
    message: string;
    timestampMs: number;
    diagnostics: DemoRunnerDiagnostics;
    cause?: unknown;
};
/** How long without a face (face tracking on) before the session stops reporting and the analysis restarts when the face returns. */
export declare const FACE_GONE_RESET_MS = 1000;
export declare class DemoRunner {
    private source;
    private processor;
    private opts;
    private running;
    private frameCount;
    private lastSampleTs;
    private smoothedRoi;
    private frameTimes;
    private lastFps;
    private lastCenter;
    private smoothedSkinRatio;
    private diagnostics;
    private lastError;
    private lastBlendshapes;
    private lastFaceBox;
    private fuser;
    /** Timestamp of the first frame of the current run without a face; null while a face is in view. */
    private noFaceSinceMs;
    private noFaceLastMs;
    /** Last frame on the fusion path, and the next grid time, for {@link pushOnGrid}. */
    private gridPrev;
    private gridNextT;
    /** The fix switches this runner applies. */
    readonly fixes: ResolvedRppgFixSwitches;
    /** The wall beside the face, one signal across patches (see WallTracker in pulseCheck.ts). */
    private wallTracker;
    private lastOpinionMs;
    constructor(source: FrameSource, processor: RppgProcessor, opts?: DemoRunnerOptions);
    /** How long no face has been in view as of `nowMs` (0 while a face is in view). */
    faceAbsentMs(nowMs?: number): number;
    /** Latest face blendshapes (for affect estimation), with capture timestamp. */
    getLastBlendshapes(): LastBlendshapes | null;
    /**
     * Latest normalized head box (for framing guidance), with capture timestamp.
     * Null until a face is tracked; consumers should treat a stale entry as
     * "no face" against their own clock.
     */
    getLastFaceBox(): LastFaceBox | null;
    start(): Promise<void>;
    stop(): Promise<void>;
    getDiagnostics(): DemoRunnerDiagnostics;
    getLastError(): DemoRunnerError | null;
    private onFrame;
    /**
     * Feed the fuser and the processor on the evenly spaced grid they were built
     * for (`sampleRate`, 30 by default). Both read their input as one sample per
     * 1/sampleRate seconds, so a camera that delivers fewer frames (15 to 25 a
     * second on a laptop in dim light) would scale every rate they report by
     * delivered/assumed. Each grid time between the previous frame and this one
     * gets the two frames' region means, linearly interpolated, so a slowed
     * camera reads close to the same rate as a full-rate one. A gap longer than GRID_MAX_GAP_MS is a stall, not a slow camera:
     * the grid restarts at the new frame instead of drawing a line across it.
     */
    private pushOnGrid;
    /**
     * Per-region skin-masked RGB for the fuser. The sub-ROIs arrive ordered as
     * {@link FUSION_ROIS} (forehead, leftCheek, rightCheek) from
     * `computeFusionSubRois`; a region with too little skin is skipped by the fuser.
     */
    private sampleFusionRegions;
    private recordDrop;
    private recordError;
    private emitDiagnostics;
}
//# sourceMappingURL=demoRunner.d.ts.map