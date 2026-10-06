import { blendshapeValenceArousal, physiologyArousal, fuseAffect, } from "./affect.js";
function median(values) {
    if (!values.length)
        return 0;
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
}
export class AffectTracker {
    constructor(options = {}) {
        this.lastFaceValence = null;
        this.lastFaceArousal = null;
        this.lastFaceAtMs = 0;
        this.baseline = null;
        this.calibBpm = [];
        this.calibRmssd = [];
        this.baselineSamples = options.baselineSamples ?? 60;
        this.faceStaleMs = options.faceStaleMs ?? 1500;
        this.defaultRmssd = options.defaultRmssd ?? 50;
    }
    reset() {
        this.lastFaceValence = null;
        this.lastFaceArousal = null;
        this.lastFaceAtMs = 0;
        this.baseline = null;
        this.calibBpm = [];
        this.calibRmssd = [];
    }
    getBaseline() {
        return this.baseline;
    }
    setBaseline(baseline) {
        this.baseline = baseline;
    }
    /** Feed face blendshapes; stores valence + face arousal with a timestamp. */
    observeFace(blendshapes, nowMs = Date.now()) {
        if (!blendshapes || !blendshapes.length)
            return;
        const va = blendshapeValenceArousal(blendshapes);
        if (!va)
            return;
        this.lastFaceValence = va.valence;
        this.lastFaceArousal = va.arousal;
        this.lastFaceAtMs = nowMs;
    }
    /** Feed physiology; accumulates the resting baseline until enough samples seen. */
    observePhysiology(bpm, rmssd) {
        if (this.baseline)
            return;
        if (bpm == null || !Number.isFinite(bpm) || bpm <= 0)
            return;
        this.calibBpm.push(bpm);
        if (rmssd != null && Number.isFinite(rmssd) && rmssd > 0) {
            this.calibRmssd.push(rmssd);
        }
        if (this.calibBpm.length >= this.baselineSamples) {
            this.baseline = {
                bpm: median(this.calibBpm),
                rmssd: this.calibRmssd.length ? median(this.calibRmssd) : this.defaultRmssd,
            };
        }
    }
    /** Compute the current fused affect state. */
    compute(input) {
        const nowMs = input.nowMs ?? Date.now();
        const faceFresh = nowMs - this.lastFaceAtMs < this.faceStaleMs;
        const physioAr = physiologyArousal(input.bpm, input.rmssd, this.baseline);
        return fuseAffect(faceFresh ? this.lastFaceValence : null, faceFresh ? this.lastFaceArousal : null, physioAr, input.physioConfidence ?? (physioAr != null ? 1 : 0), input.faceConfidence ?? (faceFresh ? 1 : 0));
    }
}
