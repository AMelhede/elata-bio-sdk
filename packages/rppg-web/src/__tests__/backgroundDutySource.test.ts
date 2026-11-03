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

import { BackgroundDuty, type BackgroundFrameFeed, type BackgroundReadingMark } from '../backgroundFrames';

// Session option backgroundFrames: a hidden page gets no video frame callbacks; frames come from the track feed.
function fakeFeed() {
  const f: BackgroundFrameFeed & { active: boolean[]; acks: number; closed: boolean; wakes: number[]; send: (tsUs: number) => { closed: boolean } } = {
    onFrame: null, onWake: null, active: [], acks: 0, closed: false, wakes: [], wakeIn(ms: number) { f.wakes.push(ms); },
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


// Option backgroundEveryMs in the frame source: hidden, a burst of analysed frames, then the worker drops frames until
// the schedule's wake starts the next burst.
const last = <T,>(a: T[]): T => a[a.length - 1];
const mark = (evaluations: number, measured: boolean, passive = 0): BackgroundReadingMark => ({ evaluations, measured, passive });
beforeEach(() => setVisibility('visible'));
afterEach(() => setVisibility('visible'));
let restore: () => void;
beforeAll(() => { restore = setupCanvasMock(64, 48); });
afterAll(() => restore());

describe('backgroundEveryMs in the frame source', () => {
  test('hidden: the source analyses a burst, stops the feed after the reading and hold, and starts it again on the wake', async () => {
    let now = 1000;
    const spy = jest.spyOn(performance, 'now').mockImplementation(() => now);
    try {
      const video = Object.assign(new FakeVideo(64, 48), { requestVideoFrameCallback: () => 1 });
      const src = new MediaPipeFaceFrameSource(video as any, fakeLandmarker([{ landmarks: face }]), 30);
      const feed = fakeFeed();
      src.backgroundFrames = true;
      src.backgroundFeed = feed;
      src.backgroundDuty = new BackgroundDuty({ everyMs: 120_000, maxBurstMs: 60_000, holdMs: 5000 });
      let m = mark(0, false);
      src.backgroundReadingMark = () => m;
      const frames: Frame[] = [];
      src.onFrame = (f) => frames.push(f);
      await src.start();
      expect(feed.active).toEqual([false]);
      setVisibility('hidden');
      expect(feed.active).toEqual([false, true]);
      // The longest end of the burst is armed on the worker's timer.
      expect(last(feed.wakes)).toBe(60_000);
      for (let i = 0; i < 10; i++) { now += 1000; feed.send(now * 1000); }
      expect(frames.length).toBe(10);
      expect(last(feed.active)).toBe(true);
      m = mark(1, true);
      now += 1000; feed.send(now * 1000); // the reading stands at 11 s
      now += 5000; feed.send(now * 1000); // hold over
      expect(last(feed.active)).toBe(false);
      expect(src.backgroundDuty.phase).toBe('rest');
      // Rest until the next start, 120 s after this burst's.
      expect(last(feed.wakes)).toBe(1000 + 120_000 - now);
      now = 1000 + 120_000;
      feed.onWake!();
      expect(last(feed.active)).toBe(true);
      expect(src.backgroundDuty.phase).toBe('burst');
      // A burst that gets no reading ends at its longest on the wake, frames or not.
      now += 60_000;
      feed.onWake!();
      expect(last(feed.active)).toBe(false);
      expect(src.backgroundDuty.bursts.map((b) => b.readingAfterMs)).toEqual([11_000, null]);
      // Visible again: the video path, no schedule.
      setVisibility('visible');
      expect(src.backgroundDuty.phase).toBe('visible');
      await src.stop();
    } finally {
      spy.mockRestore();
    }
  });
});
