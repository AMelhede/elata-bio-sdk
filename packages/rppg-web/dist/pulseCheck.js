import { sortedLandmarkAxes } from "./landmarkStats.js";
/**
 * Real-pulse check (`createRppgSession({ pulseCheck })`, ON by default in this test build;
 * `pulseCheck: false` turns it off).
 *
 * Why: the heart rate is the strongest rhythm in the colour signal, and there is always a
 * strongest rhythm, including when no pulse is visible (noise, light, motion). Nothing in
 * the pipeline asks whether the rhythm is a pulse, so a number is reported either way.
 *
 * What this does: it keeps the mean skin colour of the three face regions the SDK already
 * samples (forehead, left cheek, right cheek) and, once a second, runs the checker in
 * pulseCheckCore.ts. A pulse counts as proven only when the regions agree on the same rate
 * across 8 consecutive windows with the line clearly above the noise. Noise does not agree
 * across separate patches of skin for that long; a heartbeat does. While proven, the
 * session reports the rate the check measured; otherwise it reports no rate.
 *
 * Wall check (used when the frames carry face landmarks): a heartbeat is only in skin, a light
 * that pulses changes the wall as well. If the wall's brightness pulses at the proven rate, far
 * above its noise, in each of the last 4 one-second windows, the rate is withheld. Only wall
 * pixels that do not look like skin are used: a face edge or an ear in the patch carries the
 * person's own pulse.
 */
import { averageRgbInROINonSkin } from "./frameSource.js";
import { OWN_PULSE_AGREE_BPM, OWN_PULSE_BAND_HZ, OWN_PULSE_DETREND_S, OWN_PULSE_FS, OWN_PULSE_COLOUR_SWITCH, OWN_PULSE_STRONG_STREAK, OWN_PULSE_SWAP_MIN_WALL_TO_FACE, OWN_PULSE_WINDOW_S, detrend, estimateOwnPulse, agreementRate, AGREE_SECONDS, ownPulseVerdict, peakOfSpectrum, resample, spectrum, } from "./pulseCheckCore.js";
/**
 * Flicker on the face itself, for when no wall can be seen. A heartbeat changes the skin's
 * COLOUR (green dips most); a lamp changes its BRIGHTNESS, scaling red, green and blue alike.
 * So at the proven rate, each region's relative colour is split into brightness (the part
 * common to all three channels) and colour (the rest), and the pooled brightness / colour
 * amplitude ratio is judged. A blood-volume pulse keeps it near 3 (de Haan & van Leest 2014,
 * the PBV signature), as in the achromatic lighting test of Elata's perception lab. Withheld when the ratio exceeds this in each of the last
 * OWN_PULSE_STRONG_STREAK one-second windows, judged at once like the wall check.
 *
 * Value chosen by measurement on recorded captures against a reference pulse.
 */
export const FACE_FLICKER_RATIO = 10;
/**
 * Following a proven rate. The windows that prove a rate span 16 s, so while the heart rate
 * moves the proven rate trails it. Once proven, the shown rate is the line in the newest 12 s
 * if it is within 4 bpm of the proven rate.
 *
 * Value chosen by measurement on recorded captures against a reference pulse.
 */
export const OWN_PULSE_TRACK_S = 12;
/**
 * A number on screen must be backed by fresh evidence. The proven rate is an average over 8+ windows
 * of 16 s, so it describes the last ~20 s; when the heart rate moves fast (after exercise, 72 -> 90 in
 * 10 s) the pulse drops out of every short window while the 16 s window, mostly old data, still reports
 * the old rate. So the rate shown follows the newest OWN_PULSE_SUPPORT_S seconds (replacing the 12 s
 * OWN_PULSE_TRACK_S window), and after OWN_PULSE_SUPPORT_MISS evaluations without it nothing is shown.
 *
 * Value chosen by measurement on recorded captures against a reference pulse.
 */
