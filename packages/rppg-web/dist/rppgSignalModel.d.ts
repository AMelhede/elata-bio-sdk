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
export declare function spectralSnr(signal: number[], sampleRate: number, minHz?: number, maxHz?: number): number;
//# sourceMappingURL=rppgSignalModel.d.ts.map