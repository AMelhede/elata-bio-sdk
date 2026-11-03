import { BACKGROUND_WORKER_SOURCE, WORKER_READ_CHECK_FRAMES, createBackgroundFrameFeed, type BackgroundPixels } from '../backgroundFrames';
import { MediaPipeFaceFrameSource } from '../mediaPipeFaceFrameSource';
import type { Frame } from '../frameSource';

// Worker read: hidden, the page's own read of a track frame (drawImage, getImageData) is a GPU readback the page's
// thread waits for, out of the frames a throttled hidden page can analyse. The worker draws the frame at
// the analysis size and reads it; the page compares its own read on the first frames and stops the worker read at one
// differing byte, so the pixels the analysis gets are the bytes its own read gives.

const g = globalThis as any;

/** The worker source run in a sandbox: its postMessage calls, with a fake OffscreenCanvas whose read is `value`. */
function runWorker() {
	const posts: { msg: any; transfer?: unknown[] }[] = [];
	const contexts: { args: unknown[] }[] = [];
	class OffscreenCanvas {
		constructor(public width: number, public height: number) {}
		getContext(...args: unknown[]) {
			contexts.push({ args });
			const c = this;
			return { drawImage() {}, getImageData: () => ({ data: new Uint8ClampedArray(c.width * c.height * 4).fill(7) }) };
		}
	}
	const scope: any = { postMessage: (msg: any, transfer?: unknown[]) => posts.push({ msg, transfer }), OffscreenCanvas, onmessage: null };
	// eslint-disable-next-line no-new-func
	new Function('self', 'postMessage', 'OffscreenCanvas', `${BACKGROUND_WORKER_SOURCE}; self.onmessage = onmessage; self.readNow = read;`)(scope, scope.postMessage, OffscreenCanvas);
	return { scope, posts, contexts };
}

/** A readable that yields `frames` then ends. */
function readable(frames: any[]) {
	let i = 0;
	return { getReader: () => ({ read: async () => (i < frames.length ? { done: false, value: frames[i++] } : { done: true }), cancel: async () => {} }) };
}
const frame = (w: number, h: number, ts = 0) => { const f: any = { displayWidth: w, displayHeight: h, timestamp: ts, closed: false, close() { f.closed = true; } }; return f; };

describe('worker read, in the worker', () => {
	test('frames are drawn at the analysis size with a plain 2d context, the first ones sent with a copy to check', async () => {
		const { scope, posts, contexts } = runWorker();
		await scope.onmessage({ data: { active: true } });
		await scope.onmessage({ data: { pixels: { maxWidth: 640, check: 2 } } });
		const fs = [frame(1280, 720, 1), frame(1280, 720, 2), frame(1280, 720, 3)];
		// One frame in flight: each is acknowledged before the next is read.
		for (const f of fs) { await scope.readNow(readable([f])); await scope.onmessage({ data: { ack: true } }); }
		expect(posts.map((p) => [p.msg.width, p.msg.height, p.msg.displayWidth, p.msg.timestamp])).toEqual([[640, 360, 1280, 1], [640, 360, 1280, 2], [640, 360, 1280, 3]]);
		expect(posts.map((p) => p.msg.copy != null)).toEqual([true, true, false]);
		expect(new Uint8ClampedArray(posts[0].msg.pixels).length).toBe(640 * 360 * 4);
		// No willReadFrequently: with it, the worker's context drew other bytes than the page's own read.
		expect(contexts[0].args).toEqual(['2d']);
		// The sent frames are transferred as copies, the third (no copy) closed in the worker.
		expect(posts[0].transfer).toContain(fs[0]);
		expect(fs[2].closed).toBe(true);
	});

	test('the analysis size follows analysisSize (640 wide, rounded) and maxWidth 0 keeps the full size', async () => {
		const { scope, posts } = runWorker();
		await scope.onmessage({ data: { active: true } });
		await scope.onmessage({ data: { pixels: { maxWidth: 640, check: 0 } } });
		await scope.readNow(readable([frame(641, 481)])); await scope.onmessage({ data: { ack: true } });
		await scope.readNow(readable([frame(320, 240)])); await scope.onmessage({ data: { ack: true } });
		await scope.onmessage({ data: { pixels: { maxWidth: 0, check: 0 } } });
		await scope.readNow(readable([frame(1280, 720)]));
		expect(posts.map((p) => [p.msg.width, p.msg.height])).toEqual([[640, 480], [320, 240], [1280, 720]]);
	});

	test('without the option, or turned off, frames go over as frames', async () => {
		const { scope, posts } = runWorker();
		await scope.onmessage({ data: { active: true } });
		const a = frame(1280, 720);
		await scope.readNow(readable([a])); await scope.onmessage({ data: { ack: true } });
		await scope.onmessage({ data: { pixels: { maxWidth: 640, check: 0 } } });
		await scope.onmessage({ data: { pixels: null } });
		const b = frame(1280, 720);
		await scope.readNow(readable([b]));
		expect(posts.map((p) => p.msg.frame)).toEqual([a, b]);
	});
});

