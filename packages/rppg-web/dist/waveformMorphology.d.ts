export type WaveformMorphologySource = "reconstructed" | "filtered" | "contact" | "unknown";
export interface WaveformMorphologyBaselineV1 {
    amplitude: number | null;
    templateEnergy: number | null;
    upstrokeSlope: number | null;
    respiratoryModulation: number | null;
}
export interface WaveformMorphologyV1 {
    schema: "elata.rppg.waveform-morphology/v1";
    source: {
        kind: WaveformMorphologySource;
        modelId: string | null;
    };
    usable: boolean;
    reliability: number;
    reasons: string[];
    gates: {
        hasSignal: boolean;
        hasBpm: boolean;
        stableCycle: boolean;
        enoughCycleCoverage: boolean;
    };
    periodicity: {
        dominantBpm: number | null;
        targetErrorBpm: number | null;
        confidence: number;
        entropy: number;
    };
    cycle: {
        correlation: number | null;
        normalizedRmse: number | null;
        peakPhase: number | null;
        troughPhase: number | null;
        pulseWidthPhase: number | null;
        amplitude: number | null;
        upstrokeSlope: number | null;
        downstrokeSlope: number | null;
        templateEnergy: number | null;
        asymmetry: number | null;
        populatedBinFraction: number | null;
    };
    experimentalProxies: {
        perfusionChangeNorm: number | null;
        energyChangeNorm: number | null;
        upstrokeChangeNorm: number | null;
        respiratoryModulation: number | null;
        vascularTone: number | null;
    } | null;
}
export declare function extractWaveformMorphology(options: {
    values: readonly number[] | Float32Array;
    sampleRate: number;
    bpm?: number | null;
    baseline?: WaveformMorphologyBaselineV1 | null;
    source?: WaveformMorphologySource;
    modelId?: string | null;
    bins?: number;
}): WaveformMorphologyV1;
export declare function createWaveformMorphologyBaseline(features: readonly WaveformMorphologyV1[]): WaveformMorphologyBaselineV1 | null;
//# sourceMappingURL=waveformMorphology.d.ts.map