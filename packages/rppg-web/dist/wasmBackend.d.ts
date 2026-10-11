export type WasmModule = {
    RppgPipeline?: any;
    WasmRppgPipeline?: any;
    default?: any;
};
export type Backend = {
    newPipeline: (sampleRate: number, windowSec: number) => any;
};
export type WasmImporter = (url: string) => Promise<WasmModule>;
export type LoadWasmBackendOptions = {
    strict?: boolean;
    jsUrl?: string;
    binaryUrl?: string;
    candidateUrls?: string[];
};
export declare class RppgWasmLoadError extends Error {
    readonly code = "RPPG_WASM_LOAD_FAILED";
    readonly attemptedUrls: string[];
    readonly lastError?: unknown;
    /**
     * Why each URL in `attemptedUrls` failed, in the same order: the error its
     * import or init threw, or an error saying the module loaded but exports
     * no pipeline constructor. `lastError` only keeps the last one thrown.
     */
    readonly errors: unknown[];
    constructor(attemptedUrls: string[], lastError?: unknown, errors?: unknown[]);
}
export declare function loadWasmBackend(importer?: WasmImporter, options?: LoadWasmBackendOptions): Promise<Backend | null>;
export declare function createUnavailableBackend(): Backend;
//# sourceMappingURL=wasmBackend.d.ts.map