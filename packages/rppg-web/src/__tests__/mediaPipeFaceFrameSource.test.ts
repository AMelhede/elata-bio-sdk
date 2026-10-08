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
    const src = new MediaPipeFaceFrameSource(video, landmarker, 30);
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

describe('MediaPipeFaceFrameSource sparse face finder switch', () => {
  // Peak asks its face finder at most once per 100 ms and reads the frames in between with the last face
  // (its faceLandmarker.ts, FRAME_MS): on the owner's laptop the finder took about 20 ms of every 33 ms frame.
  const lm = [
    { x: 0.45, y: 0.4 },
    { x: 0.55, y: 0.4 },
    { x: 0.5, y: 0.5 },
  ];
  const drive = (src: MediaPipeFaceFrameSource, frames: number, stepMs: number, startMs = 1000) => {
    for (let i = 0; i < frames; i++) (src as any).detectAndEmit(startMs + i * stepMs, { mediaTime: (startMs + i * stepMs) / 1000 });
  };

  test('on: the finder is asked at most once per 100 ms, and every frame between carries the last face', () => {
    const restore = setupCanvasMock(640, 480);
    const video = new FakeVideo(640, 480) as unknown as HTMLVideoElement;
    const landmarker = fakeLandmarker([{ landmarks: lm, blendshapes: [{ categoryName: 'mouthSmileLeft', score: 0.3 }] }]);
    const src = new MediaPipeFaceFrameSource(video, landmarker, 30, undefined, { sparseFaceFinder: true });
    const frames: Frame[] = [];
    src.onFrame = (f) => frames.push(f);
    drive(src, 30, 1000 / 30); // one second of a 30 fps camera: frames at 0 to 967 ms
    expect(landmarker.detectForVideo).toHaveBeenCalledTimes(10);
    expect(frames).toHaveLength(30);
    for (const f of frames) {
      expect(f.rois?.length).toBe(3);
      expect(f.landmarks).toBe(lm);
      expect(f.blendshapes?.[0].categoryName).toBe('mouthSmileLeft');
    }
    // The finder's own clock only moves forward: each call is at least 100 ms after the one before.
    const stamps = landmarker.detectForVideo.mock.calls.map((c: any[]) => c[1] as number);
    stamps.slice(1).forEach((t: number, i: number) => expect(t - stamps[i]).toBeGreaterThanOrEqual(100));
    restore();
  });

  test('on: a lost face is reported as lost until the finder is next asked, never longer than 100 ms', () => {
    const restore = setupCanvasMock(640, 480);
    const video = new FakeVideo(640, 480) as unknown as HTMLVideoElement;
    const landmarker = fakeLandmarker([{ landmarks: lm }, {}, { landmarks: lm }]);
    const src = new MediaPipeFaceFrameSource(video, landmarker, 30, undefined, { sparseFaceFinder: true });
    const frames: Frame[] = [];
    src.onFrame = (f) => frames.push(f);
    drive(src, 10, 25); // 0..225 ms: asked at 0 (face), 100 (none), 200 (face)
    expect(landmarker.detectForVideo).toHaveBeenCalledTimes(3);
    expect(frames.map((f) => (f.rois ? 1 : 0))).toEqual([1, 1, 1, 1, 0, 0, 0, 0, 1, 1]);
    restore();
  });

  test('on: a clock that steps back (a new video) asks the finder again at once', () => {
    const restore = setupCanvasMock(640, 480);
    const video = new FakeVideo(640, 480) as unknown as HTMLVideoElement;
    const landmarker = fakeLandmarker([{ landmarks: lm }]);
    const src = new MediaPipeFaceFrameSource(video, landmarker, 30, undefined, { sparseFaceFinder: true });
    (src as any).detectAndEmit(5000, { mediaTime: 5 });
    (src as any).detectAndEmit(1000, { mediaTime: 1 });
    expect(landmarker.detectForVideo).toHaveBeenCalledTimes(2);
    restore();
  });

  test('off: the finder is asked on every frame, as published', () => {
    const restore = setupCanvasMock(640, 480);
    const video = new FakeVideo(640, 480) as unknown as HTMLVideoElement;
    const landmarker = fakeLandmarker([{ landmarks: lm }]);
    const src = new MediaPipeFaceFrameSource(video, landmarker, 30, undefined, { sparseFaceFinder: false });
    drive(src, 30, 1000 / 30);
    expect(landmarker.detectForVideo).toHaveBeenCalledTimes(30);
    restore();
  });
});
