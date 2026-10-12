export const FIX_SWITCH_NAMES = [
    "noFaceNoReading",
    "colourProjectionFix",
    "realFrameRate",
    "posFusion",
    "noRateDoubling",
    "steadyAnalysis",
    "rgbPulse",
    "noCalibrationBlend",
    "analysisWidth",
    "analysisWorker",
    "faceFinderTrial",
];
/** Switches that stay off unless set to `true` (each one's comment says why). */
export const FIX_SWITCHES_OFF_BY_DEFAULT = [
    "rgbPulse",
    "noCalibrationBlend",
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
