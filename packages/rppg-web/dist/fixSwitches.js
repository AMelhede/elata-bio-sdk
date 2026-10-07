export const FIX_SWITCH_NAMES = [
    "noFaceNoReading",
    "colourProjectionFix",
    "realFrameRate",
    "posFusion",
    "noRateDoubling",
    "analysisWidth",
    "analysisWorker",
];
/** Every switch resolved to true or false (see {@link RppgFixesOption}). */
export function resolveFixSwitches(option) {
    const all = option !== false;
    const given = option != null && typeof option === "object" ? option : {};
    const out = {};
    for (const name of FIX_SWITCH_NAMES) {
        const v = given[name];
        out[name] = typeof v === "boolean" ? v : all;
    }
    return out;
}
