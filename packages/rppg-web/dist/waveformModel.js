export class WaveformModelError extends Error {
    constructor(code, message) {
        super(message);
        this.code = code;
        this.name = "WaveformModelError";
    }
}
