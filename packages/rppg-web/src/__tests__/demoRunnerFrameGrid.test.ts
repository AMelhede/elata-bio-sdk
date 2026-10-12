import { DemoRunner } from '../demoRunner';
import { FrameSource, Frame } from '../frameSource';
import { MultiRoiRppgFuser } from '../multiRoiFusion';

// The multi-region fuser's band-pass, its spectral SNR, its projection window and its warm-up
// are all counted in samples at `sampleRate`. Camera frames arrive at whatever rate the camera
// and the page manage, so with `realFrameRate` on (the default) DemoRunner interpolates each
// region onto an even `sampleRate` grid before fusing. These tests check what that is for: the
// fuser sees a pulse at its real frequency and warms up in real seconds whatever the camera
// rate, and nothing else about the runner changes (the processor's push API, the frame counts).

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

  test('a grid time halfway between two frames gets each region halfway between them', async () => {
    const spy = jest.spyOn(MultiRoiRppgFuser.prototype, 'pushFrame');
    try {
      const src = new MockFrameSource();
      const proc = { pushFusedSample: jest.fn(), getMetrics: jest.fn() };
      const runner = new DemoRunner(src as any, proc as any, { useSkinMask: true, sampleRate: 30 });
      await runner.start();
      src.emit(skinFrame(1000, 140));
      src.emit(skinFrame(1000 + 1000 / 15, 150));
      await runner.stop();
      const greens = spy.mock.calls.map(([regions]) => regions.forehead?.g);
      expect(greens).toHaveLength(3);
      expect(greens[0]).toBeCloseTo(140 / 255, 6);
      expect(greens[1]).toBeCloseTo(145 / 255, 6);
      expect(greens[2]).toBeCloseTo(150 / 255, 6);
    } finally {
      spy.mockRestore();
    }
  });
});

describe('a processor without pushFusedSample still gets every grid sample', () => {
  // DemoRunner duck-types its processor, so on the fusion grid the fallback chain is the same
  // as on every other path: rgb_meta, then rgb, then intensity, then a processor error. An app's
  // own processor with only pushSampleRgb used to get no sample at all here, with no error and
  // samplesPushed still counting every frame.
  test.each([
    ['pushSampleRgb', 'rgb', (args: any[]) => args[2]],
    ['pushSample', 'intensity', (args: any[]) => args[1]],
  ] as const)('%s only', async (method, expectedMethod, greenOf) => {
    const src = new MockFrameSource();
    const proc: any = { getMetrics: jest.fn(), [method]: jest.fn() };
    const runner = new DemoRunner(src as any, proc, { useSkinMask: true, sampleRate: 30 });
    await runner.start();
    src.emit(skinFrame(1000, 140));
    src.emit(skinFrame(1000 + 1000 / 15, 150));
    await runner.stop();
    const calls = proc[method].mock.calls as any[][];
    const times = calls.map((args) => args[0]);
    expect(times).toHaveLength(3);
    [1000, 1000 + 1000 / 30, 1000 + 1000 / 15].forEach((t, i) => expect(times[i]).toBeCloseTo(t, 6));
    expect(greenOf(calls[1])).toBeCloseTo(145 / 255, 6);
    expect(runner.getDiagnostics().lastProcessorMethod).toBe(expectedMethod);
    // Both frames went through the fuser's grid, but none of its output reached the processor.
    expect(runner.getDiagnostics().framesWithFusion).toBe(0);
    expect(runner.getLastError()).toBeNull();
  });

  test('no push method at all is a processor error, not silence', async () => {
    const src = new MockFrameSource();
    const onError = jest.fn();
    const runner = new DemoRunner(src as any, { getMetrics: jest.fn() } as any, { useSkinMask: true, sampleRate: 30, onError });
    await runner.start();
    src.emit(skinFrame(1000));
    await runner.stop();
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: 'processor_error', message: 'processor has no push sample API' }));
    expect(runner.getDiagnostics().lastDropReason).toBe('processor_error');
  });

  test('with realFrameRate off the same processor gets one sample per frame, as published', async () => {
    const src = new MockFrameSource();
    const proc = { getMetrics: jest.fn(), pushSampleRgb: jest.fn() };
    const runner = new DemoRunner(src as any, proc as any, { useSkinMask: true, sampleRate: 30, fixes: { realFrameRate: false } });
    await runner.start();
    for (const t of framesAt(15, 31)) src.emit(skinFrame(t));
    await runner.stop();
    expect(proc.pushSampleRgb).toHaveBeenCalledTimes(31);
    expect(runner.getDiagnostics().lastProcessorMethod).toBe('rgb');
  });
});

