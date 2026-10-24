import { RppgGatingController, } from "./rppgGating.js";
import { normalizeRppgError, } from "./rppgErrors.js";
import { AffectTracker } from "./affectTracker.js";
import { faceFramingFromBox, } from "./faceFraming.js";
const DEFAULT_MAX_TRACE_POINTS = 120;
const DEFAULT_APP_MONITOR_INTERVAL_MS = 500;
// A face box older than this is treated as "no face": detection runs per frame,
// so once the face leaves, landmarks stop and the last box must not linger.
const FACE_BOX_STALE_MS = 600;
function isManagedState(state) {
    return "retryCount" in state;
}
function idleGating(message) {
    return {
        state: "idle",
        guidance: {
            code: "idle",
            message,
        },
        publishBpm: null,
        holding: false,
        debug: {
            reasons: [],
            motionHoldUntilMs: null,
            lastStableBpm: null,
            lastStableAtMs: null,
        },
    };
}
function inferHasFace(diagnostics) {
    if (!diagnostics)
        return undefined;
    if (diagnostics.lastRoiSource === "face_roi" ||
        diagnostics.lastRoiSource === "multi_roi") {
        return true;
    }
    return undefined;
}
function deriveStatus(managedState, sessionState, error, gating) {
    switch (managedState?.status) {
        case "idle":
            return "idle";
        case "starting":
            return "starting";
        case "retrying":
            return "retrying";
        case "stopped":
            return "stopped";
        case "failed":
            return "failed";
        default:
            break;
    }
    if (error?.terminal || sessionState?.status === "failed") {
        return "failed";
    }
    if (error || sessionState?.status === "degraded") {
        return "degraded";
    }
    if (gating.publishBpm != null && gating.state === "active") {
        return "ready";
    }
    return "running";
}
function buildRetryMessage(nextRetryAtMs, nowMs) {
    if (nextRetryAtMs == null)
        return "Retrying after a processor failure";
    const remainingMs = Math.max(0, nextRetryAtMs - nowMs);
    const remainingSec = Math.max(1, Math.ceil(remainingMs / 1000));
    return `Retrying after a processor failure in ${remainingSec}s`;
}
function deriveGuidance(status, gating, error, managedState, diagnostics, nowMs) {
    if (error && status !== "retrying") {
        return {
            code: error.code,
            message: error.guidance,
        };
    }
    switch (status) {
        case "idle":
            return { code: "idle", message: "Ready to start monitoring" };
        case "starting":
            return {
                code: "starting",
                message: "Initializing camera and rPPG pipeline",
            };
        case "retrying":
            return {
                code: "retrying",
                message: buildRetryMessage(managedState?.nextRetryAtMs ?? null, nowMs),
            };
        case "stopped":
            return { code: "stopped", message: "Monitoring stopped" };
        case "degraded":
            if (diagnostics?.state.reason === "backend_unavailable") {
                return {
                    code: "backend_unavailable",
                    message: "Running without the estimation backend. Check your WASM asset configuration.",
                };
            }
            return {
                code: gating.guidance.code,
                message: gating.guidance.message,
            };
        default:
            return {
                code: gating.guidance.code,
                message: gating.guidance.message,
            };
    }
}
export class RppgAppAdapter {
    constructor(options = {}) {
        this.gating = new RppgGatingController(options.gating);
        this.nowMsValue = options.nowMs ?? (() => Date.now());
        this.maxTracePointsValue =
            options.maxTracePoints ?? DEFAULT_MAX_TRACE_POINTS;
        this.affectTracker =
            options.affect === false ? null : new AffectTracker(options.affect ?? {});
    }
    reset() {
        this.gating.reset();
        this.affectTracker?.reset();
    }
    getSnapshot(source) {
        const nowMs = this.nowMsValue();
        const metrics = source.getMetrics();
        const diagnostics = source.getDiagnostics();
        const trace = source.getTraceSnapshot(this.maxTracePointsValue);
        const normalizedError = normalizeRppgError(source.lastError, diagnostics ?? undefined);
        const managedState = isManagedState(source.state) ? source.state : null;
        let sessionState = diagnostics?.state ?? null;
        if (sessionState == null && !isManagedState(source.state)) {
            sessionState = source.state;
        }
        const activeCapture = managedState == null || managedState.status === "running";
        // Resolve the tracked head box: `undefined` when the source can't report
        // one (no face tracking), `null` when it can but the face is gone/stale,
        // else the fresh box. Drives both gating's face presence and positioning.
        const faceBoxEntry = source.getLastFaceBox?.();
        const faceBox = faceBoxEntry === undefined
            ? undefined
            : faceBoxEntry && nowMs - faceBoxEntry.atMs <= FACE_BOX_STALE_MS
                ? faceBoxEntry.box
                : null;
        let gating;
        if (activeCapture) {
            gating = this.gating.update({
                nowMs,
                metrics,
                hasFace: faceBox === undefined ? inferHasFace(diagnostics) : undefined,
                faceBox,
            });
        }
        else {
            this.gating.reset();
            gating = idleGating("Monitoring paused");
        }
        const framing = faceBox === undefined ? null : faceFramingFromBox(faceBox);
        const status = deriveStatus(managedState, sessionState, normalizedError, gating);
        const guidance = deriveGuidance(status, gating, normalizedError, managedState, diagnostics, nowMs);
        const ready = status === "ready";
        const canPublish = ready && gating.publishBpm != null;
        // Affect: feed the face (blendshapes) + physiology (HR/HRV), then fuse.
        // Physiology confidence comes from the metric confidence; face confidence
        // from whether a face is currently tracked.
        let affect = null;
        if (this.affectTracker && activeCapture) {
            const face = source.getLastBlendshapes?.() ?? null;
            if (face)
                this.affectTracker.observeFace(face.blendshapes, face.atMs);
            this.affectTracker.observePhysiology(metrics.bpm ?? null, metrics.hrv_rmssd ?? null);
            affect = this.affectTracker.compute({
                bpm: metrics.bpm ?? null,
                rmssd: metrics.hrv_rmssd ?? null,
                physioConfidence: metrics.confidence ?? 0,
                faceConfidence: inferHasFace(diagnostics) ? 1 : 0,
                nowMs,
            });
        }
        return {
            status,
            ready,
            canPublish,
            publishBpm: canPublish ? gating.publishBpm : null,
            message: guidance.message,
            guidance,
            metrics,
            affect,
            faceBox: faceBox ?? null,
            framing,
            diagnostics,
            trace,
            normalizedError,
            sessionState,
            managedState,
            gating,
            debug: {
                backendMode: diagnostics?.backendMode ?? null,
                faceTrackingMode: diagnostics?.faceTrackingMode ?? null,
                issues: diagnostics?.issues ?? [],
                processorFailure: diagnostics?.processorFailure ?? null,
                retryCount: managedState?.retryCount ?? 0,
                nextRetryAtMs: managedState?.nextRetryAtMs ?? null,
                totalSamplesReceived: diagnostics?.totalSamplesReceived ?? 0,
                windowSampleCount: diagnostics?.windowSampleCount ?? 0,
                estimationAvailable: diagnostics?.estimationAvailable ?? false,
                gatingState: gating.state,
                gatingReasons: gating.debug.reasons,
            },
        };
    }
}
export function createRppgAppAdapter(options = {}) {
    return new RppgAppAdapter(options);
}
export class RppgAppMonitor {
    constructor(source, options = {}, internals = {}) {
        this.source = source;
        this.listeners = new Set();
        this.timer = null;
        this.adapter = new RppgAppAdapter(options);
        this.intervalMs = options.intervalMs ?? DEFAULT_APP_MONITOR_INTERVAL_MS;
        this.emitImmediately = options.emitImmediately !== false;
        this.setIntervalFn = internals.setIntervalFn ?? setInterval;
        this.clearIntervalFn = internals.clearIntervalFn ?? clearInterval;
    }
    getSnapshot() {
        return this.adapter.getSnapshot(this.source);
    }
    subscribe(listener) {
        this.listeners.add(listener);
        if (this.emitImmediately) {
            listener(this.getSnapshot());
        }
        return () => {
            this.listeners.delete(listener);
        };
    }
    start() {
        if (this.timer)
            return;
        // Called as a plain function, not as `this.setIntervalFn(...)`: a browser's own timers throw
        // "Illegal invocation" when called as a method of any object but the window.
        const setIntervalFn = this.setIntervalFn;
        this.timer = setIntervalFn(() => {
            this.emit();
        }, this.intervalMs);
    }
    stop() {
        if (!this.timer)
            return;
        const clearIntervalFn = this.clearIntervalFn;
        clearIntervalFn(this.timer);
        this.timer = null;
    }
    emit() {
        const snapshot = this.getSnapshot();
        for (const listener of this.listeners) {
            listener(snapshot);
        }
        return snapshot;
    }
    dispose() {
        this.stop();
        this.listeners.clear();
    }
}
export function createRppgAppMonitor(source, options = {}) {
    return new RppgAppMonitor(source, options);
}
