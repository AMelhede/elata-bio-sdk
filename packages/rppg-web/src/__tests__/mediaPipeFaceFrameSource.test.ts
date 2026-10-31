import { MediaPipeFaceFrameSource } from '../mediaPipeFaceFrameSource';
import { Frame } from '../frameSource';
import { computeFusionSubRois } from '../faceRoiOverlay';
import type { FaceLandmarkerLike, FaceLandmarkerResult } from '../mediapipeLoader';

class FakeCtx {
  private data: Uint8ClampedArray;
  width: number;
  height: number;
  constructor(width: number, height: number, fillValue = 128) {
    this.width = width;
    this.height = height;
    const n = width * height * 4;
    this.data = new Uint8ClampedArray(n);
    for (let i = 0; i < n; i += 4) {
      this.data[i] = 0;
      this.data[i + 1] = fillValue;
      this.data[i + 2] = 0;
      this.data[i + 3] = 255;
    }
  }
  drawImage() {}
  getImageData(_x: number, _y: number, w: number, h: number) {
    return { data: this.data.slice(0, w * h * 4) } as ImageData;
  }
}

class FakeCanvas {
  width: number;
  height: number;
  private ctx: FakeCtx;
  constructor(w: number, h: number, fillValue = 128) {
    this.width = w;
    this.height = h;
    this.ctx = new FakeCtx(w, h, fillValue);
  }
  getContext(_name: string) {
    return this.ctx as unknown as CanvasRenderingContext2D;
  }
}

class FakeVideo {
  videoWidth: number;
  videoHeight: number;
  constructor(w: number, h: number) { this.videoWidth = w; this.videoHeight = h; }
}

function setupCanvasMock(w: number, h: number) {
  const origCreate = document.createElement.bind(document);
  document.createElement = ((tag: string) =>
    tag === 'canvas'
      ? (new FakeCanvas(w, h) as unknown as HTMLCanvasElement)
      : origCreate(tag)) as any;
  return () => { document.createElement = origCreate; };
}

type Lm = { x: number; y: number };

/** Build a FaceLandmarker mock that returns the given landmarks/blendshapes on each detect. */
function fakeLandmarker(
  results: Array<{ landmarks?: Lm[]; blendshapes?: { categoryName: string; score: number }[] }>,
): FaceLandmarkerLike & { detectForVideo: jest.Mock } {
  let i = 0;
  const detectForVideo = jest.fn((): FaceLandmarkerResult => {
    const r = results[Math.min(i, results.length - 1)];
    i += 1;
    return {
      faceLandmarks: r.landmarks ? [r.landmarks] : [],
      faceBlendshapes: r.blendshapes ? [{ categories: r.blendshapes }] : undefined,
    };
  });
  return { detectForVideo } as any;
}

test('MediaPipeFaceFrameSource computes ROI from landmarks and emits frame with roi', async () => {
  const restore = setupCanvasMock(200, 100);
  const video = new FakeVideo(200, 100) as unknown as HTMLVideoElement;
  const landmarks = [
    { x: 0.45, y: 0.4 },
    { x: 0.55, y: 0.4 },
    { x: 0.5, y: 0.5 },
  ];
  const src = new MediaPipeFaceFrameSource(video, fakeLandmarker([{ landmarks }]), 30);
  const frames: Frame[] = [];
  src.onFrame = (f) => frames.push(f);
  await src.start(); // setTimeout-path: first tick runs synchronously
  await src.stop();

  expect(frames.length).toBeGreaterThan(0);
  const roi = frames[0].roi!;
  expect(roi).toBeDefined();
  expect(roi.x).toBeGreaterThan(30);
  expect(roi.y).toBeGreaterThan(20);
  expect(roi.w).toBeGreaterThan(10);
  expect(roi.h).toBeGreaterThan(10);
  restore();
});

