function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}
export class ChannelGainController {
    constructor() {
        this.baseline = { r: 0, g: 0, b: 0 };
        this.initialized = false;
        this.targetLevel = 110;
    }
    reset() {
        this.initialized = false;
        this.baseline = { r: 0, g: 0, b: 0 };
    }
    process(r, g, b) {
        if (!this.initialized) {
            this.baseline = { r, g, b };
            this.initialized = true;
        }
        this.baseline.r = this.baseline.r * 0.97 + r * 0.03;
        this.baseline.g = this.baseline.g * 0.97 + g * 0.03;
        this.baseline.b = this.baseline.b * 0.97 + b * 0.03;
        const gainR = clamp(this.targetLevel / (this.baseline.r || this.targetLevel), 0.5, 2.5);
        const gainG = clamp(this.targetLevel / (this.baseline.g || this.targetLevel), 0.5, 2.5);
        const gainB = clamp(this.targetLevel / (this.baseline.b || this.targetLevel), 0.5, 2.5);
        return {
            r: r * gainR,
            g: g * gainG,
            b: b * gainB,
        };
    }
}
export class ChromPulseModel {
    constructor(windowSize = 45) {
        this.windowSize = windowSize;
        this.rQueue = [];
        this.gQueue = [];
        this.bQueue = [];
    }
    reset() {
        this.rQueue = [];
        this.gQueue = [];
        this.bQueue = [];
    }
    process(r, g, b) {
        this.rQueue.push(r);
        this.gQueue.push(g);
        this.bQueue.push(b);
        if (this.rQueue.length > this.windowSize) {
            this.rQueue.shift();
            this.gQueue.shift();
            this.bQueue.shift();
        }
        const len = this.rQueue.length;
        if (len < 10)
            return 0;
        const meanR = mean(this.rQueue);
        const meanG = mean(this.gQueue);
        const meanB = mean(this.bQueue);
        const rn = r / (meanR || 1);
        const gn = g / (meanG || 1);
        const bn = b / (meanB || 1);
        const xs = 3 * rn - 2 * gn;
        const ys = 1.5 * rn + gn - 1.5 * bn;
        const xValues = [];
        const yValues = [];
        for (let i = 0; i < len; i++) {
            const curRn = this.rQueue[i] / (meanR || 1);
            const curGn = this.gQueue[i] / (meanG || 1);
            const curBn = this.bQueue[i] / (meanB || 1);
            xValues.push(3 * curRn - 2 * curGn);
            yValues.push(1.5 * curRn + curGn - 1.5 * curBn);
        }
        const stdX = standardDeviation(xValues);
        const stdY = standardDeviation(yValues);
        const alpha = stdY > 1e-6 ? stdX / stdY : 1;
        return xs - alpha * ys;
    }
}
/**
 * POS (plane-orthogonal-to-skin, Wang et al., IEEE TBME 2017), streaming over the same
 * sliding window as {@link ChromPulseModel}. On mean-normalised channels, S1 = G - B and
 * S2 = G + B - 2R, and the pulse is h = S1 + (sd S1 / sd S2) S2. The plane is orthogonal
 * to the skin's own colour, so a brightness change (all channels scaled together) cannot
 * reach the output, where CHROM's fixed skin-tone weights let part of it through. The
 * 45-sample window is 1.5 s at 30 Hz, the paper's 1.6 s.
 */
