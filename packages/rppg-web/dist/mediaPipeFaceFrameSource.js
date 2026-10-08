import { resolveFixSwitches, } from "./fixSwitches.js";
import { ELATA_FACE_YCBCR_V1_PROFILE, FUSION_ROI_NAMES, } from "./roiProfile.js";
/**
 * Frame source backed by MediaPipe FaceLandmarker (tasks-vision). Each frame
 * carries the face ROI + forehead/cheek sub-ROIs (for rPPG) plus the raw
 * landmarks and blendshape coefficients (for affect / valence-arousal).
 *
 * Unlike the legacy FaceMesh (async send/onResults), FaceLandmarker.detectForVideo
 * is synchronous, so detection happens inline in the capture loop.
 */
/**
 * Widest frame the pipeline reads, in pixels. The pulse is the mean colour of a skin patch,
 * and camera noise in that mean falls with the square root of the pixel count, so past a few
 * thousand pixels per patch more resolution buys nothing: at 640 wide a cheek patch still
 * averages thousands of pixels, putting sensor noise far under a 0.5% pulse. Every later step
 * (skin mask, region means, fusion, the pulse check) costs time in proportion to pixels, so
 * reading a 1280x960 camera at full size cut the analysed frame rate to ~7 per second
 * (measured 2026-10-02, a laptop webcam and a 1280x960 test feed alike).
 */
export const MAX_ANALYSIS_WIDTH = 640;
/** Analysis frame size for a video size: same aspect, at most MAX_ANALYSIS_WIDTH wide. */
export function analysisSize(videoWidth, videoHeight) {
    const scale = Math.min(1, MAX_ANALYSIS_WIDTH / videoWidth);
    return {
        width: Math.max(1, Math.round(videoWidth * scale)),
        height: Math.max(1, Math.round(videoHeight * scale)),
    };
}
/**
 * With `sparseFaceFinder` on, the face finder is asked at most this often; the frames in between are
 * read with the last face it found. The finder is the costliest step per frame: an app built on this
 * package measured it at about 20 ms of a 33 ms frame on a laptop, where finding the face on every
 * frame let a 30 fps camera arrive as 8 to 19 frames a second, and asks it at this interval. A still
 * face does not move in a tenth of a second, a moving head is followed within one, and a nod (one or
 * two a second) is still seen five or more times per cycle by the movement rule.
 */
