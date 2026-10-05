import { DemoRunner } from '../demoRunner';
import { FrameSource, Frame } from '../frameSource';

// With face tracking on, a frame with no face in it must not be read. Every published rppg-web
// (0.1.1 to 0.14.0) instead read a 100x100 square in the middle of the frame and kept reporting a
// heart rate: real footage of a plain wall, demo settings, a rate shown in 27 of 41 seconds.

class MockFrameSource implements FrameSource {
  onFrame: ((frame: Frame) => void) | null = null;
  async start(): Promise<void> {}
  async stop(): Promise<void> {}
  emit(frame: Frame) { this.onFrame?.(frame); }
}

function wallFrame(timestampMs: number): Frame {
  const width = 30, height = 30;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) { data[i] = 200; data[i + 1] = 150; data[i + 2] = 120; data[i + 3] = 255; }
  return { data, width, height, timestampMs };
}

async function feedWall(requireFace: boolean | undefined) {
  const src = new MockFrameSource();
  const proc = { pushFusedSample: jest.fn(), pushSampleRgbMeta: jest.fn(), getMetrics: jest.fn(), reset: jest.fn() };
  const runner = new DemoRunner(src as any, proc as any, { sampleRate: 30, ...(requireFace === undefined ? {} : { requireFace }) });
  await runner.start();
  for (let i = 0; i < 60; i++) src.emit(wallFrame(1000 + i * 33.3));
  return { proc, runner };
}

describe('DemoRunner with no face in view', () => {
  test('does not read the frame when face tracking is on', async () => {
    const { proc, runner } = await feedWall(true);
    expect(proc.pushSampleRgbMeta).not.toHaveBeenCalled();
    expect(proc.pushFusedSample).not.toHaveBeenCalled();
    expect(runner.getDiagnostics().lastDropReason).toBe('no_face');
  });

  test('says the face has been gone, measured from the first frame without one', async () => {
    const { runner } = await feedWall(true);
    expect(runner.faceAbsentMs(1000 + 59 * 33.3)).toBeGreaterThanOrEqual(1900);
    expect(runner.faceAbsentMs(1000)).toBe(0);
  });

  test('still reads the centre of the frame when face tracking is off (whole-frame mode)', async () => {
    const { proc } = await feedWall(undefined);
    expect(proc.pushSampleRgbMeta).toHaveBeenCalled();
  });

  test('restarts the analysis when the face returns after a second or more', async () => {
    const { proc, runner } = await feedWall(true);
    const face = { ...wallFrame(1000 + 60 * 33.3), roi: { x: 0, y: 0, w: 30, h: 30 } };
    (runner as any).source.onFrame?.(face);
    expect(proc.reset).toHaveBeenCalledTimes(1);
    expect(runner.faceAbsentMs()).toBe(0);
  });

  test('a brief face-finder miss does not restart the analysis', async () => {
    const src = new MockFrameSource();
    const proc = { pushFusedSample: jest.fn(), pushSampleRgbMeta: jest.fn(), getMetrics: jest.fn(), reset: jest.fn() };
    const runner = new DemoRunner(src as any, proc as any, { sampleRate: 30, requireFace: true });
    await runner.start();
    for (let i = 0; i < 10; i++) src.emit(wallFrame(1000 + i * 33.3));
    src.emit({ ...wallFrame(1400), roi: { x: 0, y: 0, w: 30, h: 30 } });
    expect(proc.reset).not.toHaveBeenCalled();
  });

  test('an empty frame is reported as invalid, not as no face', async () => {
    const src = new MockFrameSource();
    const proc = { pushFusedSample: jest.fn(), pushSampleRgbMeta: jest.fn(), getMetrics: jest.fn() };
    const runner = new DemoRunner(src as any, proc as any, { sampleRate: 30, requireFace: true });
    await runner.start();
    src.emit({ data: new Uint8ClampedArray(0), width: 0, height: 0, timestampMs: 1000 });
    expect(runner.getDiagnostics().lastDropReason).toBe('frame_invalid');
  });
});