export const OWN_PULSE_SUPPORT_S = 8;
export const OWN_PULSE_SUPPORT_MISS = 3;
export const OWN_PULSE_TRACK_BPM = 4;
/** Brightness / colour amplitude ratio of the face regions within 0.1 Hz of `bpm`. */
export function faceFlickerRatio(samples, atMs, bpm) {
    const win = samples.filter((s) => s[0] > atMs - OWN_PULSE_WINDOW_S * 1000 && s[0] <= atMs);
    if (win.length < WALL_MIN_SAMPLES)
        return null;
    const t = win.map((s) => s[0] / 1000);
    const f0 = bpm / 60;
    let bright = 0;
    let colour = 0;
    for (let ri = 0; ri < 3; ri++) {
        const ch = [1, 2, 3].map((c) => {
            const x = resample(t, win.map((s) => s[c + ri * 3]), t[0], t[t.length - 1]);
            const m = x.reduce((a, v) => a + v, 0) / x.length || 1;
            const d = detrend(x.map((v) => v / m - 1), OWN_PULSE_DETREND_S);
            const n = d.length;
            return d.map((v, k) => v * (0.5 - 0.5 * Math.cos((2 * Math.PI * k) / (n - 1))));
        });
        const n = ch[0].length;
        for (let f = f0 - 0.1; f <= f0 + 0.1 + 1e-9; f += 0.05) {
            const re = [0, 0, 0];
            const im = [0, 0, 0];
            for (let k = 0; k < n; k++) {
                const a = (2 * Math.PI * f * k) / OWN_PULSE_FS;
                const c = Math.cos(a);
                const sn = Math.sin(a);
                for (let j = 0; j < 3; j++) {
                    re[j] += ch[j][k] * c;
                    im[j] += ch[j][k] * sn;
                }
            }
            const sr = re[0] + re[1] + re[2];
            const si = im[0] + im[1] + im[2];
            const iPow = (sr * sr + si * si) / 3;
            const total = re.reduce((a, v, j) => a + v * v + im[j] * im[j], 0);
            bright += iPow;
            colour += Math.max(0, total - iPow);
        }
    }
    return colour > 0 ? Math.sqrt(bright / colour) : Number.POSITIVE_INFINITY;
}
/** Minimum wall frames in a window before it is judged (3 s at 20 fps). */
const WALL_MIN_SAMPLES = 60;
/**
 * How far above its own noise (dB) the wall's brightness line must stand at the proven rate for
 * the rate to be withheld.
 *
 * Value chosen by measurement on recorded captures against a reference pulse.
 */
const WALL_MIN_SNR_DB = 12;
export const PULSE_CHECK_RULE_NAMES = ["wallBandEdge", "lightFamily", "faceFlicker", "lightTaint", "headMotion", "darkWall"];
/** Every rule resolved to true or false; left out means on. */
export function resolvePulseCheckRules(rules) {
    return {
        wallBandEdge: rules?.wallBandEdge !== false,
        lightFamily: rules?.lightFamily !== false,
        faceFlicker: rules?.faceFlicker !== false,
        lightTaint: rules?.lightTaint !== false,
        headMotion: rules?.headMotion !== false,
        darkWall: rules?.darkWall !== false,
    };
}
/**
 * Face-mesh landmarks on bone, not on skin that moves with expression: nose bridge and tip, forehead,
 * chin, outer eye corners, cheekbones (MediaPipe face mesh indices).
 */
export const HEAD_LANDMARKS = [168, 6, 4, 10, 152, 33, 263, 234, 454];
/** The cheekbones (MediaPipe face mesh 234 and 454): their distance is the face's width. */
const CHEEKBONES = [234, 454];
/**
 * The head's position this frame: the centre of HEAD_LANDMARKS in pixels, and the face's width
 * (cheekbone to cheekbone, in pixels), or null if the mesh lacks a landmark or the frame has no size.
 */
export function headCentre(points, width, height) {
    if (points.length <= Math.max(...HEAD_LANDMARKS) || width <= 0 || height <= 0)
        return null;
    let x = 0;
    let y = 0;
    for (const i of HEAD_LANDMARKS) {
        x += points[i].x * width;
        y += points[i].y * height;
    }
    const [l, r] = CHEEKBONES.map((i) => points[i]);
    return {
        x: x / HEAD_LANDMARKS.length,
        y: y / HEAD_LANDMARKS.length,
        faceWidth: Math.hypot((r.x - l.x) * width, (r.y - l.y) * height),
    };
}
/**
 * How far the head's movement AT THE RATE must stand above the rest of its movement (dB), with the
 * strongest other rhythm taken out of the rest, for the rate to count as the movement's. Set
 * together with HEAD_MIN_SIZE, between still heads with a pulse and generated faces with no pulse
 * nodding, with and without a second sway. The 5 dB it replaced was set on the statistic before
 * (the strongest line against every other rhythm, which a second sway could hide a nod under).
 * Pinned in pulseCheckHead.test.ts.
 *
 * Value chosen by measurement on recorded captures against a reference pulse.
 */
export const HEAD_MIN_SNR_DB = 3.9;
/**
 * The smallest movement at the rate that can be a nod: the line's amplitude over the face's width.
 * A heartbeat shakes the head too, and in a still person that shake can be the head's strongest
 * rhythm, but it is tiny next to a nod. A clean 3 px nod on a 190 px face is 1.6% of its width.
 *
 * Value chosen by measurement on recorded captures against a reference pulse.
 */
export const HEAD_MIN_SIZE = 0.003;
/** A window is judged only where the head's rows cover it as the colour must (estimateOwnPulse): ends within 1 s. */
const HEAD_EDGE_MS = 1000;
/**
 * And no gap inside it longer than the colour tolerates at its edges (1 s, as estimateOwnPulse).
 *
 * Value chosen by measurement on recorded captures against a reference pulse, with rows cut out.
 */
const HEAD_MAX_GAP_MS = 1000;
/** Fewest head rows a window needs to be judged: 2.5 a second over the 16 s window (a face mesh runs at roughly 10 to 30). */
const HEAD_MIN_ROWS = 40;
/**
 * Fewest head rows per cycle of the rate being judged. A nod sampled near twice a cycle is flattened
 * by the interpolation and reads as no movement at all: no-pulse nods with their rows thinned to 2.4
 * to 4 a second read as pulses with no floor and with a floor of 2 rows a cycle, and never with 2.5.
 */
