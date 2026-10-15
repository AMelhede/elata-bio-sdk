/**
 * On/off switches for the fixes in this test build. Every fix is ON unless its switch is set
 * to `false` (rgbPulse alone is off unless set to `true`: see it), and every switch set to `false`
 * gives back the published 0.14.0 behaviour for that part, unchanged, so a fix can be compared
 * against the code it replaces in a live app.
 *
 * - `fixes` left out, or `fixes: true`: every fix at its default (all on but rgbPulse).
 * - `fixes: false`: every fix off (the published behaviour).
 * - `fixes: { posFusion: false }`: that one fix off, the others at their defaults.
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
	 * Fix 3. The multi-region fuser is fed on the evenly spaced sample grid its filters and
	 * weights are designed for (`sampleRate`, 30 a second by default), interpolating between
	 * camera frames, and the processor gets one sample per grid time through whichever push API
	 * it has. Before, a camera that delivered 15 frames a second moved the fuser's pass band to
	 * about 21 to 120 bpm and doubled its warm-up. Gaps over 250 ms are a stall and are not
	 * bridged. Off: each camera frame is pushed as it arrives, as published.
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
	 * Fix 6. The heart-rate analysis runs once per ANALYSIS_EVERY_MS (250 ms) of sample time, as the analysis
	 * worker's answer did (two passes over the same window, the first kept, because this build's rate tracker
	 * is tuned to that), and reads in between are answered from it. Every read pattern then gets the worker's
	 * answers. Off: every read analyses again, as published, and the rate tracker takes the same window once per
	 * read; a managed session's diagnostics read on every camera frame, so on the main thread the whole analysis
	 * ran on every frame.
	 */
	steadyAnalysis?: boolean;
	/**
	 * Fix 7, OFF unless set to true. The processor's own colour path (`pushSampleRgb` and `pushSampleRgbMeta`: an
	 * app that feeds RppgProcessor directly, and the runner whenever the multi-region fuser is off or has no region)
	 * builds the pulse signal its window estimators read with POS and the fuser's 0.7 to 4 Hz band-pass, at the rate
	 * the samples arrive at (RgbPulseExtractor). Off, as published: CHROM with its offset kept, so alpha's wander lands
	 * in the band, and raw green in place of the projection for its first nine samples, a level a thousand times the
	 * pulse that stays in the 45 s window; on a synthetic 72 bpm face the processor's spectral estimate read 42 and its
	 * rate 111. Off by default because, with no pulse at all, the estimators it repairs agree on noise more often, so
	 * the processor shows a rate in more seconds (on synthetic noise at 30 frames a second, 19% published, 72%
	 * with it), though none at a confidence of 0.7 or more in the same test.
	 */
	rgbPulse?: boolean;
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
	 * Speed 6. With `faceMesh: "auto"`, the face finder is built on every delegate that exists (GPU first,
	 * then CPU), each is timed on the live video for a few calls, and the faster is kept; a finder whose GPU
	 * context dies, or that finds no face for 2 s after the page returns from hidden, is rebuilt
	 * (faceFinderTrial.ts). Off: the CPU delegate only, as published.
	 */
	faceFinderTrial?: boolean;
};

/**
 * `true` or left out: every fix at its default (on, but for FIX_SWITCHES_OFF_BY_DEFAULT). `false`: every
 * fix off. An object: per fix, its default unless set.
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
	"rgbPulse",
	"analysisWidth",
	"analysisWorker",
	"faceFinderTrial",
] as const satisfies readonly (keyof RppgFixSwitches)[];

/** Switches that stay off unless set to `true` (each one's comment says why). */
export const FIX_SWITCHES_OFF_BY_DEFAULT: readonly (keyof RppgFixSwitches)[] = [
	"rgbPulse",
	// Off in test.23: none has a measured benefit on recorded captures, and faceFinderTrial was measured as
	// the cause of the slow-CPU regression (0.19 to 0.64 frames analysed a second with it on a heavily slowed
	// processor, 3.93 to 4.26 without). Each comes back on only with its own measurement.
	"realFrameRate",
	"steadyAnalysis",
	"analysisWidth",
	"analysisWorker",
	"faceFinderTrial",
];

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
		out[name] =
			typeof v === "boolean" ? v : all && !FIX_SWITCHES_OFF_BY_DEFAULT.includes(name);
	}
	return out;
}
