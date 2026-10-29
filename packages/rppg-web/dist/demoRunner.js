import { FOREHEAD_POOL_SIZE, foreheadPoolFromFrame } from "./facePatches.js";
import { ForeheadPool } from "./foreheadPool.js";
import { LIGHT_START, centreLightFromFrame, faceLightFromFrame, lightAfter } from "./lightLevel.js";
import { averageRgbInROI, averageRgbInROIWithSkinMaskStats, } from "./frameSource.js";
import { faceBoxFromLandmarks, padFaceBoxToHead, } from "./faceFraming.js";
import { resolveFixSwitches, } from "./fixSwitches.js";
import { FUSION_ROIS, MultiRoiRppgFuser, } from "./multiRoiFusion.js";
import { WallTracker, eyeBlink, headCentre, roomFromFrame, wallMissReason } from "./pulseCheck.js";
import { ELATA_YCBCR_V1_PIXEL_SAMPLER, sampleRppgRoi, } from "./roiPixelSampler.js";
import { ELATA_FACE_YCBCR_V1_PROFILE, } from "./roiProfile.js";
/** How long without a face (face tracking on) before the session stops reporting and the analysis restarts when the face returns. */
export const FACE_GONE_RESET_MS = 1000;
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
export const FRAME_GAP_MS = 1000;
/**
 * Push one sample through the richest push API the processor has. DemoRunner
 * duck-types its processor, so this order is part of its contract.
 */