describe('worker read, on the page', () => {
	class FakeWorker {
		static last: FakeWorker | null = null;
		posts: any[] = [];
		onmessage: ((ev: MessageEvent) => void) | null = null;
		constructor() { FakeWorker.last = this; }
		postMessage(msg: any) { this.posts.push(msg); }
		terminate() {}
		send(data: unknown) { this.onmessage?.({ data } as MessageEvent); }
	}
	let pageValue = 7;
	const orig = document.createElement.bind(document);
	beforeEach(() => {
		g.Worker = FakeWorker;
		g.MediaStreamTrackProcessor = class { readable = {}; constructor(_o: unknown) {} };
		g.URL.createObjectURL = () => 'blob:x';
		g.URL.revokeObjectURL = () => {};
		document.createElement = ((tag: string) => tag === 'canvas'
			? { width: 300, height: 150, getContext: () => ({ drawImage() {}, getImageData: (_x: number, _y: number, w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4).fill(pageValue) }) }) }
			: orig(tag)) as any;
		pageValue = 7;
	});
	afterEach(() => { document.createElement = orig; delete g.Worker; delete g.MediaStreamTrackProcessor; });
	const track = () => { const t: any = { kind: 'video', stop() {}, clone: () => track() }; return t; };
	const msg = (value: number, copy: any) => ({ pixels: new Uint8ClampedArray(4 * 3 * 4).fill(value).buffer, width: 4, height: 3, displayWidth: 8, displayHeight: 6, timestamp: 9, copy });

	test('asked for only with the option; the worker is told the width and how many frames to check', () => {
		createBackgroundFrameFeed(track() as any, undefined);
		expect(FakeWorker.last!.posts.some((p) => 'pixels' in p)).toBe(false);
		createBackgroundFrameFeed(track() as any, undefined, { workerReadMaxWidth: 640 });
		expect(FakeWorker.last!.posts).toContainEqual({ pixels: { maxWidth: 640, check: WORKER_READ_CHECK_FRAMES } });
	});

	test('a checked frame whose bytes match the page read goes on as pixels; one that differs stops the worker read and goes on as its frame', () => {
		const feed = createBackgroundFrameFeed(track() as any, undefined, { workerReadMaxWidth: 640 })!;
		const w = FakeWorker.last!;
		const got: any[] = [];
		feed.onFrame = (f) => got.push(f);
		const c1 = frame(8, 6);
		w.send(msg(7, c1));
		expect(got[0].pixels[0]).toBe(7);
		expect(got[0].width).toBe(4);
		expect(c1.closed).toBe(true);
		expect(feed.workerRead).toEqual({ checked: 1, differed: false });
		pageValue = 8;
		const c2 = frame(8, 6);
		w.send(msg(7, c2));
		expect(got[1]).toBe(c2);
		expect(w.posts).toContainEqual({ pixels: null });
		expect(feed.workerRead).toEqual({ checked: 2, differed: true });
	});
});

describe('worker read, in the frame source', () => {
	test('hidden pixels become the frame and the finder canvas as they are: no draw and no read on the page', async () => {
		const calls: string[] = [];
		const ctx = { drawImage: () => calls.push('draw'), getImageData: () => { calls.push('read'); return { data: new Uint8ClampedArray(64 * 48 * 4) }; }, putImageData: (img: any) => calls.push(`put ${img.width}x${img.height}`) };
		const orig = document.createElement.bind(document);
		document.createElement = ((tag: string) => (tag === 'canvas' ? { width: 64, height: 48, getContext: () => ctx } : orig(tag))) as any;
		g.ImageData = class { constructor(public data: Uint8ClampedArray, public width: number, public height: number) {} };
		Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
		try {
			const video: any = { videoWidth: 64, videoHeight: 48, requestVideoFrameCallback: () => 1 };
			const finder = { detectForVideo: jest.fn(() => ({ faceLandmarks: [] })) };
			const src = new MediaPipeFaceFrameSource(video, finder as any, 30);
			const feed: any = { onFrame: null, setActive() {}, ack() {}, close() {} };
			src.backgroundFrames = true;
			src.backgroundFeed = feed;
			const frames: Frame[] = [];
			src.onFrame = (f) => frames.push(f);
			await src.start();
			const pixels = new Uint8ClampedArray(64 * 48 * 4).fill(3);
			const px: BackgroundPixels = { pixels, width: 64, height: 48, displayWidth: 128, displayHeight: 96, timestamp: 2_000_000, close() {} };
			feed.onFrame(px);
			expect(frames.length).toBe(1);
			expect(frames[0].data).toBe(pixels);
			expect(calls).toEqual(['put 64x48']);
			expect(finder.detectForVideo).toHaveBeenCalledTimes(1);
			await src.stop();
		} finally {
			document.createElement = orig;
			delete g.ImageData;
			Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
		}
	});
});
