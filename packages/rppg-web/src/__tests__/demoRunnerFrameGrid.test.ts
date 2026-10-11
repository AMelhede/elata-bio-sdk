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

function framesAt(fps: number, count: number, startMs = 1000): number[] {
  return Array.from({ length: count }, (_, i) => startMs + i * (1000 / fps));
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

  test('a clock that starts again from zero (a looping video file) keeps feeding the processor', async () => {
    // Each frame whose timestamp does not increase restarts the grid at its own time. Waiting
    // for the clock to pass the old grid time instead would push nothing for as long as the
    // first run lasted.
    const ts = await run([...framesAt(30, 30, 1000), ...framesAt(30, 30, 0)]);
    const afterRestart = ts.filter((t) => t < 1000);
    expect(afterRestart).toHaveLength(30);
    expect(afterRestart[0]).toBe(0);
  });

  test('stop and start do not draw a line back to the previous run', async () => {
    const src = new MockFrameSource();
    const order: number[] = [];
    const push = (t: number) => { order.push(t); };
    const proc = { pushFusedSample: jest.fn(push), pushSampleRgbMeta: jest.fn(push), getMetrics: jest.fn() };
    const runner = new DemoRunner(src as any, proc as any, { useSkinMask: true, sampleRate: 30 });
    await runner.start();
    src.emit(skinFrame(1000));
    src.emit(skinFrame(1000 + 1000 / 30));
    await runner.stop();
    order.length = 0;
    await runner.start();
    src.emit(skinFrame(1100 + 1000 / 30));
    await runner.stop();
    expect(order).toEqual([1100 + 1000 / 30]);
  });

  test('framesWithFusion stays 0 when the processor has no pushFusedSample', async () => {
    // Every frame here goes through the fuser's grid, but none of its output reaches the
    // processor, which takes the region mean through pushSampleRgbMeta instead.
    const src = new MockFrameSource();
    const proc = { pushSampleRgbMeta: jest.fn(), getMetrics: jest.fn() };
    const runner = new DemoRunner(src as any, proc as any, { useSkinMask: true, sampleRate: 30 });
    await runner.start();
    for (const t of framesAt(30, 120)) src.emit(skinFrame(t));
    const d = runner.getDiagnostics();
    await runner.stop();
    expect(proc.pushSampleRgbMeta).toHaveBeenCalledTimes(120);
    expect(d.framesWithMultiRoi).toBe(120);
    expect(d.lastProcessorMethod).toBe('rgb_meta');
    expect(d.framesWithFusion).toBe(0);
  });
});

// A chromatic pulse: rising blood volume dims green most, red and blue less (relative
// modulation 0.77 : 0.33 : 0.53, 1% peak on green), plus seeded sensor noise so the
// 8-bit pixels dither and the region means carry the sub-LSB pulse.
function rng(seed: number) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
function gauss(r: () => number) { const u = Math.max(1e-12, r()); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r()); }
const SIDE = 24;
function pulseFrame(t: number, bpm: number, r: () => number): Frame {
  const width = SIDE * 3, height = SIDE;
  const data = new Uint8ClampedArray(width * height * 4);
  const s = Math.sin(2 * Math.PI * (bpm / 60) * (t / 1000));
  const base = [200, 150, 120], depth = [0.33, 0.77, 0.53];
  for (let i = 0; i < data.length; i += 4) {
    for (let c = 0; c < 3; c++) data[i + c] = Math.round(base[c] * (1 - 0.01 * depth[c] * s) + gauss(r));
    data[i + 3] = 255;
  }
  return { data, width, height, timestampMs: t, rois: [0, 1, 2].map((k) => ({ x: k * SIDE, y: 0, w: SIDE, h: SIDE })) };
}

type FusedPush = { t: number; value: number; snr: number };

test('a frame with no usable timestamp costs that frame only, not the rest of the session', async () => {
  // The fuser's filters keep state, so one NaN reaching them stays there. A NaN timestamp must
  // restart the grid like any other timestamp that does not increase, not become an
  // interpolation weight for the next frame's grid times.
  const src = new MockFrameSource();
  const pushes: FusedPush[] = [];
  const proc = { pushFusedSample: (t: number, value: number, snr: number) => { pushes.push({ t, value, snr }); }, getMetrics: jest.fn() };
  const runner = new DemoRunner(src as any, proc as any, { useSkinMask: true, sampleRate: 30 });
  await runner.start();
  const r = rng(1);
  const times = framesAt(30, 241, 0);
  times.forEach((t, i) => {
    const frame = pulseFrame(t, 72, r);
    if (i === 30) frame.timestampMs = Number.NaN;
    src.emit(frame);
  });
  const d = runner.getDiagnostics();
  await runner.stop();
  const after = pushes.filter((p) => p.t > times[31]);
  expect(after.length).toBeGreaterThan(200);
  expect(after.filter((p) => !Number.isFinite(p.value))).toEqual([]);
  expect(d.lastFusedSnr).toBeGreaterThan(1);
});