export class PosPulseModel {
    constructor(windowSize = 45) {
        this.windowSize = windowSize;
        this.rQueue = [];
        this.gQueue = [];
        this.bQueue = [];
    }
    reset() {
        this.rQueue = [];
        this.gQueue = [];
        this.bQueue = [];
    }
    process(r, g, b) {
        this.rQueue.push(r);
        this.gQueue.push(g);
        this.bQueue.push(b);
        if (this.rQueue.length > this.windowSize) {
            this.rQueue.shift();
            this.gQueue.shift();
            this.bQueue.shift();
        }
        const len = this.rQueue.length;
        if (len < 10)
            return 0;
        const meanR = mean(this.rQueue) || 1;
        const meanG = mean(this.gQueue) || 1;
        const meanB = mean(this.bQueue) || 1;
        const s1 = [];
        const s2 = [];
        for (let i = 0; i < len; i++) {
            const rn = this.rQueue[i] / meanR;
            const gn = this.gQueue[i] / meanG;
            const bn = this.bQueue[i] / meanB;
            s1.push(gn - bn);
            s2.push(gn + bn - 2 * rn);
        }
        const sd2 = standardDeviation(s2);
        const alpha = sd2 > 1e-9 ? standardDeviation(s1) / sd2 : 1;
        // Negated so the waveform keeps the orientation ChromPulseModel gives the same pulse
        // (CHROM's X - aY comes out opposite in sign to POS's S1 + aS2): peak detection and beat
        // timing downstream were built on that orientation.
        return -(s1[len - 1] + alpha * s2[len - 1]);
    }
}
export function computeSignalSnrDb(values) {
    if (values.length < 8)
        return -100;
    const meanValue = mean(values);
    let signalVar = 0;
    for (let i = 0; i < values.length; i++) {
        const delta = values[i] - meanValue;
        signalVar += delta * delta;
    }
    signalVar /= values.length;
    let noiseVar = 0;
    for (let i = 0; i < values.length - 1; i++) {
        const delta = values[i + 1] - values[i];
        noiseVar += delta * delta;
    }
    noiseVar /= Math.max(1, values.length - 1);
    if (!Number.isFinite(signalVar) ||
        !Number.isFinite(noiseVar) ||
        noiseVar <= 1e-9) {
        return -100;
    }
    const snr = signalVar / noiseVar;
    if (snr <= 0)
        return -100;
    return 10 * Math.log10(snr);
}
const BIQUAD_DEFAULT_Q = Math.SQRT1_2;
function designBiquad(type, sampleRate, cutoffHz, Q = BIQUAD_DEFAULT_Q) {
    const nyquistSafe = Math.max(0.0001, Math.min(cutoffHz, sampleRate / 2 - 0.0001));
    const w0 = (2 * Math.PI * nyquistSafe) / sampleRate;
    const cosw0 = Math.cos(w0);
    const sinw0 = Math.sin(w0);
    const alpha = sinw0 / (2 * Q);
    if (type === "lowpass") {
        return {
            b0: (1 - cosw0) / 2,
            b1: 1 - cosw0,
            b2: (1 - cosw0) / 2,
            a0: 1 + alpha,
            a1: -2 * cosw0,
            a2: 1 - alpha,
        };
    }
    return {
        b0: (1 + cosw0) / 2,
        b1: -(1 + cosw0),
        b2: (1 + cosw0) / 2,
        a0: 1 + alpha,
        a1: -2 * cosw0,
        a2: 1 - alpha,
    };
}
/** Stateful single-biquad Direct Form I section. */
class BiquadState {
    constructor(coeffs) {
        this.x1 = 0;
        this.x2 = 0;
        this.y1 = 0;
        this.y2 = 0;
        this.b0 = coeffs.b0 / coeffs.a0;
        this.b1 = coeffs.b1 / coeffs.a0;
        this.b2 = coeffs.b2 / coeffs.a0;
        this.a1 = coeffs.a1 / coeffs.a0;
        this.a2 = coeffs.a2 / coeffs.a0;
    }
    reset() {
        this.x1 = 0;
        this.x2 = 0;
        this.y1 = 0;
        this.y2 = 0;
    }
    process(x0) {
        const y0 = this.b0 * x0 +
            this.b1 * this.x1 +
            this.b2 * this.x2 -
            this.a1 * this.y1 -
            this.a2 * this.y2;
        this.x2 = this.x1;
        this.x1 = x0;
        this.y2 = this.y1;
        this.y1 = y0;
        return y0;
    }
}
/**
 * Streaming cardiac bandpass: a high-pass at `lowHz` cascaded with a low-pass
 * at `highHz`. Feed one sample per frame via {@link process}.
 */
export class Bandpass {
    constructor(sampleRate, lowHz = 0.7, highHz = 4.0) {
        this.hp = new BiquadState(designBiquad("highpass", sampleRate, lowHz));
        this.lp = new BiquadState(designBiquad("lowpass", sampleRate, highHz));
    }
    reset() {
        this.hp.reset();
        this.lp.reset();
    }
    process(value) {
        return this.lp.process(this.hp.process(value));
    }
}
/**
 * Zero-phase bandpass via forward-backward filtering (filtfilt). Filtering
 * twice in opposite directions cancels the phase response, so beat timing is
 * not shifted by the filter — at the cost of being offline (whole-buffer).
 */
export function zeroPhaseBandpass(values, sampleRate, lowHz = 0.7, highHz = 3.5) {
    if (!values.length || sampleRate <= 0)
        return values.slice();
    const forward = new Bandpass(sampleRate, lowHz, highHz);
    const a = values.map((v) => forward.process(v));
    a.reverse();
    const backward = new Bandpass(sampleRate, lowHz, highHz);
    const b = a.map((v) => backward.process(v));
    b.reverse();
    return b;
}
/**
 * In-band spectral SNR (linear): peak power in the cardiac band divided by the
 * band's mean power, via a Hann-windowed DFT evaluated on a coarse frequency
 * grid. ~1 means no usable pulse peak; higher means a clean periodic signal.
 * Used to weight ROIs by quality and to gate HR/HRV display.
 */
export function spectralSnr(signal, sampleRate, minHz = 0.7, maxHz = 3.5) {
    const n = signal.length;
    if (n < 30 || sampleRate <= 0)
        return 0;
    const avg = mean(signal);
    const x = signal.map((v) => v - avg);
    const step = 0.05; // ~3 bpm resolution
    let peak = 0;
    let sum = 0;
    let count = 0;
    for (let hz = minHz; hz <= maxHz; hz += step) {
        const omega = (2 * Math.PI * hz) / sampleRate;
        let re = 0;
        let im = 0;
        for (let i = 0; i < n; i++) {
            const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1)); // Hann
            const val = x[i] * w;
            re += val * Math.cos(omega * i);
            im += val * Math.sin(omega * i);
        }
        const p = re * re + im * im;
        if (p > peak)
            peak = p;
        sum += p;
        count++;
    }
    const meanP = count > 0 ? sum / count : 0;
    return meanP > 0 ? peak / meanP : 0;
}
function mean(values) {
    if (!values.length)
        return 0;
    let total = 0;
    for (let i = 0; i < values.length; i++) {
        total += values[i];
    }
    return total / values.length;
}
function standardDeviation(values) {
    if (values.length < 2)
        return 0;
    const avg = mean(values);
    let total = 0;
    for (let i = 0; i < values.length; i++) {
        const delta = values[i] - avg;
        total += delta * delta;
    }
    return Math.sqrt(total / values.length);
}
