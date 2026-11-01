/**
 * Rule headMotion: a rate the head's own movement keeps time with is not a pulse. Walking bobs the head once a step and
 * sways it once a stride, and the light on the face rises and falls with it, so a moving person's step rate reads as a
 * pulse (a phone recording, walking, 2026-11-01: 117 to 120 shown while the head swayed 59.5 to 60 a minute, half a step
 * rate of 119 to 120, and bobbed 117.5 to 118.5). The judge is the one that shipped in test.5 to test.40 (removed
 * 2026-10-30 because no received recording then held a moving head), restored unchanged: at the rate claimed, on either
 * axis, the head's line HEAD_MIN_SNR_DB over the rest of its movement and HEAD_MIN_SIZE of the face's width.
 */
import { OWN_PULSE_AGREE_BPM, OWN_PULSE_BAND_HZ, OWN_PULSE_DETREND_S, OWN_PULSE_FS, OWN_PULSE_STRONG_STREAK, OWN_PULSE_WINDOW_S, detrend, spectrum, } from "./pulseCheckCore.js";
/** The check evaluates once a second; headMatches looks back this many ms per window. */
const HEAD_EVAL_MS = 1000;
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
    return Array.from({ length: OWN_PULSE_STRONG_STREAK }, (_, k) => k).every((k) => headCarries(head, atMs - k * HEAD_EVAL_MS, bpm));
}
/**
 * Whether the head keeps time with `bpm` in the window ending at `atMs`: at the rate, or at half the rate. A walk sways
 * the head once a stride, half the step rate, and the sway's second harmonic lands on the step rate in the light on the
 * face; judged at the rate alone a recorded walk was caught 24 of 32 shown seconds, with half the rate too 32 of 32,
 * at a cost of 4 of 1,736 shown seconds on still phone recordings and 4 of 4,107 more on still laptop ones.
 */
export function headKeepsTime(head, atMs, bpm) {
    if (!headMoving(head, atMs))
        return false;
    return headCarries(head, atMs, bpm) || (bpm / 2 >= OWN_PULSE_BAND_HZ[0] * 60 && headCarries(head, atMs, bpm / 2));
}
/**
 * The head is moving: its spread over the last 8 s (position and size, over the face's width) above HEAD_MOVING_MIN,
 * the bar "hold still" uses (pulseGuide MOVE_MAX, movementOf, the same measure). A still head cannot keep time with a
 * walk, and a resting heartbeat nudges the head at its own rate: gated so, the recorded walk was still caught 32 of 32
 * shown seconds, and 17 of the 64 seconds caught on still recordings were left alone (laptop 6, phone 1, a Mac 10).
 */
export const HEAD_MOVING_MIN = 0.07;
const HEAD_MOVING_WINDOW_MS = 8000;
const HEAD_MOVING_MIN_ROWS = 60;
export function headMoving(head, atMs) {
    const win = head.filter((h) => h[0] > atMs - HEAD_MOVING_WINDOW_MS && h[0] <= atMs && h[3] > 0);
    if (win.length < HEAD_MOVING_MIN_ROWS)
        return false;
    const spread = (xs) => {
        const m = xs.reduce((a, b) => a + b, 0) / xs.length;
        return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length);
    };
    const ws = win.map((h) => h[3]).sort((a, b) => a - b);
    const w = ws[ws.length >> 1];
    return (spread(win.map((h) => h[1])) + spread(win.map((h) => h[2])) + spread(win.map((h) => h[3]))) / w > HEAD_MOVING_MIN;
}
/** headKeepsTime in each of the last OWN_PULSE_STRONG_STREAK windows: a held number the head has kept time with. */
export function headKeepsTimeAll(head, atMs, bpm) {
    return Array.from({ length: OWN_PULSE_STRONG_STREAK }, (_, k) => k).every((k) => headKeepsTime(head, atMs - k * HEAD_EVAL_MS, bpm));
}
