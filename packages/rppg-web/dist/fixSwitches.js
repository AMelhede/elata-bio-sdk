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
];
/** Switches that stay off unless set to `true` (each one's comment says why). */
export const FIX_SWITCHES_OFF_BY_DEFAULT = [
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
export function resolveFixSwitches(option) {
    const all = option !== false;
    const given = option != null && typeof option === "object" ? option : {};
    const out = {};
    for (const name of FIX_SWITCH_NAMES) {
        const v = given[name];
        out[name] =
            typeof v === "boolean" ? v : all && !FIX_SWITCHES_OFF_BY_DEFAULT.includes(name);
    }
    return out;
}