const HEAD_MIN_ROWS_PER_CYCLE = 2.5;
/** Points on the fixed grid: 16 s at 20 Hz, so the bins are 0.0625 Hz whatever span the rows have. */
const HEAD_GRID_N = OWN_PULSE_WINDOW_S * OWN_PULSE_FS;
/** The rows of the 16 s window ending at `atMs` that are usable, or why they do not cover it. */
function headCoverage(head, atMs) {
    const start = atMs - OWN_PULSE_WINDOW_S * 1000;
    const win = head.filter((h) => h[0] >= start &&
        h[0] <= atMs &&
        Number.isFinite(h[1]) &&
        Number.isFinite(h[2]) &&
        Number.isFinite(h[3]) &&
        h[3] > 0);
    if (win.length < HEAD_MIN_ROWS)
        return { blind: "rows" };
    if (win[0][0] - start > HEAD_EDGE_MS)
        return { blind: "start" };
    if (atMs - win[win.length - 1][0] > HEAD_EDGE_MS)
        return { blind: "end" };
    for (let i = 1; i < win.length; i++)
        if (win[i][0] - win[i - 1][0] > HEAD_MAX_GAP_MS)
            return { blind: "gap" };
    return { rows: win };
}
/** Linear interpolation onto exactly HEAD_GRID_N points from `fromS`, held flat past either end. */
function onHeadGrid(t, v, fromS) {
    const out = [];
    let j = 0;
    for (let k = 0; k < HEAD_GRID_N; k++) {
        const g = fromS + k / OWN_PULSE_FS;
        while (j < t.length - 2 && t[j + 1] < g)
            j++;
        const span = t[j + 1] - t[j] || 1;
        const a = Math.min(1, Math.max(0, (g - t[j]) / span));
        out.push(v[j] + a * (v[j + 1] - v[j]));
    }
    return out;
}
/** One axis's movement at `bpm` from its spectrum, or null when the axis has no line there. */
function axisAtRate(P, bpm, faceWidth) {
    const [lo, hi] = OWN_PULSE_BAND_HZ;
    const step = P[1][0] - P[0][0];
    const idx = (hz) => Math.round((hz - P[0][0]) / step);
    let k = -1;
    for (let i = 0; i < P.length; i++) {
        const f = P[i][0];
        if (f < lo || f > hi || Math.abs(f * 60 - bpm) > OWN_PULSE_AGREE_BPM)
            continue;
        if (k < 0 || P[i][1] > P[k][1])
            k = i;
    }
    if (k < 0)
        return null;
    // A line is a local maximum. The largest bin near the rate with a larger bin beside it is the
    // skirt of a line elsewhere, most often slower movement running into the band floor.
    const isPeak = (i) => !(P[i - 1]?.[1] >= P[i][1]) && !(P[i + 1]?.[1] >= P[i][1]);
    if (!isPeak(k))
        return null;
    // A line's power is its Hann main lobe (the bin and one either side) plus its second harmonic's.
    const lineOf = (c) => {
        const h = idx(2 * P[c][0]);
        return [c - 1, c, c + 1, h - 1, h, h + 1];
    };
    const inRange = (i) => i >= 0 && i < P.length && P[i][0] >= lo;
    const line = new Set(lineOf(k).filter(inRange));
    // The strongest other rhythm (a sway beside a nod) is not the rest of the head's movement.
    let other = -1;
    for (let i = 0; i < P.length; i++) {
        if (!inRange(i) || line.has(i) || !isPeak(i))
            continue;
        if (other < 0 || P[i][1] > P[other][1])
            other = i;
    }
    const dropped = new Set(other < 0 ? [] : lineOf(other).filter(inRange));
    let sig = 0;
    let rest = 0;
    for (let i = 0; i < P.length; i++) {
        if (!inRange(i))
            continue;
        if (line.has(i))
            sig += P[i][1];
        else if (!dropped.has(i))
            rest += P[i][1];
    }
    // Amplitude of a sine from its main lobe: a Hann-windowed sine of amplitude A puts (A N / 4)^2 in
    // its bin and a quarter of that in each neighbour, 1.5 (A N / 4)^2 in all.
    const lobe = [k - 1, k, k + 1].filter((i) => i >= 0 && i < P.length).reduce((s, i) => s + P[i][1], 0);
    const amplitude = (4 * Math.sqrt(lobe / 1.5)) / HEAD_GRID_N;
    return { snrDb: 10 * Math.log10(sig / Math.max(rest, 1e-12)), size: amplitude / Math.max(faceWidth, 1e-6) };
}
/**
 * The head's movement at `bpm` in the 16 s window ending at `atMs`, one entry per axis that has a
 * line there (side to side, then up and down), or why the window cannot be judged ('blind'): fewer
 * than HEAD_MIN_ROWS rows, rows starting or ending more than 1 s from the window's edges, a gap over
 * 1 s, or fewer than HEAD_MIN_ROWS_PER_CYCLE rows per cycle of the rate. Judged at the rate claimed,
 * on a fixed grid (bins of 0.0625 Hz whatever span the rows have).
 */
