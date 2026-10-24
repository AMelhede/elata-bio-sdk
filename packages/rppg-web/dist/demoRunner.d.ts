import { FrameSource, type FrameBlendshape } from "./frameSource.js";
import { type FaceBox } from "./faceFraming.js";
import { type ResolvedRppgFixSwitches, type RppgFixesOption } from "./fixSwitches.js";
import { type FusionProjection, type FusionRoiName } from "./multiRoiFusion.js";
import { type PulseCheck } from "./pulseCheck.js";
import type { ChestMotion } from "./chestBreathing.js";
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
    /** Mean brightness (0..1, BT.601) of the face regions the pulse check read on the latest frame, when known. */
    faceLuma?: number;
};
export type DemoRunnerOptions = {
    /**
     * Fix switches (see fixSwitches.ts). All on unless set to false. The runner applies
     * noFaceNoReading, posFusion and noFramesNoReading; the processor and the frame source the others.
     */
    fixes?: RppgFixesOption;
    /**
     * The wall clock frames are aged against (`framesAbsentMs`), in ms. Defaults to
     * `performance.now()`. For tests; leave out in an app.
     */
    now?: () => number;
    /**
     * The real-pulse check (see pulseCheck.ts), fed the same three face regions the fuser
     * reads plus a patch of wall beside the face. The session creates it (`pulseCheck`);
     * null or left out: no check.
     */
    pulseChecker?: PulseCheck | null;
    /**
     * Breathing from chest motion (see chestBreathing.ts), fed every analysed frame with its face
     * landmarks. The session creates it (`experimentalVitals`); null or left out: not read.
     */
    chestMotion?: ChestMotion | null;
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
     * then dropped (drop reason `no_face`) instead of read. createRppgSession turns it on in
     * face_mesh mode without an explicit `roi`, unless the caller sets it. Otherwise the runner reads a 100x100 square in the middle
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
export type DemoRunnerDropReason = "frame_invalid" | "roi_missing" | "no_face" | "non_finite_intensity" | "out_of_order" | "processor_error";
export type DemoRunnerDiagnostics = {
    framesSeen: number;
    framesWithFaceRoi: number;
    framesWithFallbackRoi: number;
    framesWithMultiRoi: number;
    /**
     * Frames whose sample stage completed, so framesSeen = samplesPushed +
     * droppedFrames.
     */
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
    /**
     * Frames fed through the multi-ROI fuser while it was feeding the processor,
     * i.e. the processor's latest sample as of that frame was a fused one
     * (subset of framesWithMultiRoi).
     */
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
/**
 * A break in the frames (fix noFramesNoReading): none for longer than this by the wall clock, and the
 * session reports no reading; a jump of the frames' own clock longer than this either way, and the
 * analysis starts afresh (a smaller step back is a frame out of order, dropped). The same bound the
 * pulse check (FACE_GONE_MS) and the chest motion (CHEST_GAP_MS) already apply to a gap in frames;
 * the check times its gap from its own latest face frame, so with a face missing just before a gap
 * the two can differ by that much. A gap it lets through costs little: the engine's window is 45 s
 * (SAMPLE_HISTORY_MS) and a hole scales its rate by the hole's share of it, about 1/45 for one 1 s
 * gap (several gaps in one window add up). Measured with the switch off on a known 66: 66 across a
 * 1 s gap (the 3 bpm spectral grid hides 64.5), 63 for 43 s after a 2 s gap, 51 for 35 s after a
 * 10 s one (the last is asserted in demoRunnerFrameGap.test.ts). A step back has no measured cost on
 * a live camera either way: in 12 browser runs on a fake camera the frames' clock never went back.
 */
export declare const FRAME_GAP_MS = 1000;
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
    /** When the face last came back after an absence long enough to restart the analysis, or the frames after a break in them; null if never. */
    private analysisRestartMs;
    /** The wall clock (`now`) when the latest frame arrived, or when start() ran if none has since. */
    private lastFrameAt;
    /** The frames' own clock at the latest frame that carried one: a break in it restarts the analysis. */
    private lastFrameMs;
    /** The wall clock (`now`) when the latest sample reached the processor; null before any. */
    private lastSampleAt;
    private readonly now;
    /** The fix switches this runner applies. */
    readonly fixes: ResolvedRppgFixSwitches;
    /** The wall beside the face, one signal across patches (see WallTracker in pulseCheck.ts). */
    private wallTracker;
    constructor(source: FrameSource, processor: RppgProcessor, opts?: DemoRunnerOptions);
    /**
     * How long no face has been in view as of `nowMs` (0 while a face is in view). `nowMs` is on the
     * clock of `Frame.timestampMs`; by default it is the timestamp of the latest frame without a face.
     */
    faceAbsentMs(nowMs?: number): number;
    /**
     * Wall-clock time (`now`) since the latest frame arrived, or since start() before the first, while the
     * runner runs with fix noFramesNoReading on; 0 otherwise. A wall clock, because the frames' own clock
     * stops with them. Stopped by the app (`stop()`) is not counted: the camera did not fail.
     */
    framesAbsentMs(nowMs?: number): number;
    /** Wall-clock time (`now`) since the latest sample reached the processor; null before any. */
    sampleAgeMs(nowMs?: number): number | null;
    /**
     * Time on the frame clock since the face came back after an absence of FACE_GONE_RESET_MS or more,
     * or the frames after a break in them (when the analysis is asked to start afresh), up to the latest
     * analysed frame; null if it never has.
     */
    msSinceAnalysisRestart(): number | null;
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
    /**
     * Fix noFramesNoReading, on the frames' own clock. A jump of more than FRAME_GAP_MS either way since
     * the latest frame (frames that stopped, a looping video, a source whose first frame carries
     * another clock) is a break: the analysis starts afresh, as when the face returns after an absence,
     * since a window across it would read every rate wrong for as long as the break stays in it
     * ("restart"). A frame older than the latest by less than that is out of order (a stale frame
     * delivered again): it is dropped, not read, and nothing restarts ("out_of_order").
     */
    private frameBreak;
    getLastError(): DemoRunnerError | null;
    private onFrame;
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