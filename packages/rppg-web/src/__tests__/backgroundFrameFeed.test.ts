import { BACKGROUND_CLOCK_MS, createBackgroundFrameFeed } from '../backgroundFrames';

// createBackgroundFrameFeed's ways where the page has no MediaStreamTrackProcessor: Safari 18+ (track transferred,
// processor in the worker) and Firefox (track not transferable: the worker ticks, the page draws its video).

type Post = { msg: any; transfer?: unknown[] };
class FakeWorker {
  static last: FakeWorker | null = null;
  posts: Post[] = [];
  onmessage: ((ev: MessageEvent) => void) | null = null;
  terminated = false;
  constructor(public url: string) { FakeWorker.last = this; }
  postMessage(msg: any, transfer?: unknown[]) {
    // Firefox: a MediaStreamTrack in the transfer list throws DataCloneError (measured, Firefox 159).
    if (FakeWorker.trackTransferThrows && transfer?.some((t) => (t as any).kind === 'video')) throw new DOMException('invalid transferable array for structured clone', 'DataCloneError');
    this.posts.push({ msg, transfer });
  }
  terminate() { this.terminated = true; }
  static trackTransferThrows = false;
  send(data: unknown) { this.onmessage?.({ data } as MessageEvent); }
}

class FakeVideoFrame {
  static made: FakeVideoFrame[] = [];
  closed = false;
  constructor(public source: unknown, public init: { timestamp: number }) { FakeVideoFrame.made.push(this); }
  get timestamp() { return this.init.timestamp; }
  close() { this.closed = true; }
}

function fakeTrack() {
  const t: any = { kind: 'video', stopped: false, stop() { t.stopped = true; }, clone() { const c = fakeTrack(); t.clones.push(c); return c; }, clones: [] as any[] };
  return t;
}

/** A video element whose drawn pixels are `pixel` (one value), so the change check sees what the test sets. */
function fakeVideo() { return { videoWidth: 64, videoHeight: 48, pixel: 1 } as any; }
let currentVideo: any = null;
function installCanvas() {
  const orig = document.createElement.bind(document);
  document.createElement = ((tag: string) => {
    if (tag !== 'canvas') return orig(tag);
    let value = 0;
    const ctx = {
      drawImage(src: any) { value = src && 'pixel' in src ? src.pixel : (src?.__value ?? value); },
      getImageData(_x: number, _y: number, w: number, h: number) { return { data: new Uint8ClampedArray(w * h * 4).fill(value) }; },
    };
    const c: any = { width: 300, height: 150, getContext: () => ctx };
    Object.defineProperty(c, '__value', { get: () => value });
    return c;
  }) as any;
  return () => { document.createElement = orig; };
}

describe('createBackgroundFrameFeed without a page MediaStreamTrackProcessor', () => {
  let restore: () => void;
  const g = globalThis as any;
  beforeEach(() => {
    restore = installCanvas();
    g.Worker = FakeWorker;
    g.VideoFrame = FakeVideoFrame;
    delete g.MediaStreamTrackProcessor;
    g.URL.createObjectURL = () => 'blob:x';
    g.URL.revokeObjectURL = () => {};
    FakeWorker.trackTransferThrows = false;
    FakeVideoFrame.made = [];
    currentVideo = fakeVideo();
  });
  afterEach(() => { restore(); delete g.Worker; delete g.VideoFrame; });

  test('Safari: the track is transferred to the worker, and the frames it hands over reach onFrame', () => {
    const track = fakeTrack();
    const feed = createBackgroundFrameFeed(track, currentVideo);
    expect(feed).not.toBeNull();
    const w = FakeWorker.last!;
    const sent = w.posts.find((p) => p.msg.track);
    expect(sent).toBeTruthy();
    // A clone goes over, never the page's own track.
    expect(sent!.msg.track).toBe(track.clones[0]);
    expect(sent!.transfer).toEqual([track.clones[0]]);
    expect(w.posts.some((p) => p.msg.clock)).toBe(false);
    const got: any[] = [];
    feed!.onFrame = (f) => got.push(f);
    const vf = new FakeVideoFrame(null, { timestamp: 5 });
    w.send({ frame: vf });
    expect(got).toEqual([vf]);
  });

  test('Firefox: the track is not transferable, so the worker ticks and each changed drawing of the video is a frame', () => {
    FakeWorker.trackTransferThrows = true;
    const track = fakeTrack();
    const feed = createBackgroundFrameFeed(track, currentVideo);
    expect(feed).not.toBeNull();
    const w = FakeWorker.last!;
    expect(w.posts.map((p) => p.msg)).toContainEqual({ clock: BACKGROUND_CLOCK_MS });
    // The clone that could not go over is stopped, the page's own track is not.
    expect(track.clones[0].stopped).toBe(true);
    expect(track.stopped).toBe(false);
    const got: any[] = [];
    feed!.onFrame = (f) => { got.push(f); f.close(); feed!.ack(); };
    const acks = () => w.posts.filter((p) => p.msg.ack).length;
    w.send({ tick: true });
    expect(got.length).toBe(1);
    expect(got[0].timestamp).toBeGreaterThan(0);
    // Same pixels on the next tick: no frame, but the tick is acknowledged so the next can come.
    w.send({ tick: true });
    expect(got.length).toBe(1);
    expect(acks()).toBe(2);
    currentVideo.pixel = 2;
    w.send({ tick: true });
    expect(got.length).toBe(2);
    feed!.close();
    expect(w.posts.some((p) => p.msg.stop)).toBe(true);
  });

  test('a worker without a processor (Safari before 18) answers unsupported, and the feed falls back to the clock', () => {
    const feed = createBackgroundFrameFeed(fakeTrack(), currentVideo);
    const w = FakeWorker.last!;
    expect(w.posts.some((p) => p.msg.clock)).toBe(false);
    w.send({ unsupported: true });
    expect(w.posts.map((p) => p.msg)).toContainEqual({ clock: BACKGROUND_CLOCK_MS });
    const got: any[] = [];
    feed!.onFrame = (f) => got.push(f);
    w.send({ tick: true });
    expect(got.length).toBe(1);
  });

  test('no processor, a track that cannot be transferred and no video: no feed, as before', () => {
    FakeWorker.trackTransferThrows = true;
    expect(createBackgroundFrameFeed(fakeTrack())).toBeNull();
  });
});
