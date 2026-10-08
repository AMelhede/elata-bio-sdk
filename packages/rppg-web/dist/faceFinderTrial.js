/** GPU first, CPU as the fallback: the order MediaPipe recommends where a GPU exists. */
export const FINDER_DELEGATE_ORDER = ["GPU", "CPU"];
/**
 * The calls each candidate gets: the first ones pay one-off costs (shader compilation on the GPU, WASM
 * warm-up on the CPU) and are not counted; ten timed calls tell tens of milliseconds from hundreds.
 */
export const FINDER_TRIAL_WARMUP_CALLS = 3;
export const FINDER_TRIAL_TIMED_CALLS = 10;
/**
 * How much faster a later candidate must be to displace an earlier one. CPU inference runs on the page's
 * own main thread and competes with every camera frame while the GPU mostly waits, so a CPU that wins a
 * short trial narrowly can still run slower live, with longer stalls; a lead inside 25% is not worth that.
 */
export const FINDER_SWITCH_MARGIN = 0.25;
/**
 * After a return from a hidden page, how long without a face before the finder is rebuilt: a dead finder
 * stays dark, while a live one finds a face in its first few calls.
 */
export const NO_FACE_AFTER_RETURN_MS = 2000;
/** The fastest candidate by mean call time; an earlier one keeps its place unless clearly beaten. */
export function pickFastest(trials) {
    let best = null;
    for (const t of trials) {
        if (!Number.isFinite(t.meanMs))
            continue;
        if (best == null || t.meanMs < best.meanMs * (1 - FINDER_SWITCH_MARGIN))
            best = t;
    }
    return best;
}
/** Whether to throw the finder away and build a fresh one, and why. */
export function faceRebuildReason(args) {
    if (args.contextLost)
        return "context-lost";
    if (args.returnedAtMs != null &&
        args.lastFaceAtMs < args.returnedAtMs &&
        args.nowMs - args.returnedAtMs >= NO_FACE_AFTER_RETURN_MS)
        return "no-face-after-return";
    return null;
}
export class TrialFaceFinder {
    constructor(candidates, opts = {}) {
        this.results = [];
        this.lastFaceAtMs = Number.NEGATIVE_INFINITY;
        this.returnedAtMs = null;
        this.rebuilding = false;
        if (!candidates.length)
            throw new Error("TrialFaceFinder needs at least one candidate");
        this.candidates = [...candidates];
        this.current = this.candidates[0];
        this.trial = this.candidates.length > 1 ? { index: 0, calls: 0, timed: [] } : null;
        this.now = opts.now ?? (() => (typeof performance !== "undefined" ? performance.now() : Date.now()));
        this.rebuild = opts.rebuild;
        this.onEvent = opts.onEvent;
    }
    /** The delegate answering now. */
    get delegate() {
        return this.current.delegate;
    }
    /** Each tried delegate's mean call time, in the order tried. */
    get trialResults() {
        return this.results;
    }
    /** The page became visible again after being hidden (see NO_FACE_AFTER_RETURN_MS). */
    noteReturn(atMs = this.now()) {
        this.returnedAtMs = atMs;
    }
    detectForVideo(input, timestampMs) {
        const t0 = this.now();
        const result = this.current.finder.detectForVideo(input, timestampMs);
        const t1 = this.now();
        if (result?.faceLandmarks?.length)
            this.lastFaceAtMs = t1;
        if (this.trial)
            this.noteTrialCall(t1 - t0);
        const reason = faceRebuildReason({
            contextLost: this.current.isLost?.() ?? false,
            returnedAtMs: this.returnedAtMs,
            lastFaceAtMs: this.lastFaceAtMs,
            nowMs: t1,
        });
        if (reason && !this.rebuilding && this.rebuild)
            this.startRebuild(reason);
        return result;
    }
    close() {
        for (const c of this.candidates)
            c.finder.close?.();
        this.candidates = [this.current];
    }
    noteTrialCall(ms) {
        const trial = this.trial;
        trial.calls += 1;
        if (trial.calls > FINDER_TRIAL_WARMUP_CALLS)
            trial.timed.push(ms);
        if (trial.timed.length < FINDER_TRIAL_TIMED_CALLS)
            return;
        this.results.push({
            delegate: this.current.delegate,
            meanMs: trial.timed.reduce((a, b) => a + b, 0) / trial.timed.length,
        });
        trial.index += 1;
        trial.calls = 0;
        trial.timed = [];
        if (trial.index < this.candidates.length) {
            this.current = this.candidates[trial.index];
            return;
        }
        const winner = pickFastest(this.results);
        const keep = this.candidates.find((c) => c.delegate === winner?.delegate) ?? this.candidates[0];
        for (const c of this.candidates)
            if (c !== keep)
                c.finder.close?.();
        this.candidates = [keep];
        this.current = keep;
        this.trial = null;
        this.onEvent?.({ type: "face:delegate", chosen: keep.delegate, results: [...this.results] });
    }
    startRebuild(reason) {
        this.rebuilding = true;
        const old = this.current;
        this.onEvent?.({ type: "face:rebuild", reason, delegate: old.delegate });
        this.rebuild(old.delegate)
            .then((fresh) => {
            if (!fresh)
                return;
            old.finder.close?.();
            this.candidates = this.candidates.map((c) => (c === old ? fresh : c));
            if (this.current === old)
                this.current = fresh;
        })
            .catch(() => undefined)
            .finally(() => {
            this.rebuilding = false;
            this.returnedAtMs = null;
        });
    }
}
