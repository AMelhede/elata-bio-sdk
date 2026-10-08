/**
 * On/off switches for the fixes in this test build. Every fix is ON unless its switch is set
 * to `false`, and every switch set to `false` gives back the published 0.14.0 behaviour for
 * that part, unchanged, so a fix can be compared against the code it replaces in a live app.
 *
 * - `fixes` left out, or `fixes: true`: every fix on.
 * - `fixes: false`: every fix off (the published behaviour).
 * - `fixes: { posFusion: false }`: that one fix off, the others on.
 */
export type RppgFixSwitches = {
    /**
     * Fix 1. With face tracking on, a frame with no face is dropped (drop reason `no_face`), and
     * after one second with no face the session reports no heart rate, HRV or breathing; the
     * multi-region fuser starts afresh when the face returns. Off: the published behaviour, which reads a
     * 100x100 square in the middle of the frame when no face is found and keeps reporting a
     * heart rate from whatever is there (a wall, a chair).
     */
    noFaceNoReading?: boolean;
    /**
     * Fix 2, inside the WASM core. The colour projection subtracts alpha*Y as CHROM
     * (de Haan and Jeanne 2013) does, and already-extracted samples (R = G = B) pass through
     * unprojected. Off: the published projection, which adds alpha*Y, so a lamp's brightness
     * flicker passes and the pulse colour cancels. This path runs when the multi-region fuser is
     * off and in the first frames before the fuser has enough data.
     */
    colourProjectionFix?: boolean;
    /**
     * Fix 3. The multi-region fuser and the processor are fed on the evenly spaced sample grid
     * they assume (`sampleRate`, 30 a second by default), interpolating between camera frames,
     * so a camera that delivers fewer frames does not scale every rate. Gaps over 250 ms are a
     * stall and are not bridged. Off: each camera frame is pushed as it arrives, as published.
     */
    realFrameRate?: boolean;
    /**
     * Fix 4. The multi-region fuser projects each region with POS (Wang et al. 2017), the
     * method built for its short (about 1.6 s) windows. Off: CHROM, as published. An explicit
     * `fusionProjection` option, when given, wins over this switch.
     */
    posFusion?: boolean;
    /**
     * Fix 5. The spectral estimator keeps the strongest rate. Off: the published rule, which
     * replaces the strongest rate below 85 bpm with twice that rate whenever the line at twice
     * the rate holds over 35% of its strength (a pulse wave's own second harmonic often does).
     */
    noRateDoubling?: boolean;
    /**
     * Speed 2. Frames are read at most 640 wide (same aspect), and the face finder reads that
     * same image, so landmarks and pixels come from one frame. Off: the full camera frame, and
     * the face finder reads the live video, as published.
     */
    analysisWidth?: boolean;
    /**
     * Speed 4. The heart-rate analysis runs in a Web Worker so it never blocks camera frames,
     * falling back to the main thread when a worker or the WASM core in it cannot start. Off:
     * the analysis runs on the main thread, as published. The session option `analysisWorker`,
     * when given, wins over this switch.
     */
    analysisWorker?: boolean;
    /**
     * Speed 5. The face finder is asked at most once per FACE_FINDER_EVERY_MS (100 ms); frames in
     * between are read with the last face it found. Off: the finder runs on every frame, as published.
     */
    sparseFaceFinder?: boolean;
};
/** `true` or left out: every fix on. `false`: every fix off. An object: per fix, on unless `false`. */
export type RppgFixesOption = boolean | RppgFixSwitches;
export type ResolvedRppgFixSwitches = Required<RppgFixSwitches>;
export declare const FIX_SWITCH_NAMES: readonly ["noFaceNoReading", "colourProjectionFix", "realFrameRate", "posFusion", "noRateDoubling", "analysisWidth", "analysisWorker", "sparseFaceFinder"];
/** Every switch resolved to true or false (see {@link RppgFixesOption}). */
export declare function resolveFixSwitches(option?: RppgFixesOption | null): ResolvedRppgFixSwitches;
//# sourceMappingURL=fixSwitches.d.ts.map