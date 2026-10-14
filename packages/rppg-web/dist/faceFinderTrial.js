/** GPU first, CPU as the fallback: the order MediaPipe recommends where a GPU exists. */
export const FINDER_DELEGATE_ORDER = ["GPU", "CPU"];
/**
 * The calls each candidate gets: the first ones pay one-off costs (shader compilation on the GPU, WASM
 * warm-up on the CPU) and are not counted; ten timed calls tell tens of milliseconds from hundreds.
 */
export const FINDER_TRIAL_WARMUP_CALLS = 3;
export const FINDER_TRIAL_TIMED_CALLS = 10;
/**
 * A candidate's trial also ends once its calls after the first have taken this long in total, and its mean so
 * far is its result. The first call is not counted: it pays shader compilation or WASM warm-up. Why: on a
 * heavily throttled device (cgroup CPU limit, 2 cores at 40%) the software GPU took about 3.3 s a call, so the
 * full trial spent about 43 s on it before trying the CPU (about 0.15 s a call), and the face was analysed at
 * 0.3 frames a second for a whole 74 s reading against 3.9 with the trial switched off (bench slowcause,
 * 2026-10-14). 2 s still times every call of a candidate up to about 150 ms a call (12 calls), which covers a
 * laptop CPU at its slowest measured (about 150 ms under the same limit), so only a candidate too slow to win
 * is cut short.
 */
export const FINDER_TRIAL_BUDGET_MS = 2000;
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
/**
 * A rebuild that fails is tried again after this pause, doubling on each failure up to the cap, and every other
 * try builds the other delegate: a context that cannot come back on the GPU is replaced by the CPU instead of
 * being rebuilt on every frame. Building a finder sets up its WASM and model, which takes about a second.
 */
export const FINDER_REBUILD_RETRY_MS = 2000;
export const FINDER_REBUILD_RETRY_MAX_MS = 30000;
/** A finder that throws on this many calls in a row is rebuilt; one stray error is not a dead finder. */
export const FINDER_ERRORS_BEFORE_REBUILD = 3;
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
        this.closed = false;
        this.errorsInRow = 0;
        this.failedRebuilds = 0;
        this.nextRebuildAtMs = Number.NEGATIVE_INFINITY;
        this.stopListening = null;
        if (!candidates.length)
            throw new Error("TrialFaceFinder needs at least one candidate");
        this.candidates = [...candidates];
        this.current = this.candidates[0];
        this.trial = this.candidates.length > 1 ? { index: 0, calls: 0, timed: [], afterFirst: [] } : null;
        this.now = opts.now ?? (() => (typeof performance !== "undefined" ? performance.now() : Date.now()));
        this.rebuild = opts.rebuild;
        this.onEvent = opts.onEvent;
        const page = opts.visibility;
        if (page) {
            const onChange = () => {
                if (page.visibilityState === "visible")
                    this.noteReturn();
            };
            page.addEventListener("visibilitychange", onChange);
            this.stopListening = () => page.removeEventListener("visibilitychange", onChange);
        }
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
        let result;
        try {
            result = this.current.finder.detectForVideo(input, timestampMs);
        }
        catch (error) {
            // A candidate that throws in the trial is dropped from it; after the trial, one that keeps throwing is
            // rebuilt. The error still reaches the caller, as it would without the trial.
            if (this.trial)
                this.finishTrialCandidate(Number.POSITIVE_INFINITY);
            else if (++this.errorsInRow >= FINDER_ERRORS_BEFORE_REBUILD)
                this.maybeRebuild("errors", this.now());
            throw error;
        }
        const t1 = this.now();
        this.errorsInRow = 0;
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
        if (reason)
            this.maybeRebuild(reason, t1);
        return result;
    }
    close() {
        this.closed = true;
        this.stopListening?.();
        this.stopListening = null;
        for (const c of this.candidates)
            c.finder.close?.();
        this.candidates = [this.current];
    }
    noteTrialCall(ms) {
        const trial = this.trial;
        trial.calls += 1;
        if (trial.calls > FINDER_TRIAL_WARMUP_CALLS)
            trial.timed.push(ms);
        if (trial.calls > 1)
            trial.afterFirst.push(ms);
        const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
        if (trial.timed.length >= FINDER_TRIAL_TIMED_CALLS) {
            this.finishTrialCandidate(mean(trial.timed));
            return;
        }
        // Too slow to be kept: stop paying for it (FINDER_TRIAL_BUDGET_MS).
        if (trial.afterFirst.length && trial.afterFirst.reduce((a, b) => a + b, 0) >= FINDER_TRIAL_BUDGET_MS)
            this.finishTrialCandidate(mean(trial.afterFirst));
    }
    /** Records the current candidate's mean call time (infinite: it failed) and moves the trial on. */
    finishTrialCandidate(meanMs) {
        const trial = this.trial;
        this.results.push({ delegate: this.current.delegate, meanMs });
        trial.index += 1;
        trial.calls = 0;
        trial.timed = [];
        trial.afterFirst = [];
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
    maybeRebuild(reason, nowMs) {
        if (this.rebuilding || !this.rebuild || this.closed || nowMs < this.nextRebuildAtMs)
            return;
        this.startRebuild(reason);
    }
    startRebuild(reason) {
        this.rebuilding = true;
        const old = this.current;
        // The same delegate first; after a failure, every other try builds the other one.
        const order = [old.delegate, ...FINDER_DELEGATE_ORDER.filter((d) => d !== old.delegate)];
        const delegate = order[this.failedRebuilds % order.length];
        this.onEvent?.({ type: "face:rebuild", reason, delegate, from: old.delegate });
        const failed = () => {
            this.failedRebuilds += 1;
            this.nextRebuildAtMs =
                this.now() + Math.min(FINDER_REBUILD_RETRY_MAX_MS, FINDER_REBUILD_RETRY_MS * 2 ** (this.failedRebuilds - 1));
        };
        this.rebuild(delegate)
            .then((fresh) => {
            if (!fresh)
                return failed();
            // Closed, or the trial already closed the finder this was to replace: the fresh one is not needed.
            if (this.closed || !this.candidates.includes(old)) {
                fresh.finder.close?.();
                return;
            }
            old.finder.close?.();
            this.candidates = this.candidates.map((c) => (c === old ? fresh : c));
            if (this.current === old) {
                this.current = fresh;
                // A fresh finder pays its own warm-up: in the trial, it starts its count again.
                if (this.trial) {
                    this.trial.calls = 0;
                    this.trial.timed = [];
                    this.trial.afterFirst = [];
                }
            }
            this.failedRebuilds = 0;
            this.nextRebuildAtMs = Number.NEGATIVE_INFINITY;
            this.errorsInRow = 0;
        })
            .catch(failed)
            .finally(() => {
            this.rebuilding = false;
            this.returnedAtMs = null;
        });
    }
}