export const FACE_FINDER_EVERY_MS = 100;
export class MediaPipeFaceFrameSource {
    constructor(video, faceLandmarker, fps = 30, roiGeometryProfile = ELATA_FACE_YCBCR_V1_PROFILE, fixes) {
        this.video = video;
        this.faceLandmarker = faceLandmarker;
        this.fps = fps;
        this.roiGeometryProfile = roiGeometryProfile;
        this.onFrame = null;
        this.onError = null;
        this.running = false;
        this.vfcHandle = null;
        this.smoothedFaceRoi = null;
        this.lastError = null;
        /** The last answer from the face finder and when it was asked (sparseFaceFinder). */
        this.lastFace = null;
        this.fixes = resolveFixSwitches(fixes);
        this.canvas = document.createElement("canvas");
        const size = this.frameSize(video.videoWidth || video.width || 320, video.videoHeight || video.height || 240);
        this.canvas.width = size.width;
        this.canvas.height = size.height;
        const ctx = this.canvas.getContext("2d");
        if (!ctx)
            throw new Error("2D context unavailable");
        this.ctx = ctx;
    }
    async start() {
        if (this.running)
            return;
        this.running = true;
        const interval = 1000 / this.fps;
        const vfc = this.video.requestVideoFrameCallback;
        if (typeof vfc === "function") {
            const cb = (now, metadata) => {
                if (!this.running)
                    return;
                this.detectAndEmit(now, metadata);
                this.vfcHandle = this.video.requestVideoFrameCallback(cb);
            };
            this.vfcHandle = this.video.requestVideoFrameCallback(cb);
        }
        else {
            const tick = () => {
                if (!this.running)
                    return;
                this.detectAndEmit(Date.now(), null);
                setTimeout(tick, interval);
            };
            tick();
        }
    }
    async stop() {
        this.running = false;
        this.smoothedFaceRoi = null;
        this.lastFace = null;
        const cancel = this.video.cancelVideoFrameCallback;
        if (this.vfcHandle !== null && typeof cancel === "function") {
            cancel.call(this.video, this.vfcHandle);
            this.vfcHandle = null;
        }
    }
    getLastError() {
        return this.lastError;
    }
    /** Canvas size for a video size: capped at MAX_ANALYSIS_WIDTH with analysisWidth on, else full size as published. */
    frameSize(w, h) {
        return this.fixes.analysisWidth
            ? analysisSize(w, h)
            : { width: w, height: h };
    }
    detectAndEmit(now, metadata) {
        // Resize canvas if the video dimensions became known after construction.
        if (this.video.videoWidth) {
            const size = this.frameSize(this.video.videoWidth, this.video.videoHeight);
            if (this.canvas.width !== size.width ||
                this.canvas.height !== size.height) {
                this.canvas.width = size.width;
                this.canvas.height = size.height;
            }
        }
        // Draw the frame once at analysis size, then find the face in THAT image: the face
        // finder scales its input to ~256 px internally, so the full camera frame only cost it
        // a larger copy (measured 2026-10-02: ~62 ms of a ~77 ms frame at 1280x960), and the
        // landmarks now come from exactly the pixels the regions are sampled from, not from a
        // live video frame that may have advanced in between.
        try {
            this.ctx.drawImage(this.video, 0, 0, this.canvas.width, this.canvas.height);
        }
        catch (error) {
            this.reportError("capture_failed", "capture", error);
            return;
        }
        let landmarks = null;
        let blendshapes;
        const last = this.lastFace;
        const reuse = this.fixes.sparseFaceFinder &&
            last != null &&
            now >= last.atMs &&
            now - last.atMs < FACE_FINDER_EVERY_MS;
        if (reuse) {
            landmarks = last.landmarks;
            blendshapes = last.blendshapes;
        }
        else {
            try {
                const result = this.faceLandmarker.detectForVideo(this.fixes.analysisWidth ? this.canvas : this.video, now);
                landmarks = result?.faceLandmarks?.[0] ?? null;
                const categories = result?.faceBlendshapes?.[0]?.categories;
                if (categories && categories.length) {
                    blendshapes = categories.map((c) => ({
                        categoryName: c.categoryName,
                        score: c.score,
                    }));
                }
                this.lastFace = { atMs: now, landmarks, blendshapes };
            }
            catch (error) {
                this.lastFace = null;
                this.reportError("face_mesh_failed", "face_mesh", error);
            }
        }
        try {
            const img = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
            const ts = typeof metadata?.mediaTime === "number" && metadata.mediaTime > 0
                ? metadata.mediaTime * 1000
                : now;
            const frame = {
                data: img.data,
                width: this.canvas.width,
                height: this.canvas.height,
                timestampMs: ts,
            };
            if (landmarks) {
                const raw = this.landmarksToROI(landmarks, frame.width, frame.height);
                const roi = this.smoothRoi(raw, frame.width, frame.height);
                frame.roi = roi;
                // Forehead/cheek sub-ROIs come from the shared overlay geometry, so the
                // pixels sampled for the pulse are exactly the boxes drawn by
                // drawFaceOverlay (single source of truth for ROI placement).
                frame.namedRois = this.roiGeometryProfile.compute(landmarks, frame.width, frame.height);
                frame.rois = FUSION_ROI_NAMES.flatMap((name) => frame.namedRois?.[name] ? [frame.namedRois[name]] : []);
                frame.landmarks = landmarks;
            }
            if (blendshapes)
                frame.blendshapes = blendshapes;
            if (this.onFrame)
                this.onFrame(frame);
        }
        catch (error) {
            this.reportError("capture_failed", "capture", error);
        }
    }
    landmarksToROI(landmarks, width, height) {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const p of landmarks) {
            const x = (p.x ?? 0) * width;
            const y = (p.y ?? 0) * height;
            if (x < minX)
                minX = x;
            if (y < minY)
                minY = y;
            if (x > maxX)
                maxX = x;
            if (y > maxY)
                maxY = y;
        }
        const padX = Math.max(4, Math.floor((maxX - minX) * 0.15));
        const padY = Math.max(4, Math.floor((maxY - minY) * 0.15));
        const x = Math.max(0, Math.floor(minX - padX));
        const y = Math.max(0, Math.floor(minY - padY));
        const w = Math.min(width - x, Math.ceil(maxX - minX + 2 * padX));
        const h = Math.min(height - y, Math.ceil(maxY - minY + 2 * padY));
        return { x, y, w, h };
    }
    smoothRoi(next, width, height) {
        const prev = this.smoothedFaceRoi;
        if (!prev) {
            const init = clampRoi(next, { x: 0, y: 0, w: width, h: height });
            this.smoothedFaceRoi = init;
            return init;
        }
        const prevCx = prev.x + prev.w * 0.5;
        const prevCy = prev.y + prev.h * 0.5;
        const nextCx = next.x + next.w * 0.5;
        const nextCy = next.y + next.h * 0.5;
        const dx = nextCx - prevCx;
        const dy = nextCy - prevCy;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const maxDim = Math.max(prev.w, prev.h);
        const jump = dist > maxDim * 0.35;
        const alpha = jump ? 0.65 : 0.22;
        const blended = {
            x: prev.x + (next.x - prev.x) * alpha,
            y: prev.y + (next.y - prev.y) * alpha,
            w: prev.w + (next.w - prev.w) * alpha,
            h: prev.h + (next.h - prev.h) * alpha,
        };
        const clamped = clampRoi(blended, { x: 0, y: 0, w: width, h: height });
        this.smoothedFaceRoi = clamped;
        return clamped;
    }
    reportError(code, stage, cause) {
        const message = cause instanceof Error
            ? cause.message
            : stage === "face_mesh"
                ? "FaceLandmarker failed while processing a browser video frame."
                : "Failed to capture a browser video frame.";
        const error = {
            code,
            stage,
            message,
            timestampMs: Date.now(),
            cause,
        };
        this.lastError = error;
        this.onError?.(error);
    }
}
function clampRoi(roi, bounds) {
    const x = Math.max(bounds.x, Math.min(bounds.x + bounds.w - 1, roi.x));
    const y = Math.max(bounds.y, Math.min(bounds.y + bounds.h - 1, roi.y));
    const w = Math.max(1, Math.min(bounds.x + bounds.w - x, roi.w));
    const h = Math.max(1, Math.min(bounds.y + bounds.h - y, roi.h));
    return { x, y, w, h };
}