describe('MediaPipeFaceFrameSource edge cases', () => {
  test('no landmarks detected still emits a frame without roi', async () => {
    const restore = setupCanvasMock(200, 100);
    const video = new FakeVideo(200, 100) as unknown as HTMLVideoElement;
    const src = new MediaPipeFaceFrameSource(video, fakeLandmarker([{}]), 30);
    const frames: Frame[] = [];
    src.onFrame = (f) => frames.push(f);
    await src.start();
    await src.stop();

    expect(frames.length).toBeGreaterThan(0);
    expect(frames[0].roi).toBeUndefined();
    restore();
  });

  test('emits blendshapes when the landmarker provides them', async () => {
    const restore = setupCanvasMock(200, 100);
    const video = new FakeVideo(200, 100) as unknown as HTMLVideoElement;
    const landmarks = [
      { x: 0.45, y: 0.4 },
      { x: 0.55, y: 0.4 },
      { x: 0.5, y: 0.5 },
    ];
    const blendshapes = [
      { categoryName: 'mouthSmileLeft', score: 0.8 },
      { categoryName: 'mouthSmileRight', score: 0.8 },
    ];
    const src = new MediaPipeFaceFrameSource(video, fakeLandmarker([{ landmarks, blendshapes }]), 30);
    const frames: Frame[] = [];
    src.onFrame = (f) => frames.push(f);
    await src.start();
    await src.stop();

    expect(frames[0].blendshapes).toBeDefined();
    expect(frames[0].blendshapes!.length).toBe(2);
    expect(frames[0].blendshapes![0].categoryName).toBe('mouthSmileLeft');
    expect(frames[0].landmarks).toBeDefined();
    restore();
  });

  test('emits sub-ROIs (forehead + cheeks) when landmarks present', async () => {
    const restore = setupCanvasMock(400, 400);
    const video = new FakeVideo(400, 400) as unknown as HTMLVideoElement;
    const landmarks = [
      { x: 0.3, y: 0.3 },
      { x: 0.7, y: 0.3 },
      { x: 0.3, y: 0.7 },
      { x: 0.7, y: 0.7 },
      { x: 0.5, y: 0.5 },
    ];
    const src = new MediaPipeFaceFrameSource(video, fakeLandmarker([{ landmarks }]), 30);
    const frames: Frame[] = [];
    src.onFrame = (f) => frames.push(f);
    await src.start();
    await src.stop();

    expect(frames.length).toBeGreaterThan(0);
    const frame = frames[0];
    expect(frame.rois).toBeDefined();
    expect(frame.rois!.length).toBe(3);
    for (const roi of frame.rois!) {
      expect(roi.x).toBeGreaterThanOrEqual(0);
      expect(roi.y).toBeGreaterThanOrEqual(0);
      expect(roi.w).toBeGreaterThanOrEqual(1);
      expect(roi.h).toBeGreaterThanOrEqual(1);
      expect(Number.isInteger(roi.x)).toBe(true);
      expect(Number.isInteger(roi.y)).toBe(true);
    }
    restore();
  });

  test('sampled sub-ROIs match the shared overlay geometry (drawn == sampled)', async () => {
    const restore = setupCanvasMock(400, 400);
    const video = new FakeVideo(400, 400) as unknown as HTMLVideoElement;
    const landmarks = [
      { x: 0.3, y: 0.25 },
      { x: 0.7, y: 0.25 },
      { x: 0.3, y: 0.75 },
      { x: 0.7, y: 0.75 },
      { x: 0.5, y: 0.5 },
    ];
    const src = new MediaPipeFaceFrameSource(video, fakeLandmarker([{ landmarks }]), 30);
    const frames: Frame[] = [];
    src.onFrame = (f) => frames.push(f);
    await src.start();
    await src.stop();

    // The frame source must populate frame.rois from the same geometry the
    // overlay draws, so there is a single source of truth for ROI placement.
    const expected = computeFusionSubRois(landmarks, 400, 400);
    expect(frames[0].rois).toEqual(expected);
    restore();
  });

  test('ROI smoothing across multiple frames converges rather than jumping', async () => {
    const restore = setupCanvasMock(200, 200);
    const video = new FakeVideo(200, 200) as unknown as HTMLVideoElement;
    let vfcCb: any = null;
    (video as any).requestVideoFrameCallback = jest.fn((cb: any) => { vfcCb = cb; return 1; });
    (video as any).cancelVideoFrameCallback = jest.fn();

    const baseLandmarks = [
      { x: 0.4, y: 0.4 },
      { x: 0.6, y: 0.4 },
      { x: 0.5, y: 0.6 },
    ];
    const shiftedLandmarks = baseLandmarks.map((l) => ({ x: l.x + 0.01, y: l.y + 0.01 }));
    const src = new MediaPipeFaceFrameSource(
      video,
      fakeLandmarker([{ landmarks: baseLandmarks }, { landmarks: shiftedLandmarks }]),
      30,
    );
    const frames: Frame[] = [];
    src.onFrame = (f) => frames.push(f);
    await src.start();

    vfcCb(1, { mediaTime: 0 });
    vfcCb(2, { mediaTime: 0 });

    await src.stop();
    expect(frames.length).toBeGreaterThanOrEqual(2);
    const dx = Math.abs(frames[1].roi!.x - frames[0].roi!.x);
    expect(dx).toBeLessThan(20);
    restore();
  });

  test('uses now when mediaTime is 0 (live stream)', async () => {
    const restore = setupCanvasMock(200, 100);
    const video = new FakeVideo(200, 100) as unknown as HTMLVideoElement;
    let vfcCb: any = null;
    (video as any).requestVideoFrameCallback = jest.fn((cb: any) => { vfcCb = cb; return 1; });
    (video as any).cancelVideoFrameCallback = jest.fn();

    const src = new MediaPipeFaceFrameSource(video, fakeLandmarker([{}]), 30);
    const frames: Frame[] = [];
    src.onFrame = (f) => frames.push(f);
    await src.start();

    vfcCb(12345, { mediaTime: 0 });

    await src.stop();
    expect(frames.length).toBe(1);
    expect(frames[0].timestampMs).toBe(12345);
    restore();
  });

  test('uses mediaTime when non-zero (video file playback)', async () => {
    const restore = setupCanvasMock(200, 100);
    const video = new FakeVideo(200, 100) as unknown as HTMLVideoElement;
    let vfcCb: any = null;
    (video as any).requestVideoFrameCallback = jest.fn((cb: any) => { vfcCb = cb; return 1; });
    (video as any).cancelVideoFrameCallback = jest.fn();

    const src = new MediaPipeFaceFrameSource(video, fakeLandmarker([{}]), 30);
    const frames: Frame[] = [];
    src.onFrame = (f) => frames.push(f);
    await src.start();

    vfcCb(99999, { mediaTime: 2.0 });

    await src.stop();
    expect(frames.length).toBe(1);
    expect(frames[0].timestampMs).toBe(2000);
    restore();
  });

  test('uses requestVideoFrameCallback when available', async () => {
    const restore = setupCanvasMock(200, 100);
    const video = new FakeVideo(200, 100) as unknown as HTMLVideoElement;
    let vfcCallback: any = null;
    (video as any).requestVideoFrameCallback = jest.fn((cb: any) => { vfcCallback = cb; return 42; });
    (video as any).cancelVideoFrameCallback = jest.fn();

    const src = new MediaPipeFaceFrameSource(video, fakeLandmarker([{}]), 30);
    const frames: Frame[] = [];
    src.onFrame = (f) => frames.push(f);
    await src.start();

    expect((video as any).requestVideoFrameCallback).toHaveBeenCalled();
    if (vfcCallback) vfcCallback(performance.now(), { mediaTime: 0.5 });

    await src.stop();
    expect((video as any).cancelVideoFrameCallback).toHaveBeenCalled();
    restore();
  });

  test('falls back to setTimeout when requestVideoFrameCallback unavailable', async () => {
    jest.useFakeTimers();
    const restore = setupCanvasMock(200, 100);
    const video = new FakeVideo(200, 100) as unknown as HTMLVideoElement;
    const landmarker = fakeLandmarker([{}]);
    const src = new MediaPipeFaceFrameSource(video, landmarker, 30);
    const frames: Frame[] = [];
    src.onFrame = (f) => frames.push(f);
    await src.start();

    jest.advanceTimersByTime(100);
    expect(landmarker.detectForVideo).toHaveBeenCalled();

    await src.stop();
    restore();
    jest.useRealTimers();
  });

  test('the timer fallback stamps frames on the same clock as requestVideoFrameCallback (performance.now)', async () => {
    // Without requestVideoFrameCallback (Safari before 15.4, Firefox before 132) the fallback stamped frames with
    // Date.now() (about 1.7e12 ms) while every other clock is performance.now(): in a browser the page froze.
    jest.useFakeTimers({ now: 1_760_000_000_000 });
    const restore = setupCanvasMock(200, 100);
    const video = new FakeVideo(200, 100) as unknown as HTMLVideoElement;
    const landmarker = fakeLandmarker([{}]);
    const src = new MediaPipeFaceFrameSource(video, landmarker, 30);
    const frames: Frame[] = [];
    src.onFrame = (f) => frames.push(f);
    await src.start();
    jest.advanceTimersByTime(100);
    await src.stop();
    restore();
    const perf = performance.now();
    jest.useRealTimers();
    expect(frames.length).toBeGreaterThan(0);
    for (const f of frames) expect(Math.abs((f.timestampMs ?? NaN) - perf)).toBeLessThan(1000);
    for (const call of (landmarker.detectForVideo as jest.Mock).mock.calls) expect(Math.abs(call[1] - perf)).toBeLessThan(1000);
  });
});

