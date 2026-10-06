import { Bandpass, ChromPulseModel, PosPulseModel, spectralSnr, } from "./rppgSignalModel.js";
export const FUSION_ROIS = [
    "forehead",
    "leftCheek",
    "rightCheek",
];
const MIN_SKIN_FRACTION = 0.1;
export class MultiRoiRppgFuser {
    constructor(fs = 30, windowSeconds = 8, updateEverySeconds = 0.5, projection = "pos") {
        this.fusedBuf = [];
        this.fusedSnr = 0;
        this.frame = 0;
        this.weightEma = 0.3;
        this.fs = fs;
        this.bufLimit = Math.max(60, Math.round(fs * windowSeconds));
        this.minSamples = Math.round(fs * 3);
        this.updateEvery = Math.max(1, Math.round(fs * updateEverySeconds));
        this.chrom = this.makeRecord(() => projection === "chrom" ? new ChromPulseModel() : new PosPulseModel());
        this.band = this.makeRecord(() => new Bandpass(fs, 0.7, 4.0));
        this.buf = this.makeRecord(() => []);
        this.weights = this.makeRecord(() => 1 / FUSION_ROIS.length);
        this.snr = this.makeRecord(() => 0);
    }
    makeRecord(make) {
        return {
            forehead: make(),
            leftCheek: make(),
            rightCheek: make(),
        };
    }
    reset() {
        for (const roi of FUSION_ROIS) {
            this.chrom[roi].reset();
            this.band[roi].reset();
            this.buf[roi] = [];
            this.weights[roi] = 1 / FUSION_ROIS.length;
            this.snr[roi] = 0;
        }
        this.fusedBuf = [];
        this.fusedSnr = 0;
        this.frame = 0;
    }
    pushFrame(samples) {
        this.frame++;
        const filtered = {
            forehead: null,
            leftCheek: null,
            rightCheek: null,
        };
        for (const roi of FUSION_ROIS) {
            const s = samples[roi];
            if (!s ||
                (s.skinFraction != null && s.skinFraction < MIN_SKIN_FRACTION)) {
                continue;
            }
            const chromVal = this.chrom[roi].process(s.r, s.g, s.b);
            const f = this.band[roi].process(chromVal);
            filtered[roi] = f;
            const buf = this.buf[roi];
            buf.push(f);
            if (buf.length > this.bufLimit)
                buf.shift();
        }
        if (this.frame % this.updateEvery === 0) {
            this.updateWeights();
        }
        // Weighted sum over the ROIs present this frame, renormalized so a missing
        // region doesn't dim the fused amplitude.
        let acc = 0;
        let wsum = 0;
        for (const roi of FUSION_ROIS) {
            const f = filtered[roi];
            if (f == null)
                continue;
            acc += this.weights[roi] * f;
            wsum += this.weights[roi];
        }
        const valid = wsum > 0;
        const fused = valid ? acc / wsum : 0;
        if (valid) {
            this.fusedBuf.push(fused);
            if (this.fusedBuf.length > this.bufLimit)
                this.fusedBuf.shift();
        }
        return {
            fused,
            valid,
            weights: { ...this.weights },
            snr: { ...this.snr },
            fusedSnr: this.fusedSnr,
        };
    }
    updateWeights() {
        const raw = {
            forehead: 0,
            leftCheek: 0,
            rightCheek: 0,
        };
        let total = 0;
        for (const roi of FUSION_ROIS) {
            const buf = this.buf[roi];
            const snr = buf.length >= this.minSamples ? spectralSnr(buf, this.fs) : 0;
            this.snr[roi] = snr;
            // Weight by SNR above the noise floor (SNR ~1 means no usable peak).
            const w = Math.max(0, snr - 1);
            raw[roi] = w;
            total += w;
        }
        const target = {
            forehead: 0,
            leftCheek: 0,
            rightCheek: 0,
        };
        if (total > 0) {
            for (const roi of FUSION_ROIS)
                target[roi] = raw[roi] / total;
        }
        else {
            // No region has a usable peak yet — fall back to equal weighting.
            for (const roi of FUSION_ROIS)
                target[roi] = 1 / FUSION_ROIS.length;
        }
        let s = 0;
        for (const roi of FUSION_ROIS) {
            this.weights[roi] =
                this.weights[roi] * (1 - this.weightEma) + target[roi] * this.weightEma;
            s += this.weights[roi];
        }
        if (s > 0)
            for (const roi of FUSION_ROIS)
                this.weights[roi] /= s;
        // Quality scalar: SNR of the fused signal itself (what actually drives HR/HRV).
        this.fusedSnr =
            this.fusedBuf.length >= this.minSamples
                ? spectralSnr(this.fusedBuf, this.fs)
                : 0;
    }
}
