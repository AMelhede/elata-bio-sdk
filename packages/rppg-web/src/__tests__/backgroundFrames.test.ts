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

import type { BackgroundFrameFeed } from '../backgroundFrames';

// Session option backgroundFrames: a hidden page gets no video frame callbacks; frames come from the track feed.
function fakeFeed() {
  const f: BackgroundFrameFeed & { active: boolean[]; acks: number; closed: boolean; send: (tsUs: number) => { closed: boolean } } = {
    onFrame: null, active: [], acks: 0, closed: false,
    setActive(a: boolean) { f.active.push(a); }, ack() { f.acks += 1; }, close() { f.closed = true; },
    send(tsUs: number) { const vf = { displayWidth: 64, displayHeight: 48, timestamp: tsUs, closed: false, close() { vf.closed = true; } }; f.onFrame?.(vf as unknown as VideoFrame); return vf; },
  };
  return f;
}
function setVisibility(v: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => v });
  document.dispatchEvent(new Event('visibilitychange'));
}
const face: Lm[] = Array.from({ length: 478 }, (_, i) => ({ x: 0.3 + 0.4 * ((i % 22) / 21), y: 0.25 + 0.5 * (Math.floor(i / 22) / 21) }));

describe('backgroundFrames', () => {
  let restore: () => void;
  let cbs: ((now: number, md: unknown) => void)[];
  let video: FakeVideo & { requestVideoFrameCallback: (cb: (n: number, m: unknown) => void) => number };
  beforeEach(() => {
    restore = setupCanvasMock(64, 48);
    cbs = [];
    video = Object.assign(new FakeVideo(64, 48), { requestVideoFrameCallback: (cb: (n: number, m: unknown) => void) => { cbs.push(cb); return cbs.length; } });
    setVisibility('visible');
  });
  afterEach(() => { restore(); setVisibility('visible'); });

  test('hidden: each track frame is analysed once, closed and acknowledged; visible: dropped, video frames analysed', async () => {
    const src = new MediaPipeFaceFrameSource(video as any, fakeLandmarker([{ landmarks: face }]), 30);
    const feed = fakeFeed();
    src.backgroundFrames = true;
    src.backgroundFeed = feed;
    const frames: Frame[] = [];
    src.onFrame = (f) => frames.push(f);
    await src.start();
    expect(feed.active).toEqual([false]);
    // A video frame callback's time is on performance.now()'s clock in a browser, as the track path's wall time is.
    cbs.shift()!(performance.now(), { mediaTime: 1.0 });
    expect(frames.length).toBe(1);
    const dropped = feed.send(1_033_000);
    expect(frames.length).toBe(1);
    expect(dropped.closed).toBe(true);
    setVisibility('hidden');
    expect(feed.active).toEqual([false, true]);
    const a = feed.send(5_000_000);
    const b = feed.send(5_033_000);
    expect(frames.length).toBe(3);
    expect(a.closed && b.closed).toBe(true);
    expect(feed.acks).toBe(3);
    expect(frames[2].namedRois).toBeTruthy();
    // The track clock continues the video clock (no jump at the switch), and its own steps are kept: 33 ms.
    expect(frames[2].timestampMs! - frames[1].timestampMs!).toBeCloseTo(33, 5);
    expect(frames[1].timestampMs!).toBeGreaterThan(frames[0].timestampMs!);
    // A late video callback while hidden is not analysed a second time.
    cbs.shift()!(1100, { mediaTime: 1.1 });
    expect(frames.length).toBe(3);
    await src.stop();
    expect(feed.closed).toBe(true);
  });

  test('without the option no feed is made and a hidden page analyses nothing new', async () => {
    const src = new MediaPipeFaceFrameSource(video as any, fakeLandmarker([{ landmarks: face }]), 30);
    const frames: Frame[] = [];
    src.onFrame = (f) => frames.push(f);
    await src.start();
    cbs.shift()!(1000, { mediaTime: 1.0 });
    expect(frames[0].timestampMs).toBe(1000);
    expect((src as any).backgroundFeed).toBeNull();
  });
});