export function headAtRate(head, atMs, bpm) {
    const cover = headCoverage(head, atMs);
    if ("blind" in cover)
        return cover;
    const win = cover.rows;
    if (win.length < HEAD_MIN_ROWS_PER_CYCLE * OWN_PULSE_WINDOW_S * (bpm / 60))
        return { blind: "rate" };
    const t = win.map((h) => h[0] / 1000);
    const widths = win.map((h) => h[3]).sort((a, b) => a - b);
    const faceWidth = widths[widths.length >> 1];
    const fromS = (atMs - OWN_PULSE_WINDOW_S * 1000) / 1000;
    const axes = [];
    for (const axis of [1, 2]) {
        const series = onHeadGrid(t, win.map((h) => h[axis]), fromS);
        const a = axisAtRate(spectrum(detrend(series, OWN_PULSE_DETREND_S)), bpm, faceWidth);
        if (a)
            axes.push(a);
    }
    return { axes };
}
/**
 * Whether the head's movement carries `bpm` in the window ending at `atMs`: on either axis, both
 * HEAD_MIN_SNR_DB above the rest of its movement and HEAD_MIN_SIZE of the face's width. A window the
 * head's rows do not cover is 'blind', never 'clear'.
 */
export function headJudge(head, atMs, bpm) {
    const m = headAtRate(head, atMs, bpm);
    if ("blind" in m)
        return "blind";
    return m.axes.some((a) => a.snrDb >= HEAD_MIN_SNR_DB && a.size >= HEAD_MIN_SIZE) ? "carried" : "clear";
}
/** Whether the head's movement carries `bpm` in the window ending at `atMs` (headJudge is 'carried'). */
export function headCarries(head, atMs, bpm) {
    return headJudge(head, atMs, bpm) === "carried";
}
/**
 * Whether the head's movement carried `bpm` in each of the last OWN_PULSE_STRONG_STREAK one-second
 * windows ending at `atMs` (headCarries in each): rule headMotion's withhold, the state's headMatch.
 * Judged over the windows at once, like the wall check, so one window's coincidence withholds nothing.
 */
export function headMatches(head, atMs, bpm) {
    return Array.from({ length: OWN_PULSE_STRONG_STREAK }, (_, k) => k).every((k) => headCarries(head, atMs - k * EVAL_EVERY_MS, bpm));
}
const ALL_RULES_ON = resolvePulseCheckRules();
export function wallLine(wall, atMs, bandEdge = true) {
    const win = wall.filter((w) => w[0] > atMs - OWN_PULSE_WINDOW_S * 1000 && w[0] <= atMs);
    if (win.length < WALL_MIN_SAMPLES)
        return null;
    const t = win.map((w) => w[0] / 1000);
    const brightness = resample(t, win.map((w) => w[1] + w[2] + w[3]), t[0], t[t.length - 1]);
    if (!bandEdge) {
        // Switched off: the in-band local maximum this check used before (blind at the band's edge).
        const pk = peakOfSpectrum(spectrum(detrend(brightness, OWN_PULSE_DETREND_S)));
        return Number.isFinite(pk.bpm) ? { bpm: pk.bpm, snrDb: pk.snrDb } : null;
    }
    // The wall's strongest line is searched from the band's floor to the top of the computed
    // spectrum, with no local-maximum rule: that rule is right for choosing a pulse and wrong for
    // spotting a light. A light on the band's edge puts its maximum just outside the band, so no
    // in-band maximum exists and the wall would read as carrying nothing (120 Hz mains filmed at
    // 9 fps folds to exactly 3.0 Hz, 180 a minute). Line power: bins within 0.1 Hz of the line
    // and of twice it, as peakOfSpectrum counts it.
    const range = spectrum(detrend(brightness, OWN_PULSE_DETREND_S)).filter(([f]) => f >= OWN_PULSE_BAND_HZ[0]);
    if (!range.length)
        return null;
    const f0 = range.reduce((a, b) => (b[1] > a[1] ? b : a))[0];
    const inLine = (f) => Math.abs(f - f0) <= 0.1 || Math.abs(f - 2 * f0) <= 0.1;
    let sig = 0;
    let rest = 0;
    for (const [f, p] of range)
        if (inLine(f))
            sig += p;
        else
            rest += p;
    return { bpm: f0 * 60, snrDb: 10 * Math.log10(sig / Math.max(rest, 1e-12)) };
}
/**
 * Whether the wall carries `bpm` the way a light would: the strongest line (band floor up) of its
 * BRIGHTNESS (R + G + B), within OWN_PULSE_AGREE_BPM of the rate or of a LIGHT_FAMILY multiple of it,
 * and WALL_MIN_SNR_DB above its
 * noise. Brightness, not colour: a lamp scales a grey wall's R, G and B alike, which is exactly
 * the change the colour method cancels; and a heartbeat never changes a wall's brightness.
 */