describe('MediaPipeFaceFrameSource analysis width switch', () => {
  const lm = [
    { x: 0.45, y: 0.4 },
    { x: 0.55, y: 0.4 },
    { x: 0.5, y: 0.5 },
  ];
  test('on: a 1280x960 camera is read at 640x480 and the face finder reads that image', () => {
    const restore = setupCanvasMock(1280, 960);
    const video = new FakeVideo(1280, 960) as unknown as HTMLVideoElement;
    const landmarker = fakeLandmarker([{ landmarks: lm }]);
    const src = new MediaPipeFaceFrameSource(video, landmarker, 30, undefined, { analysisWidth: true });
    (src as any).detectAndEmit(1000, { mediaTime: 0.001 });
    const canvas = (src as any).canvas;
    expect([canvas.width, canvas.height]).toEqual([640, 480]);
    expect(landmarker.detectForVideo.mock.calls[0][0]).toBe(canvas);
    restore();
  });

  test('off: the full camera frame, and the face finder reads the live video, as published', () => {
    const restore = setupCanvasMock(1280, 960);
    const video = new FakeVideo(1280, 960) as unknown as HTMLVideoElement;
    const landmarker = fakeLandmarker([{ landmarks: lm }]);
    const src = new MediaPipeFaceFrameSource(video, landmarker, 30, undefined, { analysisWidth: false });
    (src as any).detectAndEmit(1000, { mediaTime: 0.001 });
    const canvas = (src as any).canvas;
    expect([canvas.width, canvas.height]).toEqual([1280, 960]);
    expect(landmarker.detectForVideo.mock.calls[0][0]).toBe(video);
    restore();
  });
});

