/**
 * Rule tracker: one model for "is there a pulse, and at what rate", in place of the streak rules.
 *
 * A forward hidden Markov filter over heart-rate bins (TRACKER_LO_BPM..TRACKER_HI_BPM, 1 bpm) plus one no-pulse
 * state, stepped once per window (Rabiner 1989; the same structure as wrist-PPG trackers such as BeliefPPG, Bieri
 * 2023, and TROIKA, Zhang 2015, with a no-pulse state added so a weak or absent pulse withholds instead of holding).
 *
 * - Evidence: each rate's band power plus TRACKER_HARMONIC of the power at twice the rate, against its noise floor: the
 *   higher of the median power within TRACKER_WHITEN_BPM of that rate and the band's median (slow drift rises toward
 *   low rates while a pulse is a narrow line, so a drift line at the band's bottom is not mistaken for a pulse, the
 *   general form of rule driftLine; the band's median keeps a local floor that reads low by chance from making noise
 *   look like a line). Its log is tempered by TRACKER_TAU, since windows a second apart share most of their samples.
 * - Motion: within a pulse, the rate moves by a normal step of TRACKER_SIGMA_BPM per second. A heart does not drop
 *   70 bpm in 2 s, so a jump to half or double the rate can only happen by leaving through the no-pulse state
 *   (TRACKER_Q_OFF per second) and entering again (TRACKER_Q_ON, spread evenly over the rates: no prior that would
 *   bend a slow or fast heart toward the middle).
 * - Shown: the posterior mass within the bar (5 bpm or 10%) of its mode, at TRACKER_SHOW or more; the rate
 *   shown is the posterior mean over that span.
 *
 * Values chosen by measurement on recorded captures against a reference pulse, with their no-pulse copies.
 */
export const TRACKER_LO_BPM = 42;
export const TRACKER_HI_BPM = 180;
export const TRACKER_HARMONIC = 0;
export const TRACKER_WHITEN_BPM = 39;
export const TRACKER_TAU = 4;
export const TRACKER_SIGMA_BPM = 3;
export const TRACKER_Q_OFF = 0.05;
export const TRACKER_Q_ON = 0.02;
export const TRACKER_SHOW = 0.25;
/**
 * Within this many bpm of either end of the band the median window is one-sided and reads below a drift that rises
 * toward the edge, so there the floor is also a straight-line fit of log power over the neighbours (TRACKER_FIT_GAP_BPM
 * and more away, so a rate's own line does not lift its floor), plus Euler's constant (for noise of mean m, the mean
 * log power is log m - 0.577); the higher of the two counts.
 */
export const TRACKER_EDGE_BPM = 6;
export const TRACKER_FIT_GAP_BPM = 6;
const EULER = 0.5772156649015329;
/**
 * A rate shown before a break (a camera restart, the page left and come back) seeds the filter after it: this much
 * posterior mass around that rate, widened by the motion step for the time since. Below TRACKER_SHOW on purpose: the
 * seed is a prior and never shows by itself; the face's own windows confirm it within seconds, or wear it away.
 */
export const TRACKER_RESUME_MASS = 0.2;
/**
 * Belief in a pulse when the filter starts or resets, spread evenly over the rates (the rest on no pulse). 0 starts every
 * session and every return from all-no-pulse, so belief can only enter at TRACKER_Q_ON a second; the filter's own
 * stationary mix, TRACKER_Q_ON / (TRACKER_Q_ON + TRACKER_Q_OFF), is the textbook start. Under test (scratchpad tracker/p0).
 */
export const TRACKER_START_MASS = 0;
/**
 * How wide the prior after a break is: a heart rate drifts back toward its own level rather than walking, so over a gap
 * of D s its change has a spread of TRACKER_SEED_SD_BPM x sqrt(1 - exp(-D / TRACKER_SEED_TAU_S)), never below the motion
 * step. Measured on a lab finger reference (5 s median): spread 3.1, 4.5, 5.4, 5.8, 6.7 bpm at gaps
 * of 5, 10, 20, 30, 60 s, where the walk gives 6.7, 9.5, 13.4, 16.4, 23.2; 7 bpm and 20 s fit it. Infinity keeps the
 * walk (sigma x sqrt(D)). Under test (scratchpad tracker/a3).
 */
