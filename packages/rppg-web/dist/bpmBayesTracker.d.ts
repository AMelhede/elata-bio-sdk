import type { WaveformPeriodicityProfile } from "./rppgDiagnostics.js";
export type TrackerSource = "peaks" | "acf" | "spectral";
export type HarmonicMode = "half" | "fundamental" | "double";
export type TrackerReferenceOrigin = "none" | "session_pair" | "snapshot_restore";
export interface EstimatorMeasurement {
    source: TrackerSource;
    bpm: number | null;
    confidence: number;
}
export interface TrackerContext {
    motion: number;
    snrDb: number;
    quality: number;
    referenceBpm?: number;
    referenceStrength?: number;
    referenceAgeSec?: number;
    waveformProfile?: WaveformPeriodicityProfile | null;
}
export interface TrackerEstimate {
    bpm: number | null;
    confidence: number;
    modeProbabilities: Record<HarmonicMode, number>;
    entropy: number;
    ambiguity: number;
    qualityProviderId: string | null;
}
export interface BpmEvidenceQuality {
    sourceMultiplier?: Partial<Record<TrackerSource, number>>;
    ambiguityPenalty?: number;
}
export interface BpmEvidenceQualityProvider {
    readonly id: string;
    evaluate(input: {
        measurements: readonly EstimatorMeasurement[];
        context: Readonly<TrackerContext>;
    }): BpmEvidenceQuality;
}
export interface BpmBayesSnapshot {
    trackerConfigId?: string;
    minBpm: number;
    maxBpm: number;
    stepBpm: number;
    posterior: number[];
    sourceReliability: Record<TrackerSource, number>;
    sourceHarmonicConfusion: Record<TrackerSource, number>;
    referencePriorBpm?: number | null;
    referencePriorWeight?: number;
    harmonicPrior?: Record<HarmonicMode, number>;
    referencePriorOrigin?: TrackerReferenceOrigin;
    referencePriorLastUpdatedTs?: number | null;
    waveformReliability?: number;
}
export interface BpmTrackerConfigV1 {
    schema: "elata.rppg.bpm-tracker-config/v1";
    id: string;
    ambiguityPenalty: {
        enabled: boolean;
        spreadStartBpm: number;
        spreadRangeBpm: number;
        maxPenalty: number;
    };
}
export declare const DEFAULT_BPM_TRACKER_CONFIG_V1: BpmTrackerConfigV1;
export interface TrackerReferenceState {
    bpm: number | null;
    weight: number;
    harmonicPrior: Record<HarmonicMode, number>;
    origin: TrackerReferenceOrigin;
    lastUpdatedTs: number | null;
    waveformReliability: number;
}
export declare function parseBpmTrackerConfigV1(value: unknown): BpmTrackerConfigV1;
export declare class BpmBayesTracker {
    private readonly minBpm;
    private readonly maxBpm;
    private readonly stepBpm;
    private readonly bpmGrid;
    private posterior;
    private sourceReliability;
    private sourceHarmonicConfusion;
    private referencePriorBpm;
    private referencePriorWeight;
    private harmonicPrior;
    private referencePriorOrigin;
    private referencePriorLastUpdatedTs;
    private waveformReliability;
    private evidenceAmbiguity;
    private readonly config;
    private readonly qualityProvider?;
    constructor(minBpm?: number, maxBpm?: number, stepBpm?: number, config?: BpmTrackerConfigV1, qualityProvider?: BpmEvidenceQualityProvider);
    reset(): void;
    update(measurements: EstimatorMeasurement[], dtSec: number, context: TrackerContext): TrackerEstimate;
    observeReference(referenceBpm: number, strength?: number, _measurements?: EstimatorMeasurement[]): void;
    reinforceReference(referenceBpm: number, measurements: EstimatorMeasurement[], strength?: number, updatedAtTs?: number, waveformProfile?: WaveformPeriodicityProfile | null): void;
    reinforceHarmonicReference(referenceBpm: number, measurements: EstimatorMeasurement[], strength?: number, updatedAtTs?: number, waveformProfile?: WaveformPeriodicityProfile | null): void;
    updateReliability(referenceBpm: number, measurements: EstimatorMeasurement[]): void;
    getSnapshot(): BpmBayesSnapshot;
    getConfig(): BpmTrackerConfigV1;
    getReferenceState(): TrackerReferenceState;
    loadSnapshot(snapshot: unknown): void;
    private toIndex;
    private applyTemporalPrior;
    private estimate;
    private evaluateQualityProvider;
    private estimateEvidenceAmbiguity;
    private normalize;
    private applyWaveformEvidence;
    private updateWaveformReliability;
    private estimateWaveformAgreement;
    private applyPersistentReferencePrior;
    private inferReferenceModeWeights;
}
//# sourceMappingURL=bpmBayesTracker.d.ts.map