/**
 * Creates the analysis worker. Kept alone in this file because bundlers (Vite, webpack 5)
 * recognise exactly this `new Worker(new URL("...", import.meta.url))` shape and bundle the
 * worker from it; tests replace this module, since their CommonJS build has no import.meta.
 */
export declare function createProcessorWorker(): Worker;
//# sourceMappingURL=processorWorkerUrl.d.ts.map