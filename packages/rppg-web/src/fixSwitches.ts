/**
 * On/off switches for the fixes in this test build. Every fix is ON unless its switch is set
 * to `false` (sparseFaceFinder alone is off unless set to `true`: see it), and every switch set to
 * `false` gives back the published 0.14.0 behaviour for that part, unchanged, so a fix can be compared
 * against the code it replaces in a live app.
 *
 * - `fixes` left out, or `fixes: true`: every fix at its default (all on but sparseFaceFinder).
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
	 * Fix 6. The heart-rate analysis runs at most once per ANALYSIS_EVERY_MS (250 ms) of sample time, and reads
	 * in between are answered from it, so the rate does not depend on how often anything reads it. Off: every
	 * read analyses again, as published, and the rate tracker takes the same window once per read; a managed
	 * session's diagnostics read on every camera frame, so on the main thread the whole analysis ran on every
	 * frame, and the analysis worker read twice per answer.
	 */
	steadyAnalysis?: boolean;
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
	 * Speed 5, OFF unless set to true. The face finder is asked at most once per FACE_FINDER_EVERY_MS
	 * (100 ms); frames in between are read with the last face it found. Off: the finder runs on every
	 * frame, as published. Off by default because on recorded captures it added frames but did not give a
	 * reading on as many of them, which it needed to keep a place as a default.
	 */
	sparseFaceFinder?: boolean;
	/**
	 * Speed 6. With `faceMesh: "auto"`, the face finder is built on every delegate that exists (GPU first,
	 * then CPU), each is timed on the live video for a few calls, and the faster is kept; a finder whose GPU
	 * context dies, or that finds no face for 2 s after the page returns from hidden, is rebuilt
	 * (faceFinderTrial.ts). Off: the CPU delegate only, as published.
	 */
	faceFinderTrial?: boolean;
};

/** Switches that stay off unless set to `true` (each says why). */
export const FIX_SWITCHES_OFF_BY_DEFAULT: readonly (keyof RppgFixSwitches)[] = ["sparseFaceFinder"];

/**
 * `true` or left out: every fix at its default (on, but for FIX_SWITCHES_OFF_BY_DEFAULT). `false`: every fix
 * off. An object: per fix, its default unless set.
 */
export type RppgFixesOption = boolean | RppgFixSwitches;

export type ResolvedRppgFixSwitches = Required<RppgFixSwitches>;

export const FIX_SWITCH_NAMES = [
	"noFaceNoReading",
	"colourProjectionFix",
	"realFrameRate",
	"posFusion",
	"noRateDoubling",
	"steadyAnalysis",
	"analysisWidth",
	"analysisWorker",
	"sparseFaceFinder",
	"faceFinderTrial",
] as const satisfies readonly (keyof RppgFixSwitches)[];

/** Every switch resolved to true or false (see {@link RppgFixesOption}). */
export function resolveFixSwitches(
	option?: RppgFixesOption | null,
): ResolvedRppgFixSwitches {
	const all = option !== false;
	const given: RppgFixSwitches =
		option != null && typeof option === "object" ? option : {};
	const out = {} as ResolvedRppgFixSwitches;
	for (const name of FIX_SWITCH_NAMES) {
		const v = given[name];
		out[name] = typeof v === "boolean" ? v : all && !FIX_SWITCHES_OFF_BY_DEFAULT.includes(name);
	}
	return out;
}