export const TRACKER_SEED_SD_BPM = Infinity;
export const TRACKER_SEED_TAU_S = 20;
/**
 * The newest TRACKER_RECENT_S seconds as a second source of evidence (a moving heart shows there before the full window
 * catches up), tempered by TRACKER_TAU times this; Infinity leaves it out.
 */
export const TRACKER_RECENT_S = 8;
export const TRACKER_RECENT_TAU_FACTOR = Number.POSITIVE_INFINITY;
/** Before a full window, the tracker reads the window there is, from this many seconds (the growing window). */
export const TRACKER_FIRST_WINDOW_S = 6;
/**
 * Seconds after a start or reset that the tracker's window leaves out (the camera settles its exposure and white balance
 * there): a 7 s window ending 7 to 10 s into a received file is within 5 bpm of the file's 16 s line 44% of the time, the
 * same window from 30 s on 74% (tracker/a3/shortwin.mjs, 2026-11-07). 2 s, against 0, on the 8 sealed lab people (blind, once):
 * shown 54.9 to 53.7%, error 2.55 to 2.15 bpm, over 10 off 4.1 to 3.0%, made-up numbers on no-pulse copies 1.72 to 1.42 per
 * 100 s; the same direction on the open lab (stage 2). Fewer wrong numbers for 1 point of shown seconds: a wrong number costs far more than a missing one.
 */
export const TRACKER_SETTLE_S = 2;
/**
 * A heart under the band (25 to 42 bpm) reads as its 2nd or 3rd harmonic, since the band starts at 42. Physics tells the
 * two apart without reading under 42, where breathing, sway and drift lines live on real recordings: a heart truly at the
 * shown rate m has nothing at 1.5 m (or at 2/3 and 4/3 of m), while the 2nd harmonic of a heart at m / 2 brings its 3rd
 * harmonic at 1.5 m, and a 3rd harmonic brings the 2nd and 4th. The shown number is withheld when, for f0 = m / 2 or m / 3
 * under 42, the lowest harmonics a heart truly at m cannot have (1.5 m for f0 = m / 2; 2/3 m and 4/3 m for m / 3) each
 * show a line: the strongest point within max(2 bpm, half a bin) of it at least this many times the band's median, and
 * above the points 6 bpm either side. 0 turns it off. Measured offline on the library's own spectra (evsave TRIED
 * "A4 v4", 2026-11-09), at 8: fires on 0.36% of 7422 laptop, 0 of 2026 phone and 0.27% of 734 Mac shown seconds of
 * received recordings, 0.68 and 1.18% of the lab's (mostly wrong numbers removed), against 99% of the shown seconds of
 * synthetic hearts at 30 to 40 bpm (the earlier check under 42 cost 0.7 to 3.4% of real seconds).
 */
