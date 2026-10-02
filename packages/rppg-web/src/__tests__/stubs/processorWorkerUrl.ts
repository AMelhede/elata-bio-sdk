// Test stand-in for ../../processorWorkerUrl.ts, whose import.meta the CommonJS test build
// cannot compile. No test starts a real worker; tests pass their own via createWorker.
export function createProcessorWorker(): Worker {
	throw new Error("no real worker in tests");
}
