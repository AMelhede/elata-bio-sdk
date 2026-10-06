import type { WaveformMorphologyV1 } from "./waveformMorphology.js";
export interface PhysiologyBaselineV1 {
    bpm: number;
    rmssdMs?: number | null;
    respirationBpm?: number | null;
}
export interface PhysiologyFeaturesV1 {
    schema: "elata.rppg.physiology-features/v1";
    timestampMs: number;
    reliability: number;
    reasons: string[];
    gates: {
        hasBpm: boolean;
        hasBaseline: boolean;
        hasHrv: boolean;
        hasRespiration: boolean;
        hasMorphology: boolean;
    };
    values: {
        hrDeltaBpm: number | null;
        hrDeltaNorm: number | null;
        hrSlopePerMin: number | null;
        hrvDeltaNorm: number | null;
        respirationDeltaNorm: number | null;
        morphologyReliability: number | null;
    };
}
export type PhysiologyState = "indeterminate" | "baseline" | "activated" | "recovering" | "unreliable";
export interface PhysiologyInterpretationV1 {
    schema: "elata.rppg.physiology-interpretation/v1";
    timestampMs: number;
    state: PhysiologyState;
    confidence: number;
    activationScore: number | null;
    recoveryScore: number | null;
    reasons: string[];
}
export interface PhysiologyInterpreter {
    interpret(features: PhysiologyFeaturesV1, context?: {
        previousActivationScore?: number | null;
    }): PhysiologyInterpretationV1;
}
export interface PhysiologyInterpreterConfigV1 {
    schema: "elata.rppg.physiology-interpreter-config/v1";
    id: string;
    minReliability: number;
    activationThreshold: number;
    recoveryThreshold: number;
}
export declare const DEFAULT_PHYSIOLOGY_INTERPRETER_CONFIG_V1: Readonly<PhysiologyInterpreterConfigV1>;
export declare function normalizePhysiologyFeatures(input: {
    timestampMs: number;
    bpm?: number | null;
    bpmSlopePerMin?: number | null;
    rmssdMs?: number | null;
    respirationBpm?: number | null;
    baseline?: PhysiologyBaselineV1 | null;
    signalQuality?: number | null;
    captureConfidence?: number | null;
    morphology?: WaveformMorphologyV1 | null;
}): PhysiologyFeaturesV1;
export declare function createPhysiologyInterpreter(config?: PhysiologyInterpreterConfigV1): PhysiologyInterpreter;
//# sourceMappingURL=physiologyFeatures.d.ts.map