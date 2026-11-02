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


import type { AsyncFaceFinder, FaceFinderResult } from '../faceFinderWorker';
import { FACE_WORKER_MAX_AGE_MS } from '../faceFinderWorker';

// Session option faceFinderWorker: the finder answers later, from another thread. A fake that holds each request until
// the test answers it, so the order of frames and results is exact.
function fakeAsyncFinder() {
  const asked: number[] = [];
  let pending: FaceFinderResult[] = [];
  let busy = false;
  const f: AsyncFaceFinder & { asked: number[]; answer: (r: FaceFinderResult) => void } = {
    get busy() { return busy; },
    get error() { return null; },
    request(_img: unknown, atMs: number) { busy = true; asked.push(atMs); },
    take() { const r = pending; pending = []; return r; },
    close() {},
    asked,
    answer(r: FaceFinderResult) { busy = false; pending.push(r); },
  };
  return f;
}

describe('faceFinderWorker: regions from the worker finder', () => {
  const landmarks = [ { x: 0.45, y: 0.4 }, { x: 0.55, y: 0.4 }, { x: 0.5, y: 0.5 } ];
  const flush = () => new Promise((r) => setTimeout(r, 0));
  let restoreCanvas: () => void;
  const origBitmap = (globalThis as any).createImageBitmap;
  beforeEach(() => { restoreCanvas = setupCanvasMock(200, 100); (globalThis as any).createImageBitmap = jest.fn(async () => ({ close() {} })); });
  afterEach(() => { restoreCanvas(); (globalThis as any).createImageBitmap = origBitmap; });

  function make() {
    const video = new FakeVideo(200, 100) as unknown as HTMLVideoElement;
    const main = fakeLandmarker([{ landmarks }]);
    const src = new MediaPipeFaceFrameSource(video, main, 30);
    const finder = fakeAsyncFinder();
    src.asyncFinder = finder;
    const frames: Frame[] = [];
    src.onFrame = (fr) => frames.push(fr);
    (src as any).running = true;
    const tick = (t: number) => (src as any).detectAndEmit(t, null);
    return { src, main, finder, frames, tick };
  }

  test('places the regions from the newest result and never runs the finder on this thread', async () => {
    const { main, finder, frames, tick } = make();
    tick(1000);
    await flush();
    expect(frames[0].roi).toBeUndefined();
    expect(finder.asked).toEqual([1000]);
    finder.answer({ atMs: 1000, landmarks });
    tick(1033);
    expect(frames[1].roi).toBeDefined();
    expect(frames[1].rois?.length).toBe(3);
    expect(main.detectForVideo).not.toHaveBeenCalled();
  });

  test('asks again only when the finder is free, one frame at a time', async () => {
    const { finder, tick } = make();
    tick(1000); await flush();
    tick(1033); await flush();
    tick(1066); await flush();
    expect(finder.asked).toEqual([1000]);
    finder.answer({ atMs: 1000, landmarks });
    tick(1100); await flush();
    expect(finder.asked).toEqual([1000, 1100]);
  });

  test('never places regions from a result older than FACE_WORKER_MAX_AGE_MS', async () => {
    const { finder, frames, tick } = make();
    tick(1000); await flush();
    finder.answer({ atMs: 1000, landmarks });
    tick(1000 + FACE_WORKER_MAX_AGE_MS);
    expect(frames[1].roi).toBeDefined();
    tick(1000 + FACE_WORKER_MAX_AGE_MS + 1);
    expect(frames[2].roi).toBeUndefined();
  });

  test('a result with no face clears the regions at once', async () => {
    const { finder, frames, tick } = make();
    tick(1000); await flush();
    finder.answer({ atMs: 1000, landmarks });
    tick(1033); await flush();
    finder.answer({ atMs: 1033, landmarks: null });
    tick(1066);
    expect(frames[1].roi).toBeDefined();
    expect(frames[2].roi).toBeUndefined();
  });

  test('a result\'s blendshapes go out on one frame only', async () => {
    const { finder, frames, tick } = make();
    tick(1000); await flush();
    finder.answer({ atMs: 1000, landmarks, blendshapes: [{ categoryName: 'eyeBlinkLeft', score: 0.9 }] });
    tick(1033);
    tick(1066);
    expect(frames[1].blendshapes?.[0].categoryName).toBe('eyeBlinkLeft');
    expect(frames[2].blendshapes).toBeUndefined();
  });

  test('a stop drops results from before it, so a restart never uses them', async () => {
    const { src, finder, frames, tick } = make();
    tick(1000); await flush();
    finder.answer({ atMs: 1000, landmarks });
    await src.stop();
    (src as any).running = true;
    tick(1033);
    expect(frames[1].roi).toBeUndefined();
  });
});
