export declare class ChannelGainController {
    private baseline;
    private initialized;
    private readonly targetLevel;
    reset(): void;
    process(r: number, g: number, b: number): {
        r: number;
        g: number;
        b: number;
    };
}
export declare class ChromPulseModel {
    private readonly windowSize;
    private rQueue;
    private gQueue;
    private bQueue;
    constructor(windowSize?: number);
    reset(): void;
    process(r: number, g: number, b: number): number;
}
/**
 * POS (plane-orthogonal-to-skin, Wang et al., IEEE TBME 2017), streaming over the same
 * sliding window as {@link ChromPulseModel}. On mean-normalised channels, S1 = G - B and
 * S2 = G + B - 2R, and the pulse is h = S1 + (sd S1 / sd S2) S2. The plane is orthogonal
 * to the skin's own colour, so a brightness change (all channels scaled together) cannot
 * reach the output, where CHROM's fixed skin-tone weights let part of it through. The
 * 45-sample window is 1.5 s at 30 Hz, the paper's 1.6 s.
 */
export declare class PosPulseModel {
    private readonly windowSize;
    private rQueue;
    private gQueue;
    private bQueue;
    constructor(windowSize?: number);
    reset(): void;
    process(r: number, g: number, b: number): number;
}
export declare function computeSignalSnrDb(values: number[]): number;
/**
 * Streaming cardiac bandpass: a high-pass at `lowHz` cascaded with a low-pass
 * at `highHz`. Feed one sample per frame via {@link process}.
 */
export declare class Bandpass {
    private readonly hp;
    private readonly lp;
    constructor(sampleRate: number, lowHz?: number, highHz?: number);
    reset(): void;
    process(value: number): number;
}
/**
 * Zero-phase bandpass via forward-backward filtering (filtfilt). Filtering
 * twice in opposite directions cancels the phase response, so beat timing is
 * not shifted by the filter — at the cost of being offline (whole-buffer).
 */
export declare function zeroPhaseBandpass(values: number[], sampleRate: number, lowHz?: number, highHz?: number): number[];
/**
 * The processor's own pulse signal from camera colour (switch `rgbPulse`): POS ({@link PosPulseModel}), then the
 * 0.7 to 4 Hz band-pass the multi-region fuser applies to each region, so the processor's window estimators get from
 * a colour feed the same kind of signal the fuser gives them. The fuser runs on the runner's even sample grid; colour
 * pushed to the processor directly arrives at the camera's own rate, so the band-pass is designed for the rate
 * measured from the timestamps: intervals per second of the intervals over the last 45 samples, leaving out stalls
 * over 250 ms (the mean, not the median: camera frames come on a 16 ms clock, 32, 48 or 64 ms apart, where the median
 * interval sits a few frames a second off the real rate).
 *
 * Until the projection has 10 samples the value is 0, the projection's own neutral value, never a colour level. A
 * sample with R = G = B is already one value (the WASM core's colour projection fix treats it the same way) and
 * passes unchanged.
 */
export declare class RgbPulseExtractor {
    private readonly pos;
    private band;
    private bandRate;
    private times;
    /** The sample rate the band-pass is designed for; 0 until it is designed. */
    get filterRate(): number;
    reset(): void;
    process(timestampMs: number, r: number, g: number, b: number): number;
    private measuredRate;
}
export declare function spectralSnr(signal: number[], sampleRate: number, minHz?: number, maxHz?: number): number;
//# sourceMappingURL=rppgSignalModel.d.ts.map