export function wallCarries(wall, atMs, bpm, rules = ALL_RULES_ON) {
    return lineCarries(wallLine(wall, atMs, rules.wallBandEdge), bpm, rules);
}
/** wallCarries on a wall line already found (one evaluation reads the same line up to three times). */
function lineCarries(line, bpm, rules) {
    const family = rules.lightFamily ? LIGHT_FAMILY : [1];
    return (line != null &&
        line.snrDb >= WALL_MIN_SNR_DB &&
        family.some((k) => Math.abs(k * line.bpm - bpm) <= OWN_PULSE_AGREE_BPM));
}
/**
 * The rates a light at the wall's rate also makes on the face: its whole and half multiples.
 * A light sampled through a camera's exposure and rolling shutter is not a sine, so its harmonics
 * fold to whole multiples of its own fold; half multiples cover a rate picked one octave below a
 * harmonic. Measured on test.3 in the browser (120 Hz mains filmed at 11 fps): wall at 60 a minute,
 * 25 dB above its noise; face at 180 and 90; 180 shown for 7 s before this.
 */
const LIGHT_FAMILY = [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4];
const EVAL_EVERY_MS = 1000;
const KEEP_MS = (OWN_PULSE_WINDOW_S + 2) * 1000;
/**
 * The wall and head checks look back over OWN_PULSE_STRONG_STREAK windows, so they keep that much
 * more: 22 s, of which the head's withhold needs 19 (four 16 s windows a second apart).
 */
const WALL_KEEP_MS = KEEP_MS + OWN_PULSE_STRONG_STREAK * EVAL_EVERY_MS;
const HISTORY_MAX = 120;
/**
 * A proven rate belongs to the face it was measured on. Once no face has reached the check
 * for this long, the rate is dropped and the proof starts over: the face that comes back may
 * be someone else, or in other light. One evaluation interval, so a rate is never shown for
 * longer than the check takes to re-judge it, while a one-frame face-finder dropout (a few
 * tens of ms) keeps it.
 */