function pushToProcessor(proc, s) {
    if (typeof proc.pushSampleRgbMeta === "function") {
        proc.pushSampleRgbMeta(s.t, s.rgb.r, s.rgb.g, s.rgb.b, s.skinRatio, s.motion, s.clipRatio);
        return "rgb_meta";
    }
    if (typeof proc.pushSampleRgb === "function") {
        proc.pushSampleRgb(s.t, s.rgb.r, s.rgb.g, s.rgb.b, s.skinRatio);
        return "rgb";
    }
    if (typeof proc.pushSample === "function") {
        proc.pushSample(s.t, s.intensity);
        return "intensity";
    }
    throw new TypeError("processor has no push sample API");
}
export class DemoRunner {
    constructor(source, processor, opts = {}) {
        this.source = source;
        this.processor = processor;
        this.opts = opts;
        this.running = false;
        this.frameCount = 0;
        this.lastSampleTs = 0;
        this.smoothedRoi = null;
        this.frameTimes = [];
        this.lastFps = null;
        this.lastCenter = null;
        this.smoothedSkinRatio = null;
        this.diagnostics = {
            framesSeen: 0,
            framesWithFaceRoi: 0,
            framesWithFallbackRoi: 0,
            framesWithMultiRoi: 0,
            samplesPushed: 0,
            droppedFrames: 0,
            lastDropReason: null,
            lastTimestampMs: null,
            lastIntensity: null,
            lastSkinRatio: null,
            lastClipRatio: null,
            lastMotion: null,
            lastProcessorMethod: null,
            lastRoiSource: null,
            framesWithFusion: 0,
            lastFusionWeights: null,
            lastFusedSnr: null,
            roiGeometryProfileId: ELATA_FACE_YCBCR_V1_PROFILE.id,
            roiPixelSamplerId: ELATA_YCBCR_V1_PIXEL_SAMPLER.id,
        };
        this.lastError = null;
        this.lastBlendshapes = null;
        this.lastFaceBox = null;
        this.fuser = null;
        /** Timestamp of the first frame of the current run without a face; null while a face is in view. */
        this.noFaceSinceMs = null;
        this.noFaceLastMs = null;
        /** When the face last came back after an absence long enough to restart the analysis, or the frames after a break in them; null if never. */
        this.analysisRestartMs = null;
        /** The wall clock (`now`) when the latest frame arrived, or when start() ran if none has since. */
        this.lastFrameAt = null;
        /** The frames' own clock at the latest frame that carried one: a break in it restarts the analysis. */
        this.lastFrameMs = null;
        /** The wall clock (`now`) when the latest sample reached the processor; null before any. */
        this.lastSampleAt = null;
        /** The wall beside the face, one signal across patches (see WallTracker in pulseCheck.ts). */
        this.wallTracker = new WallTracker();
        this.foreheadPool = null;
        this.lightState = LIGHT_START;
        this.lightApplied = 0;
        this.faceLight = null;
        this.source.onFrame = this.onFrame.bind(this);
        this.diagnostics.roiGeometryProfileId =
            opts.roiGeometryProfile?.id ?? ELATA_FACE_YCBCR_V1_PROFILE.id;
        this.diagnostics.roiPixelSamplerId =
            opts.roiPixelSampler?.id ?? ELATA_YCBCR_V1_PIXEL_SAMPLER.id;
        this.fixes = resolveFixSwitches(opts.fixes);
        this.now =
            opts.now ??
                (() => (typeof performance !== "undefined" ? performance.now() : Date.now()));
        if (opts.multiRoiFusion !== false) {
            this.fuser = new MultiRoiRppgFuser(opts.sampleRate ?? 30, 8, 0.5, opts.fusionProjection ?? (this.fixes.posFusion ? "pos" : "chrom"));
        }
    }
    /**
     * How long no face has been in view as of `nowMs` (0 while a face is in view). `nowMs` is on the
     * clock of `Frame.timestampMs`; by default it is the timestamp of the latest frame without a face.
     */
    faceAbsentMs(nowMs = this.noFaceLastMs ?? 0) {
        return this.noFaceSinceMs == null
            ? 0
            : Math.max(0, nowMs - this.noFaceSinceMs);
    }
    /**
     * Wall-clock time (`now`) since the latest frame arrived, or since start() before the first, while the
     * runner runs with fix noFramesNoReading on; 0 otherwise. A wall clock, because the frames' own clock
     * stops with them. Stopped by the app (`stop()`) is not counted: the camera did not fail.
     */
    framesAbsentMs(nowMs = this.now()) {
        if (!this.running || !this.fixes.noFramesNoReading || this.lastFrameAt == null)
            return 0;
        return Math.max(0, nowMs - this.lastFrameAt);
    }
    /** Wall-clock time (`now`) since the latest sample reached the processor; null before any. */
    sampleAgeMs(nowMs = this.now()) {
        return this.lastSampleAt == null ? null : Math.max(0, nowMs - this.lastSampleAt);
    }
    /**
     * Time on the frame clock since the face came back after an absence of FACE_GONE_RESET_MS or more,
     * or the frames after a break in them (when the analysis is asked to start afresh), up to the latest
     * analysed frame; null if it never has.
     */
    msSinceAnalysisRestart() {
        const last = this.diagnostics.lastTimestampMs;
        if (this.analysisRestartMs == null || last == null)
            return null;
        return Math.max(0, last - this.analysisRestartMs);
    }
    /** Latest face blendshapes (for affect estimation), with capture timestamp. */
    /** Switch light: the level the screen should light the face at, and the face light it was decided from. */
    getLight() {
        return { level: this.lightState.level, faceLuma: this.faceLight?.luma ?? null, faceRedClip: this.faceLight?.redClip ?? null };
    }
    /** Switch light: the level the app actually rendered (the burnout step is judged only on full light rendered). */
    setAppliedLight(level) {
        this.lightApplied = level;
    }
    getLastBlendshapes() {
        return this.lastBlendshapes;
    }
    /**
     * Latest normalized head box (for framing guidance), with capture timestamp.
     * Null until a face is tracked; consumers should treat a stale entry as
     * "no face" against their own clock.
     */
    getLastFaceBox() {
        return this.lastFaceBox;
    }
    async start() {
        this.running = true;
        this.lastFrameAt = this.now();
        await this.source.start();
    }
    async stop() {
        this.running = false;
        this.fuser?.reset();
        this.noFaceSinceMs = null;
        this.analysisRestartMs = null;
        await this.source.stop();
    }
    getDiagnostics() {
        return { ...this.diagnostics };
    }
    /**
     * Fix noFramesNoReading, on the frames' own clock. A jump of more than FRAME_GAP_MS either way since
     * the latest frame (frames that stopped, a looping video, a source whose first frame carries
     * another clock) is a break: the analysis starts afresh, as when the face returns after an absence,
     * since a window across it would read every rate wrong for as long as the break stays in it
     * ("restart"). A frame older than the latest by less than that is out of order (a stale frame
     * delivered again): it is dropped, not read, and nothing restarts ("out_of_order").
     */
    frameBreak(t) {
        if (t == null || !Number.isFinite(t))
            return null;
        const prev = this.lastFrameMs;
        if (!this.fixes.noFramesNoReading || prev == null) {
            this.lastFrameMs = t;
            return null;
        }
        if (t < prev && prev - t <= FRAME_GAP_MS)
            return "out_of_order";
        this.lastFrameMs = t;
        if (Math.abs(t - prev) <= FRAME_GAP_MS)
            return null;
        // A face out of view stays out of view for as long as it already was: after a step back its
        // start is moved onto the new clock.
        if (t < prev && this.noFaceSinceMs != null) {
            const absent = this.faceAbsentMs();
            this.noFaceSinceMs = t - absent;
            this.noFaceLastMs = t;
        }
        this.fuser?.reset();
        this.processor.resetSignal();
        // The pool's running means and windows are ordered in time: a clock step starts them over too.
        this.foreheadPool?.reset();
        this.analysisRestartMs = t;
        return "restart";
    }
    getLastError() {
        return this.lastError;
    }
    onFrame(frame) {
        if (!this.running)
            return;
        this.diagnostics.framesSeen += 1;
        this.lastFrameAt = this.now();
        const brk = this.frameBreak(frame.timestampMs);
        if (brk === "out_of_order") {
            this.recordDrop("out_of_order");
            return;
        }
        const restarted = brk === "restart";
        if (frame.blendshapes && frame.blendshapes.length) {
            this.lastBlendshapes = {
                blendshapes: frame.blendshapes,
                atMs: frame.timestampMs ?? Date.now(),
            };
        }
        // The box below the chin, for breathing from chest motion (opt-in): every analysed frame,
        // with or without a face (a face gone for over a second drops the motion).
        if (this.opts.chestMotion && frame.data && frame.timestampMs != null)
            this.opts.chestMotion.push(frame, frame.landmarks ?? null);
        // Capture the head box for framing guidance. Wall-clock `atMs` (not the
        // frame's media time) so consumers can age it against Date.now().
        if (frame.landmarks && frame.landmarks.length) {
            const mesh = faceBoxFromLandmarks(frame.landmarks);
            if (mesh) {
                const frameAspect = frame.width > 0 && frame.height > 0 ? frame.width / frame.height : undefined;
                this.lastFaceBox = { box: padFaceBoxToHead(frameAspect != null ? { ...mesh, frameAspect } : mesh), atMs: Date.now() };
            }
        }
        const now = typeof performance !== "undefined" ? performance.now() : Date.now();
        this.frameTimes.push(now);
        if (this.frameTimes.length > 30)
            this.frameTimes.shift();
        if (this.frameTimes.length >= 2) {
            const dt = (this.frameTimes[this.frameTimes.length - 1] - this.frameTimes[0]) /
                1000;
            if (dt > 0)
                this.lastFps = (this.frameTimes.length - 1) / dt;
        }
        const useSkinMask = this.opts.useSkinMask !== false;
        if (this.opts.onRoiSamples && frame.namedRois) {
            const sampler = this.opts.roiPixelSampler ?? ELATA_YCBCR_V1_PIXEL_SAMPLER;
            const samples = Object.entries(frame.namedRois).flatMap(([name, roi]) => roi
                ? [
                    sampleRppgRoi(frame, name, roi, this.diagnostics.roiGeometryProfileId, sampler),
                ]
                : []);
            this.opts.onRoiSamples(samples);
        }
        let rgb = { r: 0, g: 0, b: 0 };
        let skinRatio = 1;
        let clipRatio = 0;
        let intensity = 0;
        let motion = 0;
        let roiSource = null;
        let fusionResult = null;
        const rois = frame.rois && frame.rois.length > 0 ? frame.rois : null;
        // Switch light with no face regions this frame: a face too dark to be found is the case the light is for, so the
        // centre of the picture stands in until a face is found.
        if (this.opts.light && !(rois && rois.length >= 3) && frame.width > 0 && frame.data.length > 0 && frame.timestampMs != null) {
            this.faceLight = centreLightFromFrame(frame.data, frame.width, frame.height);
            this.lightState = lightAfter(this.lightState, this.faceLight, this.lightApplied, frame.timestampMs);
        }
        // No forehead and cheeks this frame: tell the check, so a rate proven on a face
        // does not outlive the face (see FACE_GONE_MS in pulseCheck.ts).
        if (this.opts.pulseChecker &&
            (!rois || rois.length < 3) &&
            frame.timestampMs != null) {
            this.opts.pulseChecker.faceLost(frame.timestampMs);
        }
        if ((rois || frame.roi) && this.noFaceSinceMs != null) {
            // The face is back. After an absence long enough for the session to have stopped
            // reporting, start the analysis afresh, or the first number back would come from a
            // window still holding the frames before the face was lost.
            if (!restarted && this.faceAbsentMs() >= FACE_GONE_RESET_MS) {
                this.fuser?.reset();
                this.processor.resetSignal();
                this.analysisRestartMs = frame.timestampMs ?? Date.now();
            }
            this.noFaceSinceMs = null;
        }
        if (rois) {
            roiSource = "multi_roi";
            this.diagnostics.framesWithMultiRoi += 1;
            const agg = aggregateRgbFromRois(frame, rois, useSkinMask, this.opts.roiPixelSampler);
            rgb = { r: agg.r, g: agg.g, b: agg.b };
            skinRatio = agg.skinRatio;
            clipRatio = agg.clipRatio;
            intensity = agg.g;
            // Multi-ROI fusion: per-region CHROM blended by in-band SNR. The
            // aggregate above is still computed for diagnostics/onStats and as the
            // fallback if the fuser can't produce a valid frame this tick.
            if (this.fuser && useSkinMask) {
                const fusionSamples = this.sampleFusionRegions(frame, rois);
                // One fuser step per camera frame.
                if (fusionSamples)
                    fusionResult = this.fuser.pushFrame(fusionSamples);
            }
            if (this.opts.pulseChecker &&
                rois.length >= 3 &&
                frame.timestampMs != null) {
                // Same three region boxes and the same skin-masked mean the fuser uses.
                // And a patch of wall beside the face, for the wall check: only its
                // pixels that do not look like skin, so a face edge or an ear in it
                // cannot carry the person's own pulse into the wall.
                const wall = frame.landmarks
                    ? this.wallTracker.next(frame.landmarks, frame)
                    : null;
                let foreheadBox = null;
                const rects = rois.slice(0, 3).map((roi) => clampRoiToFrame(roi, frame.width, frame.height));
                const boxes = rects.map((c) => averageRgbInROIWithSkinMaskStats(frame, c.x, c.y, c.w, c.h));
                // Switch light: the face's light from the same boxes, before the pool swaps the forehead.
                if (this.opts.light) {
                    this.faceLight = faceLightFromFrame(frame.data, frame.width, rects, boxes);
                    this.lightState = lightAfter(this.lightState, this.faceLight, this.lightApplied, frame.timestampMs);
                }
                // Switch foreheadPool: the forehead from the patch pool (the box until the pool has a value).
                if (this.opts.foreheadPool && frame.landmarks) {
                    this.foreheadPool ?? (this.foreheadPool = new ForeheadPool(FOREHEAD_POOL_SIZE));
                    const pf = foreheadPoolFromFrame(frame, frame.landmarks);
                    const v = pf ? this.foreheadPool.push({ t: frame.timestampMs, ...pf }) : null;
                    if (v) {
                        foreheadBox = boxes[0];
                        boxes[0] = { ...boxes[0], r: v.r, g: v.g, b: v.b };
                    }
                }
                this.opts.pulseChecker.push(frame.timestampMs, boxes, wall?.rgb, frame.landmarks && !wall
                    ? wallMissReason(frame.landmarks, frame.width, frame.height)
                    : undefined, 
                // The head's position, for the headMotion rule: a rate the head's own
                // movement keeps time with (a nod) is the movement's, not a pulse.
                frame.landmarks ? withBlink(headCentre(frame.landmarks, frame.width, frame.height), eyeBlink(frame.blendshapes)) : null, 
                // The wall as the camera read it, for its brightness (rule darkWall): the
                // continuous wall above carries a darker patch on at a brighter one's level.
                wall?.raw, 
                // Recorded only, and only computed when a recording keeps it (lane/wallroom step 1):
                // the room in the frame's upper corners, and where the wall patch sat this frame.
                this.opts.pulseChecker.wantsDiagnostics
                    ? { room: roomFromFrame(frame, frame.landmarks ?? null), patch: wall?.patch ?? null, ...(foreheadBox ? { foreheadBox } : {}), ...(this.opts.light ? { light: { face: this.faceLight, wanted: this.lightState.level, applied: this.lightApplied } } : {}) }
                    : undefined);
            }
            if (frame.roi) {
                motion = computeMotion(frame.roi, this.lastCenter);
                this.lastCenter = {
                    x: frame.roi.x + frame.roi.w * 0.5,
                    y: frame.roi.y + frame.roi.h * 0.5,
                };
            }
        }
        else {
            let roi = this.opts.roi;
            if (typeof roi === "undefined") {
                roi = frame.roi ?? null;
            }
            if (frame.roi) {
                this.diagnostics.framesWithFaceRoi += 1;
                roiSource = "face_roi";
            }
            if (!roi &&
                (frame.width <= 0 || frame.height <= 0 || !frame.data.length)) {
                this.recordDrop("frame_invalid");
                return;
            }
            if (!roi && this.opts.requireFace && this.fixes.noFaceNoReading) {
                this.noFaceSinceMs ?? (this.noFaceSinceMs = frame.timestampMs ?? Date.now());
                this.noFaceLastMs = frame.timestampMs ?? Date.now();
                // The last frame read came from a face; none is in view now.
                this.diagnostics.lastRoiSource = null;
                this.recordDrop("no_face");
                return;
            }
            if (!roi) {
                roi = {
                    x: Math.floor((frame.width - 100) / 2),
                    y: Math.floor((frame.height - 100) / 2),
                    w: 100,
                    h: 100,
                };
                this.diagnostics.framesWithFallbackRoi += 1;
                roiSource = "fallback_roi";
            }
            const clamped = clampRoiToFrame(roi, frame.width, frame.height);
            const smoothed = smoothRoi(this.smoothedRoi, clamped, this.opts.roiSmoothingAlpha);
            const smoothedClamped = clampRoiToFrame(smoothed, frame.width, frame.height);
            this.smoothedRoi = smoothedClamped;
            if (useSkinMask) {
                const rgbRes = sampleRgbWithSkinMask(frame, smoothedClamped, this.opts.roiPixelSampler);
                rgb = { r: rgbRes.r, g: rgbRes.g, b: rgbRes.b };
                skinRatio = rgbRes.skinRatio;
                clipRatio = rgbRes.clipRatio;
                intensity = rgbRes.g;
            }
            else {
                rgb = averageRgbInROI(frame, smoothedClamped.x, smoothedClamped.y, smoothedClamped.w, smoothedClamped.h);
                intensity = rgb.g;
                skinRatio = 1;
                clipRatio = 0;
            }
            motion = computeMotion(smoothedClamped, this.lastCenter);
            this.lastCenter = {
                x: smoothedClamped.x + smoothedClamped.w * 0.5,
                y: smoothedClamped.y + smoothedClamped.h * 0.5,
            };
        }
        if (!Number.isFinite(intensity)) {
            this.recordDrop("non_finite_intensity");
            return;
        }
        skinRatio = smooth01(this.smoothedSkinRatio, skinRatio, this.opts.skinRatioSmoothingAlpha ?? 0.2);
        this.smoothedSkinRatio = skinRatio;
        const ts = frame.timestampMs ?? Date.now();
        const proc = this.processor;
        try {
            if (fusionResult?.valid &&
                typeof proc.pushFusedSample === "function") {
                // Fused pulse already carries the
                // per-region projection + SNR-weighted blending; feed it straight to
                // spectral BPM/HRV, with the fused SNR as quality.
                proc.pushFusedSample(ts, fusionResult.fused, fusionResult.fusedSnr);
                this.diagnostics.lastProcessorMethod = "fused";
                this.diagnostics.framesWithFusion += 1;
                this.diagnostics.lastFusionWeights = fusionResult.weights;
                this.diagnostics.lastFusedSnr = fusionResult.fusedSnr;
            }
            else {
                this.diagnostics.lastProcessorMethod = pushToProcessor(proc, {
                    t: ts,
                    rgb,
                    intensity,
                    skinRatio,
                    motion,
                    clipRatio,
                });
            }
        }
        catch (error) {
            this.recordDrop("processor_error");
            this.running = false;
            void this.source.stop().catch(() => { });
            this.recordError(error);
            return;
        }
        this.diagnostics.samplesPushed += 1;
        this.lastSampleAt = this.now();
        this.diagnostics.lastDropReason = null;
        this.diagnostics.lastTimestampMs = ts;
        this.diagnostics.lastIntensity = intensity;
        this.diagnostics.lastSkinRatio = skinRatio;
        this.diagnostics.lastClipRatio = clipRatio;
        this.diagnostics.lastMotion = motion;
        this.diagnostics.lastRoiSource = roiSource;
        this.emitDiagnostics();
        if (this.opts.onStats) {
            this.opts.onStats({
                intensity,
                skinRatio,
                fps: this.lastFps,
                r: rgb.r,
                g: rgb.g,
                b: rgb.b,
                clipRatio,
                motion,
            });
        }
    }
    /**
     * Per-region skin-masked RGB for the fuser. The sub-ROIs arrive ordered as
     * {@link FUSION_ROIS} (forehead, leftCheek, rightCheek) from
     * `computeFusionSubRois`; a region with too little skin is skipped by the fuser.
     */
    sampleFusionRegions(frame, rois) {
        if (!this.fuser)
            return null;
        const samples = {};
        const n = Math.min(FUSION_ROIS.length, rois.length);
        for (let i = 0; i < n; i++) {
            const c = clampRoiToFrame(rois[i], frame.width, frame.height);
            const s = sampleRgbWithSkinMask(frame, c, this.opts.roiPixelSampler);
            samples[FUSION_ROIS[i]] = {
                r: s.r,
                g: s.g,
                b: s.b,
                skinFraction: s.skinRatio,
            };
        }
        return samples;
    }
    recordDrop(reason) {
        this.diagnostics.droppedFrames += 1;
        this.diagnostics.lastDropReason = reason;
        this.emitDiagnostics();
    }
    recordError(cause) {
        const error = {
            code: "processor_error",
            stage: "processor",
            message: cause instanceof Error
                ? cause.message
                : "The rPPG processor rejected a frame sample.",
            timestampMs: Date.now(),
            diagnostics: this.getDiagnostics(),
            cause,
        };
        this.lastError = error;
        this.opts.onError?.(error);
    }
    emitDiagnostics() {
        if (this.opts.onDiagnostics) {
            this.opts.onDiagnostics(this.getDiagnostics());
        }
    }
}
function clampRoiToFrame(roi, width, height) {
    const x = Math.max(0, Math.min(width - 1, Math.floor(roi.x)));
    const y = Math.max(0, Math.min(height - 1, Math.floor(roi.y)));
    const w = Math.max(1, Math.min(width - x, Math.floor(roi.w)));
    const h = Math.max(1, Math.min(height - y, Math.floor(roi.h)));
    return { x, y, w, h };
}
function smoothRoi(prev, next, alpha = 0.2) {
    if (!prev)
        return next;
    const prevCx = prev.x + prev.w * 0.5;
    const prevCy = prev.y + prev.h * 0.5;
    const nextCx = next.x + next.w * 0.5;
    const nextCy = next.y + next.h * 0.5;
    const dx = nextCx - prevCx;
    const dy = nextCy - prevCy;
    const maxDim = Math.max(prev.w, prev.h);
    if (Math.sqrt(dx * dx + dy * dy) > maxDim * 0.35) {
        return next;
    }
    const a = Math.min(0.9, Math.max(0.05, alpha));
    return {
        x: prev.x + (next.x - prev.x) * a,
        y: prev.y + (next.y - prev.y) * a,
        w: prev.w + (next.w - prev.w) * a,
        h: prev.h + (next.h - prev.h) * a,
    };
}
function aggregateRgbFromRois(frame, rois, useSkinMask, pixelSampler) {
    let sumR = 0;
    let sumG = 0;
    let sumB = 0;
    let sumW = 0; // weight for RGB (skin pixels)
    let sumArea = 0;
    let sumSkinArea = 0;
    let sumClipArea = 0;
    for (const roi of rois) {
        const clamped = clampRoiToFrame(roi, frame.width, frame.height);
        const area = clamped.w * clamped.h;
        sumArea += area;
        if (useSkinMask) {
            const rgbRes = sampleRgbWithSkinMask(frame, clamped, pixelSampler);
            // Keep ROI contribution from collapsing to near-zero on transient skin-mask misses.
            const weight = area * Math.max(0.15, rgbRes.skinRatio);
            sumR += rgbRes.r * weight;
            sumG += rgbRes.g * weight;
            sumB += rgbRes.b * weight;
            sumW += weight;
            sumSkinArea += rgbRes.skinRatio * area;
            sumClipArea += rgbRes.clipRatio * area;
        }
        else {
            const rgbRes = averageRgbInROI(frame, clamped.x, clamped.y, clamped.w, clamped.h);
            sumR += rgbRes.r * area;
            sumG += rgbRes.g * area;
            sumB += rgbRes.b * area;
            sumW += area;
            sumSkinArea += area;
        }
    }
    if (sumW <= 0 || sumArea <= 0) {
        return { r: 0, g: 0, b: 0, skinRatio: 0, clipRatio: 0 };
    }
    return {
        r: sumR / sumW,
        g: sumG / sumW,
        b: sumB / sumW,
        skinRatio: sumSkinArea / sumArea,
        clipRatio: sumClipArea / sumArea,
    };
}
function sampleRgbWithSkinMask(frame, roi, pixelSampler) {
    if (!pixelSampler) {
        return averageRgbInROIWithSkinMaskStats(frame, roi.x, roi.y, roi.w, roi.h);
    }
    const sample = pixelSampler.sample(frame, roi);
    return {
        r: sample.r,
        g: sample.g,
        b: sample.b,
        skinRatio: sample.effectiveSkinFraction,
        clipRatio: sample.clipRatio,
    };
}
function computeMotion(roi, last) {
    if (!last)
        return 0;
    const cx = roi.x + roi.w * 0.5;
    const cy = roi.y + roi.h * 0.5;
    const dx = cx - last.x;
    const dy = cy - last.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const norm = Math.max(1, Math.max(roi.w, roi.h));
    return Math.min(1, dist / norm);
}
function smooth01(prev, next, alpha) {
    const n = Math.max(0, Math.min(1, next));
    if (prev === null || !Number.isFinite(prev))
        return n;
    const a = Math.min(0.8, Math.max(0.05, alpha));
    const delta = n - prev;
    const effectiveAlpha = Math.abs(delta) > 0.3 ? a * 0.35 : a;
    return Math.max(0, Math.min(1, prev + delta * effectiveAlpha));
}
/** The head with the frame's blink score added when the landmarker gave one (recorded only, HeadPosition.blink). */
function withBlink(head, blink) {
    return head && blink != null ? { ...head, blink } : head;
}