export const TRACKER_INTERHARMONIC_K = 8;
export const TRACKER_DEFAULTS = {
    tau: TRACKER_TAU,
    sigma: TRACKER_SIGMA_BPM,
    qOff: TRACKER_Q_OFF,
    qOn: TRACKER_Q_ON,
    harmonic: TRACKER_HARMONIC,
    whitenBpm: TRACKER_WHITEN_BPM,
    show: TRACKER_SHOW,
    recentTauFactor: TRACKER_RECENT_TAU_FACTOR,
    interHarmonicK: TRACKER_INTERHARMONIC_K,
};
/** Linear interpolation of a spectrum given as ascending [bpm, power] rows; 0 outside it. */
function powerAt(rows, bpm) {
    const n = rows.length;
    if (!n || bpm < rows[0][0] || bpm > rows[n - 1][0])
        return 0;
    let lo = 0;
    let hi = n - 1;
    while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (rows[mid][0] <= bpm)
            lo = mid;
        else
            hi = mid;
    }
    const [b0, p0] = rows[lo];
    const [b1, p1] = rows[hi];
    return b1 === b0 ? p0 : p0 + ((p1 - p0) * (bpm - b0)) / (b1 - b0);
}
function median(xs) {
    const s = xs.slice().sort((a, b) => a - b);
    const m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
export class PulseTracker {
    constructor(params = {}) {
        this.aN = 1;
        this.lastMs = null;
        this.p = { ...TRACKER_DEFAULTS, ...params };
        this.rates = [];
        for (let b = TRACKER_LO_BPM; b <= TRACKER_HI_BPM; b++)
            this.rates.push(b);
        const n = this.rates.length;
        // Column-normalised normal kernel: K[j][i] = P(rate j now | rate i a second ago).
        const cols = [];
        for (let i = 0; i < n; i++) {
            const c = new Float64Array(n);
            let s = 0;
            for (let j = 0; j < n; j++) {
                const d = (this.rates[j] - this.rates[i]) / this.p.sigma;
                c[j] = Math.exp(-0.5 * d * d);
                s += c[j];
            }
            for (let j = 0; j < n; j++)
                c[j] /= s;
            cols.push(c);
        }
        this.K = cols;
        this.near = this.rates.map((b) => {
            if (this.p.whitenBpm <= 0)
                return [];
            const out = [];
            this.rates.forEach((r, j) => {
                if (Math.abs(r - b) <= this.p.whitenBpm)
                    out.push(j);
            });
            return out;
        });
        this.a = new Float64Array(n).fill(TRACKER_START_MASS / n);
        this.aN = 1 - TRACKER_START_MASS;
    }
    /** Each rate's log evidence from one spectrum against its floor, tempered by `tau`; 0 where the rate cannot count. */
    evidence(spectrum, cap, sup, tau) {
        const n = this.rates.length;
        const H = this.rates.map((b) => powerAt(spectrum, b) + this.p.harmonic * powerAt(spectrum, 2 * b));
        const l = new Float64Array(n);
        const bandMedian = median(H);
        const fit = this.edgeFit(H);
        for (let j = 0; j < n; j++) {
            const b = this.rates[j];
            if (b > cap || sup.some((s) => Math.abs(s - b) <= Math.max(5, 0.1 * s)))
                continue;
            const floor = this.p.whitenBpm > 0 ? Math.max(median(this.near[j].map((k) => H[k])), bandMedian) : bandMedian;
            const noise = Math.max(floor / Math.LN2, fit[j]) + 1e-30;
            l[j] = Math.log(Math.max(H[j] / noise, 1e-6)) / tau;
        }
        return l;
    }
    /** The edge floor (TRACKER_EDGE_BPM): the line fit at each rate near either end of the band, 0 elsewhere. */
    edgeFit(H) {
        const n = this.rates.length;
        const out = new Float64Array(n);
        const lo = this.rates[0];
        const hi = this.rates[n - 1];
        for (let j = 0; j < n; j++) {
            const b = this.rates[j];
            if (b - lo >= TRACKER_EDGE_BPM && hi - b >= TRACKER_EDGE_BPM)
                continue;
            let s0 = 0;
            let sx = 0;
            let sxx = 0;
            let sy = 0;
            let sxy = 0;
            for (let k = 0; k < n; k++) {
                const d = Math.abs(this.rates[k] - b);
                if (d > this.p.whitenBpm || d <= TRACKER_FIT_GAP_BPM)
                    continue;
                const x = this.rates[k];
                const y = Math.log(Math.max(H[k], 1e-30));
                s0 += 1;
                sx += x;
                sxx += x * x;
                sy += y;
                sxy += x * y;
            }
            if (s0 < 2)
                continue;
            const den = s0 * sxx - sx * sx;
            const slope = den > 0 ? (s0 * sxy - sx * sy) / den : 0;
            out[j] = Math.exp((sy - slope * sx) / s0 + slope * b + EULER);
        }
        return out;
    }
    /** Seed the filter with a rate shown `ageS` seconds ago (TRACKER_RESUME_MASS around it, widened by the motion step). */
    seed(bpm, ageS, mass = TRACKER_RESUME_MASS) {
        const age = Math.max(1, ageS);
        const sd = Number.isFinite(TRACKER_SEED_SD_BPM)
            ? Math.max(this.p.sigma, TRACKER_SEED_SD_BPM * Math.sqrt(1 - Math.exp(-age / TRACKER_SEED_TAU_S)))
            : this.p.sigma * Math.sqrt(age);
        const w = this.rates.map((r) => Math.exp(-0.5 * ((r - bpm) / sd) ** 2));
        const sum = w.reduce((x, y) => x + y, 0) || 1;
        this.a = Float64Array.from(w, (v) => (mass * v) / sum);
        this.aN = 1 - mass;
    }
    reset() {
        this.a = new Float64Array(this.rates.length).fill(TRACKER_START_MASS / this.rates.length);
        this.aN = 1 - TRACKER_START_MASS;
        this.lastMs = null;
    }
    /** One second of time with no evidence (the prior moves; nothing is learned). */
    predict() {
        const n = this.rates.length;
        const { qOff, qOn } = this.p;
        const next = new Float64Array(n);
        let sum = 0;
        for (let i = 0; i < n; i++) {
            const ai = this.a[i];
            sum += ai;
            if (ai === 0)
                continue;
            const c = this.K[i];
            for (let j = 0; j < n; j++)
                next[j] += ai * c[j];
        }
        const enter = (qOn * this.aN) / n;
        for (let j = 0; j < n; j++)
            next[j] = (1 - qOff) * next[j] + enter;
        this.aN = qOff * sum + (1 - qOn) * this.aN;
        this.a = next;
    }
    /**
     * Advance to `timestampMs` and take one window's in-band power spectrum ([bpm, power], ascending, as measured,
     * not whitened). Returns the posterior summary.
     */
    step(timestampMs, spectrum, ev = {}) {
        const steps = this.lastMs == null ? 1 : Math.max(1, Math.round((timestampMs - this.lastMs) / 1000));
        this.lastMs = timestampMs;
        for (let s = 0; s < steps; s++)
            this.predict();
        const n = this.rates.length;
        if (!ev.none && spectrum.length) {
            const cap = ev.capBpm ?? Infinity;
            const sup = ev.suppressBpm ?? [];
            const l = this.evidence(spectrum, cap, sup, this.p.tau);
            if (ev.recent && ev.recent.length && Number.isFinite(this.p.recentTauFactor)) {
                const l2 = this.evidence(ev.recent, cap, sup, this.p.tau * this.p.recentTauFactor);
                for (let j = 0; j < n; j++)
                    l[j] += l2[j];
            }
            let lmax = 0; // the no-pulse state's evidence is log 1 = 0
            for (let j = 0; j < n; j++)
                if (l[j] > lmax)
                    lmax = l[j];
            let s = Math.exp(-lmax) * this.aN;
            for (let j = 0; j < n; j++) {
                this.a[j] *= Math.exp(l[j] - lmax);
                s += this.a[j];
            }
            this.aN = (Math.exp(-lmax) * this.aN) / s;
            for (let j = 0; j < n; j++)
                this.a[j] /= s;
        }
        let m = 0;
        for (let j = 1; j < n; j++)
            if (this.a[j] > this.a[m])
                m = j;
        const mode = this.rates[m];
        const half = Math.max(5, 0.1 * mode);
        let mass = 0;
        let wsum = 0;
        for (let j = 0; j < n; j++) {
            if (Math.abs(this.rates[j] - mode) > half)
                continue;
            mass += this.a[j];
            wsum += this.a[j] * this.rates[j];
        }
        const bpm = mass > 0 ? wsum / mass : mode;
        const shown = mass >= this.p.show && !(this.p.interHarmonicK > 0 && !ev.none && slowHeartHarmonics(spectrum, Math.round(bpm), this.p.interHarmonicK));
        return { mass, bpm, pPulse: 1 - this.aN, shown };
    }
}
/** TRACKER_INTERHARMONIC_K: true when the shown rate `mode` reads as the 2nd or 3rd harmonic of a heart under 42. */
export function slowHeartHarmonics(spectrum, mode, k) {
    if (spectrum.length < 3)
        return false;
    const pw = spectrum.map((r) => r[1]).sort((a, b) => a - b);
    const med = pw[pw.length >> 1];
    const step = spectrum[1][0] - spectrum[0][0];
    const tol = Math.max(2, step / 2);
    const near = (c, w) => {
        let p = 0;
        for (const [x, q] of spectrum)
            if (Math.abs(x - c) <= w && q > p)
                p = q;
        return p;
    };
    for (const d of [2, 3]) {
        const f0 = mode / d;
        if (f0 >= TRACKER_LO_BPM || f0 < 25)
            continue;
        // Only the lowest harmonics a heart truly at `mode` cannot have (a camera's upper harmonics are weak).
        const need = (d === 2 ? [1.5 * mode] : [(2 * mode) / 3, (4 * mode) / 3]).filter((c) => c >= TRACKER_LO_BPM && c <= TRACKER_HI_BPM);
        if (!need.length)
            continue;
        if (need.every((c) => { const p = near(c, tol); return p >= k * med && p > near(c - 6, 3) && p > near(c + 6, 3); }))
            return true;
    }
    return false;
}