const FACE_GONE_MS = EVAL_EVERY_MS;
export class PulseCheck {
    constructor(opts = {}) {
        this.samples = [];
        this.wall = [];
        this.head = [];
        /** A head argument (a position or null) has reached push since the last reset: the movement is judged. */
        this.headHandedOver = false;
        this.history = [];
        this.held = null;
        this.second = null;
        this.seconds = [];
        this.lastEvalMs = null;
        this.lostSinceMs = null;
        this.wallTally = { seen: 0, noRoom: 0, skin: 0 };
        this.state = {
            verdict: "unknown",
            bpm: null,
            snrDb: null,
            streak: 0,
            wallMatch: false,
        };
        /** Consecutive evaluations in which the newest OWN_PULSE_SUPPORT_S seconds did not carry the proven rate. */
        this.unsupported = 0;
        this.agreement = opts.agreement === true;
        this.rules = resolvePulseCheckRules(opts.rules);
    }
    /** The least wall against the face for green minus the wall: the bar with rule darkWall on, any wall seen with it off. */
    get swapMinWall() {
        return this.rules.darkWall ? OWN_PULSE_SWAP_MIN_WALL_TO_FACE : 0;
    }
    /** Whether the opt-in agreement path is on (the runner reads the SDK's rate only then). */
    get agreementOn() {
        return this.agreement;
    }
    /** The SDK's own current rate, given once a second; used only with `agreement` on. */
    secondOpinion(bpm) {
        this.second = bpm != null && Number.isFinite(bpm) ? bpm : null;
    }
    /**
     * One frame: mean RGB of forehead, left cheek and right cheek, at the frame's timestamp,
     * and optionally the mean RGB of a patch of wall beside the face (see the wall check), on one
     * continuous scale across patches (WallTracker).
     */
    push(timestampMs, regions, wall, wallMiss, 
    /**
     * The head this frame (headCentre), for the headMotion rule; null when the face mesh found no
     * head this frame (a window it leaves uncovered is then not evidence). Leave it out on every
     * frame when the frames carry no face mesh: the movement is then not checked.
     */
    head, 
    /**
     * The same wall as the camera read it this frame, before WallTracker's rescaling (its `raw`):
     * rule darkWall judges the wall's brightness on it. Leave it out when `wall` is read from one
     * patch and never rescaled; `wall` is then taken as read.
     */
    wallRaw) {
        if (regions.length < 3 || !Number.isFinite(timestampMs))
            return;
        if (wall)
            this.wallTally.seen++;
        else if (wallMiss === "no-room")
            this.wallTally.noRoom++;
        else if (wallMiss === "skin")
            this.wallTally.skin++;
        // Frames that stopped arriving unannounced count as a lost face too.
        const last = this.samples[this.samples.length - 1];
        if (last && timestampMs - last[0] > FACE_GONE_MS)
            this.reset();
        this.lostSinceMs = null;
        const [f, l, r] = regions;
        this.samples.push([
            timestampMs,
            f.r,
            f.g,
            f.b,
            l.r,
            l.g,
            l.b,
            r.r,
            r.g,
            r.b,
            // The wall beside the face, for the colour-damage switch (OWN_PULSE_COLOUR_DAMAGE).
            wall?.r ?? Number.NaN,
            wall?.g ?? Number.NaN,
            wall?.b ?? Number.NaN,
            // And as the camera read it, for its brightness (rule darkWall, wallLevelSeen).
            wall ? (wallRaw ?? wall).r : Number.NaN,
            wall ? (wallRaw ?? wall).g : Number.NaN,
            wall ? (wallRaw ?? wall).b : Number.NaN,
        ]);
        while (this.samples.length && this.samples[0][0] < timestampMs - KEEP_MS)
            this.samples.shift();
        if (wall)
            this.wall.push([timestampMs, wall.r, wall.g, wall.b]);
        while (this.wall.length && this.wall[0][0] < timestampMs - WALL_KEEP_MS)
            this.wall.shift();
        if (head !== undefined)
            this.headHandedOver = true;
        if (head && Number.isFinite(head.x) && Number.isFinite(head.y) && Number.isFinite(head.faceWidth) && head.faceWidth > 0)
            this.head.push([timestampMs, head.x, head.y, head.faceWidth]);
        while (this.head.length && this.head[0][0] < timestampMs - WALL_KEEP_MS)
            this.head.shift();
        if (this.lastEvalMs == null)
            this.lastEvalMs = timestampMs;
        if (timestampMs - this.lastEvalMs < EVAL_EVERY_MS)
            return;
        this.lastEvalMs = timestampMs;
        const wallFrames = this.wallTally;
        this.wallTally = { seen: 0, noRoom: 0, skin: 0 };
        const est = estimateOwnPulse(this.samples, OWN_PULSE_WINDOW_S, timestampMs, OWN_PULSE_COLOUR_SWITCH, this.swapMinWall);
        if (est && est.skip)
            return;
        // The wall's line for a window end, found once per evaluation: the taint, the wall check and
        // the state read the newest one, and the wall rows do not change while this runs.
        const lines = new Map();
        const lineAt = (ms) => {
            if (!lines.has(ms))
                lines.set(ms, wallLine(this.wall, ms, this.rules.wallBandEdge));
            return lines.get(ms) ?? null;
        };
        // A window whose rate the wall carries is the light's, not evidence of a pulse (lightTaint):
        // counted, it builds a streak under the light, and the rate shows the first second the wall
        // line dips. Its cost on real pulses was measured on recorded captures against a reference
        // pulse before it was added. The head's movement is judged the same way (headMotion).
        // Only a window whose head is seen and clear of the rate counts (fail-closed): a window the
        // head's rows do not cover could hide a nod, as the colour carries on while the mesh is not looking.
        const windowHead = this.rules.headMotion && this.headHandedOver && est?.bpm != null
            ? headJudge(this.head, timestampMs, est.bpm)
            : null;
        const tainted = est?.bpm != null &&
            ((this.rules.lightTaint && lineCarries(lineAt(timestampMs), est.bpm, this.rules)) ||
                (windowHead != null && windowHead !== "clear"));
        this.history.push(tainted ? null : est);
        if (this.history.length > HISTORY_MAX)
            this.history.shift();
        const v = ownPulseVerdict(this.history, this.held);
        this.held = v.verdict === "measured" ? v.bpm : null;
        this.seconds.push({ sdk: this.second, win: est?.bpmFine ?? est?.bpm ?? null, winSnr: est?.snrDb ?? null });
        if (this.seconds.length > AGREE_SECONDS)
            this.seconds.shift();
        const agreed = this.agreement && this.held == null ? agreementRate(this.seconds) : null;
        // The wall check only withholds; it never changes what the check itself has proven.
        // Judged over the last 4 one-second windows at once, not counted forward from the
        // moment of proof, so a lamp's rate is withheld from its first second.
        const held = this.held ?? agreed;
        const wallMatch = held != null &&
            Array.from({ length: OWN_PULSE_STRONG_STREAK }, (_, k) => k).every((k) => lineCarries(lineAt(timestampMs - k * EVAL_EVERY_MS), held, this.rules));
        const faceFlicker = this.rules.faceFlicker &&
            held != null &&
            Array.from({ length: OWN_PULSE_STRONG_STREAK }, (_, k) => k).every((k) => {
                const q = faceFlickerRatio(this.samples, timestampMs - k * EVAL_EVERY_MS, held);
                return q != null && q > FACE_FLICKER_RATIO;
            });
        const headMatch = this.rules.headMotion &&
            held != null &&
            headMatches(this.head, timestampMs, held);
        this.state = wallMatch || faceFlicker || headMatch
            ? {
                verdict: "not-measured",
                bpm: null,
                snrDb: v.snrDb,
                streak: v.streak,
                wallMatch,
                windowBpm: est?.bpm ?? null,
                windowSnrDb: est?.snrDb ?? null,
                windowMethod: est?.method ?? null,
                windowColourDamage: est?.colourDamage ?? null,
                windowWallSeen: est?.wallSeen ?? false,
                windowWallLevel: est?.wallLevel ?? null,
                windowWallToFace: est?.wallToFace ?? null,
                wallLine: lineAt(timestampMs),
                wallFrames,
                faceFlicker,
                headMatch,
                windowHead,
            }
            : {
                verdict: agreed != null ? "measured" : v.verdict,
                bpm: agreed ?? this.shownRate(timestampMs),
                via: agreed != null ? "agreement" : this.held != null ? "check" : null,
                snrDb: v.snrDb,
                streak: v.streak,
                wallMatch,
                windowBpm: est?.bpm ?? null,
                windowSnrDb: est?.snrDb ?? null,
                windowMethod: est?.method ?? null,
                windowColourDamage: est?.colourDamage ?? null,
                windowWallSeen: est?.wallSeen ?? false,
                windowWallLevel: est?.wallLevel ?? null,
                windowWallToFace: est?.wallToFace ?? null,
                wallLine: lineAt(timestampMs),
                wallFrames,
                faceFlicker,
                headMatch,
                windowHead,
            };
    }
    /**
     * The rate to show once one is proven: the line in the newest OWN_PULSE_SUPPORT_S seconds when it sits
     * within OWN_PULSE_TRACK_BPM of the proven rate, else the proven rate, and nothing once the newest
     * window has not carried it for OWN_PULSE_SUPPORT_MISS evaluations in a row. The proof itself
     * (this.held, the verdict, the hold) is unchanged.
     */
    shownRate(timestampMs) {
        if (this.held == null) {
            this.unsupported = 0;
            return null;
        }
        const recent = estimateOwnPulse(this.samples, OWN_PULSE_SUPPORT_S, timestampMs, OWN_PULSE_COLOUR_SWITCH, this.swapMinWall);
        const rate = recent?.bpmFine ?? recent?.bpm ?? null;
        if (rate != null && Math.abs(rate - this.held) <= OWN_PULSE_TRACK_BPM) {
            this.unsupported = 0;
            return rate;
        }
        this.unsupported += 1;
        return this.unsupported >= OWN_PULSE_SUPPORT_MISS ? null : this.held;
    }
    /** A frame in which no face (no forehead and cheeks) was found. */
    faceLost(timestampMs) {
        if (!Number.isFinite(timestampMs))
            return;
        if (this.lostSinceMs == null)
            this.lostSinceMs = timestampMs;
        else if (timestampMs - this.lostSinceMs >= FACE_GONE_MS)
            this.reset();
    }
    getState() {
        return this.state;
    }
    reset() {
        this.samples = [];
        this.wall = [];
        this.head = [];
        this.headHandedOver = false;
        this.history = [];
        this.held = null;
        this.seconds = [];
        this.second = null;
        this.lastEvalMs = null;
        this.lostSinceMs = null;
        this.wallTally = { seen: 0, noRoom: 0, skin: 0 };
        this.state = {
            verdict: "unknown",
            bpm: null,
            snrDb: null,
            streak: 0,
            wallMatch: false,
        };
    }
}
/**
 * How far the wall patch sits from the face's points, as a share of the face's width, tried in
 * this order. 0.15 clears hair on a face seen from the front. A side camera sees a turned head,
 * whose cheek, ear and neck reach well past the points, so the farther distances find wall
 * where the nearest patch is all skin.
 *
 * Value chosen by measurement on recorded captures against a reference pulse.
 */
