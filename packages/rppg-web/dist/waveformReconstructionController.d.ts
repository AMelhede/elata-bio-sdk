import { type RppgModelDiagnosticsV1, type RppgModelFallbackReason, type WaveformFeatureWindowV1, type WaveformReconstructionV1, type WaveformReconstructor } from "./waveformModel.js";
export declare class WaveformReconstructionController {
    private readonly reconstructor;
    private readonly inferenceIntervalMs;
    private busy;
    private lastStartedAt;
    private abort;
    private generation;
    private terminal;
    private restartable;
    private lifecycleTask;
    private inferenceTask;
    private latest;
    private diagnostics;
    constructor(reconstructor: WaveformReconstructor, inferenceIntervalMs?: number);
    init(): Promise<void>;
    offer(window: WaveformFeatureWindowV1, nowMs?: number): boolean;
    reportInputUnavailable(reason: RppgModelFallbackReason, inputSampleCount?: number): void;
    getLatest(): WaveformReconstructionV1 | null;
    getDiagnostics(): RppgModelDiagnosticsV1;
    stop(): Promise<void>;
    dispose(): Promise<void>;
    private initialize;
    private shutdown;
    private run;
}
//# sourceMappingURL=waveformReconstructionController.d.ts.map