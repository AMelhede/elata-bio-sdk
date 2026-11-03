import { BACKGROUND_WORKER_SOURCE, createBackgroundFrameFeed } from '../backgroundFrames';

// The background feed's wake timer: option backgroundEveryMs's schedule needs a timer that keeps its time while the page
// is hidden, so it runs in the feed's worker (a hidden page's own chained timers fall to one a minute in Chromium).

const g = globalThis as any;

function runWorker() {
	const posts: any[] = [];
	const scope: any = { postMessage: (msg: any) => posts.push(msg), onmessage: null };
	// eslint-disable-next-line no-new-func
	new Function('self', 'postMessage', `${BACKGROUND_WORKER_SOURCE}; self.onmessage = onmessage;`)(scope, scope.postMessage);
	return { scope, posts };
}

describe('background feed wake timer', () => {
	afterEach(() => jest.useRealTimers());

	test('in the worker: one wake after the time asked, a later ask replacing the earlier one', async () => {
		jest.useFakeTimers();
		const { scope, posts } = runWorker();
		await scope.onmessage({ data: { wake: 5000 } });
		await scope.onmessage({ data: { wake: 8000 } });
		jest.advanceTimersByTime(7999);
		expect(posts.filter((p) => p.wake)).toHaveLength(0);
		jest.advanceTimersByTime(1);
		expect(posts.filter((p) => p.wake)).toHaveLength(1);
		jest.advanceTimersByTime(60_000);
		expect(posts.filter((p) => p.wake)).toHaveLength(1);
	});

	test('on the page: wakeIn asks the worker, and its wake reaches onWake', () => {
		const made: any[] = [];
		class FakeWorker { posts: any[] = []; onmessage: ((ev: MessageEvent) => void) | null = null; constructor() { made.push(this); } postMessage(m: any) { this.posts.push(m); } terminate() {} }
		const saved = { W: g.Worker, P: g.MediaStreamTrackProcessor, c: g.URL.createObjectURL, r: g.URL.revokeObjectURL };
		g.Worker = FakeWorker;
		g.MediaStreamTrackProcessor = class { readable = {}; };
		g.URL.createObjectURL = () => 'blob:x';
		g.URL.revokeObjectURL = () => {};
		try {
			const track: any = { kind: 'video', clone: () => ({ kind: 'video', stop() {} }), stop() {} };
			const feed = createBackgroundFrameFeed(track)!;
			feed.wakeIn!(120_000);
			expect(made[0].posts).toContainEqual({ wake: 120_000 });
			let woke = 0;
			feed.onWake = () => { woke += 1; };
			made[0].onmessage({ data: { wake: true } } as MessageEvent);
			expect(woke).toBe(1);
		} finally {
			g.Worker = saved.W; g.MediaStreamTrackProcessor = saved.P; g.URL.createObjectURL = saved.c; g.URL.revokeObjectURL = saved.r;
		}
	});
});