describe('MediaPipeFaceFrameSource face finder', () => {
  const lm = [
    { x: 0.45, y: 0.4 },
    { x: 0.55, y: 0.4 },
    { x: 0.5, y: 0.5 },
  ];
  const drive = (src: MediaPipeFaceFrameSource, frames: number, stepMs: number, startMs = 1000) => {
    for (let i = 0; i < frames; i++) (src as any).detectAndEmit(startMs + i * stepMs, { mediaTime: (startMs + i * stepMs) / 1000 });
  };

  test('is asked on every frame, as published, with landmarkEveryOther off', () => {
    const restore = setupCanvasMock(640, 480);
    const video = new FakeVideo(640, 480) as unknown as HTMLVideoElement;
    const landmarker = fakeLandmarker([{ landmarks: lm }]);
    const src = new MediaPipeFaceFrameSource(video, landmarker, 30, undefined, { landmarkEveryOther: false });
    drive(src, 30, 1000 / 30);
    expect(landmarker.detectForVideo).toHaveBeenCalledTimes(30);
    restore();
  });
});

// Fix landmarkEveryOther (speed): the face finder is most of a frame's cost, so it runs on every third frame and the
// frames between reuse its landmarks; the pixels are still read on every frame, so the check gets every camera frame.
describe('MediaPipeFaceFrameSource landmarkEveryOther', () => {
  const landmarks = [
    { x: 0.45, y: 0.4 },
    { x: 0.55, y: 0.4 },
    { x: 0.5, y: 0.5 },
  ];
  const blendshapes = [{ categoryName: 'eyeBlinkLeft', score: 0.1 }];
  const run = (fixes: any, results: any[], times: number[]) => {
    const restore = setupCanvasMock(200, 100);
    const video = new FakeVideo(200, 100) as unknown as HTMLVideoElement;
    const lm = fakeLandmarker(results);
    const src = new MediaPipeFaceFrameSource(video, lm, 30, undefined, fixes);
    const frames: Frame[] = [];
    src.onFrame = (f) => frames.push(f);
    for (const t of times) (src as any).detectAndEmit(t, null);
    restore();
    return { frames, calls: lm.detectForVideo.mock.calls.length };
  };
  const ten = Array.from({ length: 10 }, (_, i) => i * 33.3);

  test('finds the face on every third frame and emits every frame with its regions', () => {
    const { frames, calls } = run(undefined, [{ landmarks, blendshapes }], ten);
    expect(calls).toBe(4);
    expect(frames.length).toBe(10);
    for (const f of frames) {
      expect(f.landmarks).toBeDefined();
      expect(f.roi).toBeDefined();
    }
    // Blink scores only from frames the finder ran on, never copied.
    expect(frames.filter((f) => f.blendshapes).length).toBe(4);
  });

  test('off: the face finder runs on every frame, as published', () => {
    expect(run({ landmarkEveryOther: false }, [{ landmarks, blendshapes }], ten).calls).toBe(10);
  });

  test('never reuses a frame without a face, nor landmarks older than LANDMARK_REUSE_MAX_MS (150 ms)', () => {
    const noFace = run(undefined, [{}], ten);
    expect(noFace.calls).toBe(10);
    const slow = run(undefined, [{ landmarks }], [0, 160, 320, 480]);
    expect(slow.calls).toBe(4);
  });
});