export const WALL_GAPS = [0.15, 0.4, 0.7, 1.0];
/**
 * The wall beside the face: the first of WALL_GAPS whose patch is mostly not skin, starting from
 * `preferIndex` (the distance that worked last frame), so the wall stays one patch while it can
 * and its brightness does not step between patches. Null when every distance shows skin.
 */
export function wallBesideFace(points, frame, preferIndex) {
    const order = [preferIndex, ...WALL_GAPS.map((_, i) => i).filter((i) => i !== preferIndex)];
    for (const i of order) {
        const gap = WALL_GAPS[i];
        if (gap == null)
            continue;
        const patch = wallPatchFromLandmarks(points, frame.width, frame.height, gap);
        if (!patch)
            continue;
        const x = Math.max(0, Math.min(frame.width - 1, patch.x));
        const y = Math.max(0, Math.min(frame.height - 1, patch.y));
        const w = Math.max(1, Math.min(frame.width - x, patch.w));
        const h = Math.max(1, Math.min(frame.height - y, patch.h));
        const rgb = averageRgbInROINonSkin(frame, x, y, w, h);
        if (rgb)
            return { rgb, gapIndex: i };
    }
    return null;
}
/**
 * The wall beside the face as ONE signal, although the patch it is read from may move between
 * the distances in WALL_GAPS from frame to frame. Two patches of wall differ in brightness (one
 * nearer a window, one in shadow), so a raw switch between them is a step in the wall's
 * brightness, and a step puts power at every rate: it hides a lamp's rhythm from the wall check
 * and corrupts green minus the wall. So when the patch changes, the new patch is scaled to start
 * exactly where the old one left off, and that scale is kept while it stays: a lamp's swing,
 * shared by every patch, passes through unchanged. The wall's rhythm checks are blind to its
 * absolute level (the wall check judges a signal-to-noise ratio, green minus the wall a least-
 * squares share of normalised signals), so the rescaled wall serves them. Its brightness is not
 * kept: after a switch the carried-on level is the old patch's, not what the camera sees, so the
 * tracker also hands back each patch as read (`raw`), which rule darkWall judges.
 */
