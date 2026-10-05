import { DemoRunner } from '../demoRunner';
import { FrameSource, Frame } from '../frameSource';

// The fuser and the processor are built for one sample rate (sampleRate, 30 by default) and
// read the samples they get as evenly spaced at that rate. A laptop camera in dim light
// delivers 15 to 25 frames a second, so without filling the gaps every rate they report is
// scaled by delivered/assumed. Measured on 255 real recordings (MCD-rPPG, finger-sensor truth):
// camera slowed to 16 fps, SDK right 17% of seconds; gaps filled onto the 30 Hz grid, 26%,
// the same as the full-rate camera.

class MockFrameSource implements FrameSource {
  onFrame: ((frame: Frame) => void) | null = null;
  async start(): Promise<void> {}
  async stop(): Promise<void> {}
  emit(frame: Frame) { this.onFrame?.(frame); }
}

function skinFrame(timestampMs: number, green = 150): Frame {
  const width = 30, height = 30;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) { data[i] = 200; data[i + 1] = green; data[i + 2] = 120; data[i + 3] = 255; }
  return {
    data, width, height, timestampMs,
    rois: [{ x: 0, y: 0, w: 10, h: 10 }, { x: 10, y: 10, w: 10, h: 10 }, { x: 20, y: 0, w: 10, h: 10 }],
  };
}

// Timestamps in the order the processor received them (not sorted: order is part of the contract).
async function run(frameTimes: number[], sampleRate = 30, noRoisAt: number[] = []) {
  const src = new MockFrameSource();
  const order: number[] = [];
  const push = (t: number) => { order.push(t); };
  const proc = { pushFusedSample: jest.fn(push), pushSampleRgbMeta: jest.fn(push), getMetrics: jest.fn() };
  const runner = new DemoRunner(src as any, proc as any, { useSkinMask: true, multiRoiFusion: true, sampleRate });
  await runner.start();
  for (const t of frameTimes) {
    const f = skinFrame(t);
    if (noRoisAt.includes(t)) { delete (f as any).rois; f.roi = { x: 0, y: 0, w: 30, h: 30 }; }
    src.emit(f);
  }
  await runner.stop();
  return order;
}

describe('DemoRunner feeds the fuser and processor at the rate they were built for', () => {
  test('a 15 fps camera is filled in to 30 evenly spaced samples a second', async () => {
    const times = Array.from({ length: 31 }, (_, i) => 1000 + i * (1000 / 15));
    const ts = await run(times);
    expect(ts.length).toBe(61);
    for (let i = 1; i < ts.length; i++) expect(ts[i] - ts[i - 1]).toBeCloseTo(1000 / 30, 6);
  });

  test('a camera already at the assumed rate gets one sample per frame', async () => {
    const times = Array.from({ length: 30 }, (_, i) => 1000 + i * (1000 / 30));
    expect((await run(times)).length).toBe(30);
  });

  test('the grid follows the rate the processor was told', async () => {
    const times = Array.from({ length: 11 }, (_, i) => 1000 + i * 100);
    const ts = await run(times, 20);
    expect(ts.length).toBe(21);
    for (let i = 1; i < ts.length; i++) expect(ts[i] - ts[i - 1]).toBeCloseTo(50, 6);
  });

  test('a frame without regions between two that have them never sends time backwards', async () => {
    const ts = await run([1000, 1100, 1200, 1300], 30, [1100]);
    for (let i = 1; i < ts.length; i++) expect(ts[i]).toBeGreaterThan(ts[i - 1]);
  });

  test('a stall is not bridged: no samples are invented across a long gap', async () => {
    const ts = await run([1000, 1033, 2500, 2533]);
    expect(ts.filter((t) => t > 1100 && t < 2500)).toEqual([]);
  });
});