describe('runner diagnostics still count camera frames', () => {
  // samplesPushed and framesWithFusion count frames, not grid samples, so a slow camera does not
  // make framesWithFusion exceed framesWithMultiRoi and a fast one does not make it fall short.
  test.each([15, 60])('at %i fps', async (fps) => {
    const src = new MockFrameSource();
    const proc = { pushFusedSample: jest.fn(), getMetrics: jest.fn() };
    const runner = new DemoRunner(src as any, proc as any, { useSkinMask: true, sampleRate: 30 });
    await runner.start();
    for (const t of framesAt(fps, 31)) src.emit(skinFrame(t));
    const d = runner.getDiagnostics();
    await runner.stop();
    expect(d.framesSeen).toBe(31);
    expect(d.samplesPushed + d.droppedFrames).toBe(d.framesSeen);
    // Every frame here has three skin regions, so every one goes through the fuser.
    expect(d.framesWithFusion).toBe(d.framesWithMultiRoi);
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

async function filmPulse(fps: number, bpm: number, seconds: number, realFrameRate = true): Promise<FusedPush[]> {
  const src = new MockFrameSource();
  const pushes: FusedPush[] = [];
  const proc = { pushFusedSample: (t: number, value: number, snr: number) => { pushes.push({ t, value, snr }); }, getMetrics: jest.fn() };
  const runner = new DemoRunner(src as any, proc as any, { useSkinMask: true, sampleRate: 30, fixes: { realFrameRate } });
  await runner.start();
  const r = rng(1);
  for (const t of framesAt(fps, Math.floor(seconds * fps) + 1, 0)) src.emit(pulseFrame(t, bpm, r));
  await runner.stop();
  return pushes;
}

// Amplitude of the component at `bpm`, by a single DFT bin evaluated at the real timestamps.
function amplitudeAt(pushes: FusedPush[], bpm: number): number {
  const mean = pushes.reduce((a, p) => a + p.value, 0) / pushes.length;
  let re = 0, im = 0;
  for (const p of pushes) {
    const phase = 2 * Math.PI * (bpm / 60) * (p.t / 1000);
    re += (p.value - mean) * Math.cos(phase);
    im += (p.value - mean) * Math.sin(phase);
  }
  return (2 * Math.hypot(re, im)) / pushes.length;
}

describe('the fuser sees the pulse in real time, whatever the camera rate', () => {
  const BPM = 160;
  let at30: FusedPush[];
  let at15: FusedPush[];
  beforeAll(async () => {
    at30 = await filmPulse(30, BPM, 20);
    at15 = await filmPulse(15, BPM, 20);
  });

  test('a 160 bpm pulse filmed at 15 fps keeps its fused amplitude', () => {
    // Fed one sample per frame, the fuser (designed for 30 Hz) reads 2.67 Hz as 5.33 Hz, where
    // its 4 Hz Butterworth low-pass passes 0.45 of the amplitude against 0.92 at the real
    // frequency, so the 15 fps amplitude falls to about half the 30 fps one. On the grid the
    // only loss is linear interpolation's, (1 + cos(pi * 2.67 / 15)) / 2 = 0.92.
    const settled = (p: FusedPush) => p.t > 8000;
    const ratio = amplitudeAt(at15.filter(settled), BPM) / amplitudeAt(at30.filter(settled), BPM);
    expect(ratio).toBeGreaterThan(0.8);
    expect(ratio).toBeLessThan(1.2);
  });

  test('the fused signal quality warms up in the same real time at 15 fps as at 30 fps', () => {
    const firstQuality = (pushes: FusedPush[]) => pushes.find((p) => p.snr > 0)?.t ?? Number.NaN;
    expect(Number.isFinite(firstQuality(at30))).toBe(true);
    // Within one 15 fps frame: the warm-up is 3 s of samples plus the 0.5 s weight cadence.
    expect(Math.abs(firstQuality(at15) - firstQuality(at30))).toBeLessThanOrEqual(1000 / 15);
  });

  test('with realFrameRate off, as published, the 15 fps pulse loses about half and the warm-up doubles', async () => {
    // The README's numbers for the switch off (0.50 of the fused strength, 6.9 s against 3.5 s).
    const off30 = await filmPulse(30, BPM, 20, false);
    const off15 = await filmPulse(15, BPM, 20, false);
    const settled = (p: FusedPush) => p.t > 8000;
    const ratio = amplitudeAt(off15.filter(settled), BPM) / amplitudeAt(off30.filter(settled), BPM);
    expect(ratio).toBeGreaterThan(0.4);
    expect(ratio).toBeLessThan(0.6);
    const firstQuality = (pushes: FusedPush[]) => pushes.find((p) => p.snr > 0)?.t ?? Number.NaN;
    expect(firstQuality(off30)).toBeCloseTo(3467, -1);
    expect(firstQuality(off15)).toBeCloseTo(6933, -1);
  });
});
