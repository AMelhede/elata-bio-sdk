import type { RppgRoiSampleV1 } from "./roiPixelSampler.js";
import type { WaveformFeatureWindowV1 } from "./waveformModel.js";
export type WaveformWindowFailureReason = "insufficient_window" | "profile_mismatch" | "timestamp_mismatch" | "channel_mismatch" | "invalid_input";
export declare const MCD_WAVEFORM_ROIS: readonly ["forehead", "leftCheek", "rightCheek", "centralFace", "broadFace"];
export declare const MCD_WAVEFORM_CHANNELS: string[];
export declare class WaveformFeatureWindowBuilder {
    private readonly capacity;
    private readonly buffers;
    private lastFailure;
    constructor(capacity?: number);
    push(sample: RppgRoiSampleV1): void;
    get sampleCount(): number;
    get lastFailureReason(): WaveformWindowFailureReason | null;
    build(options: {
        profileId: string;
        length?: number;
        minSamples?: number;
        channels?: readonly string[];
        qualityWeightFloor?: number;
    }): WaveformFeatureWindowV1 | null;
}
//# sourceMappingURL=waveformFeatureWindow.d.ts.map