// The per-frame region memo keys samplers by identity: a custom sampler whose id happens to equal the
// default's key must not hand its output to a reader that asked for the default skin mean.
import { DemoRunner } from "../demoRunner";
test("a custom sampler with id \"d\" does not stand in for the default sampler in the pulse check", async () => {
	const W = 64, H = 64;
	const data = new Uint8ClampedArray(W * H * 4);
	for (let i = 0; i < data.length; i += 4) { data[i] = 200; data[i + 1] = 140; data[i + 2] = 120; data[i + 3] = 255; } // skin-like
	const custom = { id: "d", sample: () => ({ r: 0.9, g: 0.9, b: 0.9, skinFraction: 1, effectiveSkinFraction: 1, clipRatio: 0, meanLuma: 0, lumaStd: 0, pixelCount: 1, skinPixelCount: 1, usedSkinPixels: true }) };
	const pushed: unknown[] = [];
	const checker = { push: (_t: number, regions: unknown[]) => pushed.push(regions), faceLost: () => {}, agreementOn: false, secondOpinion: () => {} };
	const src: any = { onFrame: null, start: async () => {}, stop: async () => {} };
	const proc = { pushSampleRgbMeta: jest.fn(), pushSampleRgb: jest.fn(), pushSample: jest.fn(), getMetrics: jest.fn(() => ({ bpm: null })) };
	const r = new DemoRunner(src, proc as never, { roiPixelSampler: custom as never, pulseChecker: checker as never, multiRoiFusion: false });
	await r.start();
	const rois = [{ x: 0, y: 0, w: 20, h: 20 }, { x: 20, y: 0, w: 20, h: 20 }, { x: 40, y: 0, w: 20, h: 20 }];
	src.onFrame({ data, width: W, height: H, timestampMs: 1000, rois });
	const first = (pushed[0] as Array<{ r: number }>)[0];
	expect(first.r).toBeCloseTo(200 / 255, 4);
});