describe('the frame canvas is made for reading back', () => {
  // Every frame is drawn and then read with getImageData. On a GPU-backed canvas (phones, laptops with a GPU) each read
  // is a GPU-to-CPU copy; willReadFrequently keeps the canvas in memory the CPU reads (Chromium with a GPU-backed canvas,
  // 2026-10-31: 10.5/12.2/8.7 frames a second against 9.6/9.9/7.5 without). mediaPipeFrameSource already asks for it.
  test('the 2D context is asked for with willReadFrequently: true', () => {
    const asked: unknown[] = [];
    const origCreate = document.createElement.bind(document);
    document.createElement = ((tag: string) => {
      if (tag !== 'canvas') return origCreate(tag);
      const c = new FakeCanvas(64, 48);
      const get = c.getContext.bind(c);
      (c as unknown as { getContext: (n: string, o?: unknown) => unknown }).getContext = (n: string, o?: unknown) => { asked.push(o); return get(n); };
      return c as unknown as HTMLCanvasElement;
    }) as typeof document.createElement;
    try {
      new MediaPipeFaceFrameSource(new FakeVideo(64, 48) as unknown as HTMLVideoElement, fakeLandmarker([{}]));
    } finally { document.createElement = origCreate; }
    expect(asked).toEqual([{ willReadFrequently: true }]);
  });
});
