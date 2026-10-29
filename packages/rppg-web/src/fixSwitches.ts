/**
 * On/off switches for the fixes in this test build. Every fix is ON unless its switch is set
 * to `false`, and every switch set to `false`
 * gives back the published 0.14.0 behaviour for that part, unchanged, so a fix can be compared
 * against the code it replaces in a live app.
 *
 * - `fixes` left out, or `fixes: true`: every fix on.
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
	 * Fix 3. The multi-region fuser projects each region with POS (Wang et al. 2017), the
	 * method built for its short (about 1.6 s) windows. Off: CHROM, as published. An explicit
	 * `fusionProjection` option, when given, wins over this switch.
	 */
	posFusion?: boolean;
	/**
	 * Fix 4. The spectral estimator keeps the strongest rate. Off: the published rule, which
	 * replaces the strongest rate below 85 bpm with twice that rate whenever the line at twice
	 * the rate holds over 35% of its strength (a pulse wave's own second harmonic often does).
	 */
	noRateDoubling?: boolean;
	/**
	 * Fix 5, speed. Frames are read at most 640 wide (same aspect), and the face finder reads that
	 * same image, so landmarks and pixels come from one frame. Off: the full camera frame, and
	 * the face finder reads the live video, as published.
	 */
	analysisWidth?: boolean;
	/**
	 * Fix 6. A break in the frames is not read across. While the session runs and no frame has
	 * arrived for over FRAME_GAP_MS of wall-clock time (a frozen camera driver, an ended track, a
	 * hidden tab, a locked screen, or a camera whose first frame has not come yet), `getMetrics()`
	 * reports no reading (reason `no_frames`) and `getExperimentalVitals()` no HRV;
	 * `getDebugSnapshot()` and `getPulseCheck()` stay raw. When the frames' own clock jumps by more
	 * than FRAME_GAP_MS either way (frames that stopped, a stop and start, a looping video), the
	 * analysis starts afresh; a frame older than the latest by less than that is out of order and is
	 * dropped (drop reason `out_of_order`). Off: the published behaviour, which keeps reporting the
	 * last number while no frames arrive, and reads one window across the break once they do (66
	 * read as 51 for 35 s after a 10 s freeze).
	 */
	noFramesNoReading?: boolean;
	/**
	 * Fix 7, speed. The face finder, most of a frame's cost, runs on every other frame; the frame between reuses its
	 * landmarks (never when the last frame found no face, nor when they are over 100 ms old), and every frame's pixels
	 * are still read. On testers' laptops and phones the camera gave 30 frames a second but only a median 16 and 12.5
	 * were analysed, because each frame waited for the finder; replaying recorded captures at half the frames cost
	 * about a fifth of the right numbers. Blink scores come only from frames the finder ran on. Off: the finder on every
	 * frame, as published.
	 */
	landmarkEveryOther?: boolean;
};

/**
 * `true` or left out: every fix on. `false`: every fix off. An object: per fix, on unless set to false.
 */
export type RppgFixesOption = boolean | RppgFixSwitches;

export type ResolvedRppgFixSwitches = Required<RppgFixSwitches>;

export const FIX_SWITCH_NAMES = [
	"noFaceNoReading",
	"colourProjectionFix",
	"posFusion",
	"noRateDoubling",
	"analysisWidth",
	"noFramesNoReading",
	"landmarkEveryOther",
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
		out[name] = typeof v === "boolean" ? v : all;
	}
	return out;
}
