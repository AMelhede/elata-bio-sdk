import { WaveformModelError, } from "./waveformModel.js";
export class WaveformReconstructionController {
    constructor(reconstructor, inferenceIntervalMs = 1000) {
        this.reconstructor = reconstructor;
        this.inferenceIntervalMs = inferenceIntervalMs;
        this.busy = false;
        this.lastStartedAt = 0;
        this.abort = new AbortController();
        this.generation = 0;
        this.terminal = false;
        this.restartable = false;
        this.lifecycleTask = null;
        this.inferenceTask = null;
        this.latest = null;
        this.diagnostics = {
            modelId: reconstructor.manifest.id,
            modelStatus: "loading",
            inputProfileId: reconstructor.manifest.input.profileId,
            lastInferenceMs: null,
            lastInferenceAtMs: null,
            inputSampleCount: 0,
            skippedInferenceCount: 0,
            fallbackReason: null,
            reconstructionReliability: null,
        };
    }
    async init() {
        if (this.terminal)
            return;
        if (this.lifecycleTask)
            return this.lifecycleTask;
        if (this.restartable) {
            this.abort = new AbortController();
            this.restartable = false;
            this.diagnostics.modelStatus = "loading";
            this.diagnostics.fallbackReason = null;
        }
        if (this.diagnostics.modelStatus !== "loading")
            return;
        const generation = ++this.generation;
        const task = this.initialize(generation);
        this.lifecycleTask = task;
        await task;
        if (this.lifecycleTask === task)
            this.lifecycleTask = null;
    }
    offer(window, nowMs = Date.now()) {
        if (!["ready", "degraded"].includes(this.diagnostics.modelStatus) ||
            this.busy ||
            nowMs - this.lastStartedAt < this.inferenceIntervalMs) {
            this.diagnostics.skippedInferenceCount += 1;
            return false;
        }
        this.busy = true;
        this.lastStartedAt = nowMs;
        this.diagnostics.modelStatus = "running";
        this.diagnostics.inputSampleCount = window.length;
        const task = this.run(window, nowMs, this.generation);
        this.inferenceTask = task;
        void task.finally(() => {
            if (this.inferenceTask === task)
                this.inferenceTask = null;
        });
        return true;
    }
    reportInputUnavailable(reason, inputSampleCount = 0) {
        if (this.terminal || this.busy)
            return;
        this.diagnostics.inputSampleCount = inputSampleCount;
        this.diagnostics.fallbackReason = reason;
        if (this.diagnostics.modelStatus === "ready") {
            this.diagnostics.modelStatus = "degraded";
        }
    }
    getLatest() {
        return this.latest;
    }
    getDiagnostics() {
        return { ...this.diagnostics };
    }
    async stop() {
        await this.shutdown(false);
    }
    async dispose() {
        await this.shutdown(true);
    }
    async initialize(generation) {
        try {
            await this.reconstructor.init(this.abort.signal);
            if (generation !== this.generation || this.terminal)
                return;
            this.diagnostics.modelStatus = "ready";
        }
        catch {
            if (generation !== this.generation || this.terminal)
                return;
            this.diagnostics.modelStatus = "failed";
            this.diagnostics.fallbackReason = "model_init_failed";
        }
    }
    async shutdown(terminal) {
        if (terminal && this.terminal)
            return;
        if (!terminal && this.restartable)
            return;
        if (terminal && this.restartable) {
            this.terminal = true;
            this.restartable = false;
            return;
        }
        this.terminal = this.terminal || terminal;
        this.restartable = !this.terminal;
        this.generation += 1;
        this.abort.abort();
        await Promise.allSettled([this.lifecycleTask, this.inferenceTask].filter((task) => task != null));
        try {
            await this.reconstructor.dispose();
        }
        catch {
            // Model cleanup must not poison the deterministic session lifecycle.
        }
        this.busy = false;
        this.latest = null;
        this.diagnostics.modelStatus = "disposed";
        this.diagnostics.fallbackReason = null;
        this.diagnostics.reconstructionReliability = null;
    }
    async run(window, startedAt, generation) {
        try {
            const latest = await this.reconstructor.reconstruct(window, this.abort.signal);
            if (generation !== this.generation || this.terminal || this.restartable)
                return;
            this.latest = latest;
            this.diagnostics.modelStatus = latest ? "ready" : "degraded";
            this.diagnostics.fallbackReason = latest
                ? null
                : "reconstruction_unavailable";
            this.diagnostics.reconstructionReliability = latest?.reliability ?? null;
        }
        catch (error) {
            if (generation !== this.generation || this.terminal || this.restartable)
                return;
            this.diagnostics.modelStatus = "degraded";
            this.diagnostics.fallbackReason =
                error instanceof WaveformModelError ? error.code : "inference_failed";
        }
        finally {
            if (generation === this.generation &&
                !this.terminal &&
                !this.restartable) {
                this.diagnostics.lastInferenceAtMs = startedAt;
                this.diagnostics.lastInferenceMs = Math.max(0, Date.now() - startedAt);
                this.busy = false;
            }
        }
    }
}