export class WallTracker {
    constructor() {
        this.gapIndex = 0;
        this.current = null;
        this.gain = { r: 1, g: 1, b: 1 };
        this.last = null;
    }
    /** The wall this frame on one continuous scale, and as read (see track), or null when none was found. */
    next(points, frame) {
        const w = wallBesideFace(points, frame, this.gapIndex);
        if (!w)
            return null;
        this.gapIndex = w.gapIndex;
        return this.track(w.gapIndex, w.rgb);
    }
    /**
     * Patch `gapIndex` read as `rgb`: `rgb` on one continuous scale (continuous), for the wall's
     * rhythm, and `raw`, the patch as read, for its brightness. PulseCheck.push takes both.
     */
    track(gapIndex, rgb) {
        return { rgb: this.continuous(gapIndex, rgb), raw: rgb, gapIndex };
    }
    /** `rgb` from patch `gapIndex`, rescaled at a change of patch so the signal does not step. */
    continuous(gapIndex, rgb) {
        if (gapIndex !== this.current) {
            const to = this.last ?? rgb;
            this.gain = {
                r: to.r / (rgb.r || 1e-6),
                g: to.g / (rgb.g || 1e-6),
                b: to.b / (rgb.b || 1e-6),
            };
            this.current = gapIndex;
        }
        this.last = { r: rgb.r * this.gain.r, g: rgb.g * this.gain.g, b: rgb.b * this.gain.b };
        return this.last;
    }
}
/**
 * Why wallBesideFace found nothing: "no-room" when no distance leaves a patch inside the frame
 * (the face fills it), otherwise "skin" (every patch looked like skin: an ear or neck, or a
 * beige or wooden wall, or warm light making the wall skin-coloured).
 */
export function wallMissReason(points, width, height) {
    return WALL_GAPS.some((g) => wallPatchFromLandmarks(points, width, height, g))
        ? "skin"
        : "no-room";
}
/**
 * A patch of wall beside the face for the wall check, in pixels, or null when there is no
 * room for one (a face that fills the frame). At cheek height (the middle third of the face),
 * a quarter of the face wide, `gap` of the face's width clear of its edge (WALL_GAPS), on
 * whichever side has more room. The face's edges are taken at the 5th and 95th percentile of
 * the points across and the 3rd and 97th down, so a single stray point cannot move the patch.
 */
export function wallPatchFromLandmarks(points, width, height, gap = WALL_GAPS[0]) {
    if (!points.length || width <= 0 || height <= 0)
        return null;
    const clamp01 = (v) => Math.min(1, Math.max(0, v));
    const pick = (v, q) => v[Math.min(v.length - 1, Math.max(0, Math.floor((v.length - 1) * q)))];
    // Scaling by a positive width keeps the order, so the k-th scaled value is the scaled k-th value:
    // picking from the face's sorted points (sortedLandmarkAxes) and scaling after is the same number.
    const sorted = sortedLandmarkAxes(points);
    let x0;
    let y0;
    let fw;
    let fh;
    if (sorted) {
        x0 = pick(sorted.xs, 0.05) * width;
        y0 = pick(sorted.ys, 0.03) * height;
        fw = Math.max(1, pick(sorted.xs, 0.95) * width - x0);
        fh = Math.max(1, pick(sorted.ys, 0.97) * height - y0);
    }
    else {
        const xs = points.map((p) => clamp01(p.x) * width).sort((a, b) => a - b);
        const ys = points.map((p) => clamp01(p.y) * height).sort((a, b) => a - b);
        x0 = pick(xs, 0.05);
        y0 = pick(ys, 0.03);
        fw = Math.max(1, pick(xs, 0.95) - x0);
        fh = Math.max(1, pick(ys, 0.97) - y0);
    }
    const w = fw * 0.25;
    const clear = fw * gap;
    const y = y0 + fh / 3;
    const h = fh / 3;
    if (y < 0 || y + h > height)
        return null;
    const roomLeft = x0 - clear;
    const roomRight = width - (x0 + fw + clear);
    let x = null;
    if (roomLeft >= roomRight && roomLeft >= w)
        x = roomLeft - w;
    else if (roomRight > roomLeft && roomRight >= w)
        x = x0 + fw + clear;
    if (x == null)
        return null;
    return {
        x: Math.round(x),
        y: Math.round(y),
        w: Math.max(1, Math.round(w)),
        h: Math.max(1, Math.round(h)),
    };
}
