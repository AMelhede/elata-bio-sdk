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
import { OWN_PULSE_AGREE_BPM, OWN_PULSE_BAND_HZ, OWN_PULSE_DETREND_S, OWN_PULSE_FS, OWN_PULSE_STRONG_STREAK, OWN_PULSE_WINDOW_S, detrend, estimateOwnPulse, agreementRate, AGREE_SECONDS, ownPulseVerdict, peakOfSpectrum, resample, spectrum, } from "./pulseCheckCore.js";
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
export const PULSE_CHECK_RULE_NAMES = ["wallBandEdge", "lightFamily", "faceFlicker", "lightTaint", "headMotion"];
/** Every rule resolved to true or false; left out means on. */
export function resolvePulseCheckRules(rules) {
    return {
        wallBandEdge: rules?.wallBandEdge !== false,
        lightFamily: rules?.lightFamily !== false,
        faceFlicker: rules?.faceFlicker !== false,
        lightTaint: rules?.lightTaint !== false,
        headMotion: rules?.headMotion !== false,
    };
}
/**
 * Face-mesh landmarks on bone, not on skin that moves with expression: nose bridge and tip, forehead,
 * chin, outer eye corners, cheekbones (MediaPipe face mesh indices; the same set Peak records).
 */
export const HEAD_LANDMARKS = [168, 6, 4, 10, 152, 33, 263, 234, 454];
/** The head's position this frame: the centre of HEAD_LANDMARKS in pixels, or null if the mesh lacks one. */
export function headCentre(points, width, height) {
    if (points.length <= Math.max(...HEAD_LANDMARKS) || width <= 0 || height <= 0)
        return null;
    let x = 0;
    let y = 0;
    for (const i of HEAD_LANDMARKS) {
        x += points[i].x * width;
        y += points[i].y * height;
    }
    return { x: x / HEAD_LANDMARKS.length, y: y / HEAD_LANDMARKS.length };
}
/**
 * How far the head's movement line must stand above the rest of its movement (dB) for a rate on it
 * to count as the movement's. Set in Peak (motionVeto.ts, 2026-10-08) on 2,196 real-pulse seconds
 * (owner recordings plus a public dataset, within 5 bpm of truth): at most 2.6 dB (p99 2.2);
 * synthetic no-pulse nods at 60, 72 and 90 a minute: 7.4 to 8.9 dB. Not yet re-measured on this
 * check's own landmark path.
 */
