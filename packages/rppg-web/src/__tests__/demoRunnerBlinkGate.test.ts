import { DemoRunner } from "../demoRunner";
import type { Frame, FrameSource } from "../frameSource";
import { PulseCheck } from "../pulseCheck";

// DemoRunner hands the face frame source the check's own blink gate, so a still face is reused for longer only once
// the gate the check enforces has its blink (mediaPipeFaceFrameSource LANDMARK_STILL_REUSE_*).
class Source implements FrameSource {
	onFrame: ((frame: Frame) => void) | null = null;
	blinkGateOpen: () => boolean = () => false;
	async start(): Promise<void> {}
	async stop(): Promise<void> {}
}
const proc = { pushFusedSample: jest.fn(), pushSampleRgbMeta: jest.fn(), getMetrics: () => ({ bpm: null }), getBackendFailure: () => null, reset: jest.fn(), resetSignal: jest.fn() };

test("the source asks the check: closed until a blink, open with the rule off", () => {
	const gated = new Source();
	const check = new PulseCheck({ rules: { blinkGate: true } });
	new DemoRunner(gated, proc as never, { pulseChecker: check });
	expect(gated.blinkGateOpen()).toBe(false);
	expect(check.blinkGateOpen).toBe(false);
	const free = new Source();
	new DemoRunner(free, proc as never, { pulseChecker: new PulseCheck({ rules: { blinkGate: false } }) });
	expect(free.blinkGateOpen()).toBe(true);
});

test("without a check the source keeps its own default (never the longer reuse)", () => {
	const s = new Source();
	new DemoRunner(s, proc as never, {});
	expect(s.blinkGateOpen()).toBe(false);
});