const HEAD_MIN_SNR_DB = 5;
const HEAD_MIN_ROWS = 40;
/** The head's movement lines (x and y) in the window ending at `atMs`, found like the wall's line. */
export function headLines(head, atMs) {
    const win = head.filter((h) => h[0] > atMs - OWN_PULSE_WINDOW_S * 1000 && h[0] <= atMs);
    if (win.length < HEAD_MIN_ROWS)
        return null;
    const t = win.map((h) => h[0] / 1000);
    const out = [];
    for (const axis of [1, 2]) {
        const series = resample(t, win.map((h) => h[axis]), t[0], t[t.length - 1]);
        const range = spectrum(detrend(series, OWN_PULSE_DETREND_S)).filter(([f]) => f >= OWN_PULSE_BAND_HZ[0]);
        if (!range.length)
            continue;
        const f0 = range.reduce((a, b) => (b[1] > a[1] ? b : a))[0];
        const inLine = (f) => Math.abs(f - f0) <= 0.1 || Math.abs(f - 2 * f0) <= 0.1;
        let sig = 0;
        let rest = 0;
        for (const [f, p] of range)
            if (inLine(f))
                sig += p;
            else
                rest += p;
        out.push({ bpm: f0 * 60, snrDb: 10 * Math.log10(sig / Math.max(rest, 1e-12)) });
    }
    return out;
}
/** Whether the head's movement carries `bpm`: a movement line at the rate, HEAD_MIN_SNR_DB above the rest. */
export function headCarries(head, atMs, bpm) {
    const lines = headLines(head, atMs);
    return (lines != null &&
        lines.some((l) => l.snrDb >= HEAD_MIN_SNR_DB && Math.abs(l.bpm - bpm) <= OWN_PULSE_AGREE_BPM));
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
    const line = wallLine(wall, atMs, rules.wallBandEdge);
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
/** The wall check looks back over OWN_PULSE_STRONG_STREAK windows, so it keeps that much more. */
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
     * and optionally the mean RGB of a patch of wall beside the face (see the wall check).
     */
    push(timestampMs, regions, wall, wallMiss, 
    /** The head's position this frame in pixels (headCentre), for the headMotion rule. */
    head) {
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
        ]);
        while (this.samples.length && this.samples[0][0] < timestampMs - KEEP_MS)
            this.samples.shift();
        if (wall)
            this.wall.push([timestampMs, wall.r, wall.g, wall.b]);
        while (this.wall.length && this.wall[0][0] < timestampMs - WALL_KEEP_MS)
            this.wall.shift();
        if (head && Number.isFinite(head.x) && Number.isFinite(head.y))
            this.head.push([timestampMs, head.x, head.y]);
        while (this.head.length && this.head[0][0] < timestampMs - WALL_KEEP_MS)
            this.head.shift();
        if (this.lastEvalMs == null)
            this.lastEvalMs = timestampMs;
        if (timestampMs - this.lastEvalMs < EVAL_EVERY_MS)
            return;
        this.lastEvalMs = timestampMs;
        const wallFrames = this.wallTally;
        this.wallTally = { seen: 0, noRoom: 0, skin: 0 };
        const est = estimateOwnPulse(this.samples, OWN_PULSE_WINDOW_S, timestampMs);
        if (est && est.skip)
            return;
        // A window whose rate the wall carries is the light's, not evidence of a pulse (lightTaint):
        // counted, it builds a streak under the light, and the rate shows the first second the wall
        // line dips. Peak 570365a; measured there to cost 8 of 9,087 real seconds and 0 readings.
        const tainted = est?.bpm != null &&
            ((this.rules.lightTaint && wallCarries(this.wall, timestampMs, est.bpm, this.rules)) ||
                (this.rules.headMotion && headCarries(this.head, timestampMs, est.bpm)));
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
            Array.from({ length: OWN_PULSE_STRONG_STREAK }, (_, k) => k).every((k) => wallCarries(this.wall, timestampMs - k * EVAL_EVERY_MS, held, this.rules));
        const faceFlicker = this.rules.faceFlicker &&
            held != null &&
            Array.from({ length: OWN_PULSE_STRONG_STREAK }, (_, k) => k).every((k) => {
                const q = faceFlickerRatio(this.samples, timestampMs - k * EVAL_EVERY_MS, held);
                return q != null && q > FACE_FLICKER_RATIO;
            });
        const headMatch = this.rules.headMotion &&
            held != null &&
            Array.from({ length: OWN_PULSE_STRONG_STREAK }, (_, k) => k).every((k) => headCarries(this.head, timestampMs - k * EVAL_EVERY_MS, held));
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
                wallLine: wallLine(this.wall, timestampMs, this.rules.wallBandEdge),
                wallFrames,
                faceFlicker,
                headMatch,
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
                wallLine: wallLine(this.wall, timestampMs, this.rules.wallBandEdge),
                wallFrames,
                faceFlicker,
                headMatch,
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
        const recent = estimateOwnPulse(this.samples, OWN_PULSE_SUPPORT_S, timestampMs);
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
 * shared by every patch, passes through unchanged. Both users of the wall are blind to its
 * absolute level (the wall check judges a signal-to-noise ratio, green minus the wall a least-
 * squares share of normalised signals).
 */
export class WallTracker {
    constructor() {
        this.gapIndex = 0;
        this.current = null;
        this.gain = { r: 1, g: 1, b: 1 };
        this.last = null;
    }
    /** The wall this frame on one continuous scale, or null when none was found. */
    next(points, frame) {
        const w = wallBesideFace(points, frame, this.gapIndex);
        if (!w)
            return null;
        this.gapIndex = w.gapIndex;
        return { rgb: this.continuous(w.gapIndex, w.rgb), gapIndex: w.gapIndex };
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
    const xs = points.map((p) => clamp01(p.x) * width).sort((a, b) => a - b);
    const ys = points.map((p) => clamp01(p.y) * height).sort((a, b) => a - b);
    const pick = (v, q) => v[Math.min(v.length - 1, Math.max(0, Math.floor((v.length - 1) * q)))];
    const x0 = pick(xs, 0.05);
    const y0 = pick(ys, 0.03);
    const fw = Math.max(1, pick(xs, 0.95) - x0);
    const fh = Math.max(1, pick(ys, 0.97) - y0);
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
