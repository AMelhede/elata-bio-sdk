/**
 * Session option backgroundFrames (off unless true): frames keep reaching the analysis while the page is hidden
 * (another tab or app in front, a minimised window), so a desktop reading continues as a wrist reading does.
 *
 * Why: a hidden page gets no requestVideoFrameCallback and no animation frames (0 a second, bare Chromium behind a
 * second tab, testbed bench/background/raw.mjs, 2026-11-03), so the frame source stops. The camera track itself keeps
 * delivering: a MediaStreamTrackProcessor read in a dedicated worker gets every frame hidden (20 of 20 a second for
 * 7 minutes, same bench), and the page's main thread still handles one worker message per frame at the camera's full
 * rate hidden, the frame drawn and read back included (30 of 30 a second at 640x480, 7 minutes hidden, the scratch
 * bench msgrun.mjs). So the worker only reads the track and hands each frame over; everything after (face finder,
 * regions, pulse check, passive reader) runs where it runs today, unchanged.
 *
 * While the page is visible the worker drops every frame and the source reads frames as it does without the option,
 * so a visible page's numbers do not change.
 */

/**
 * A frame the worker has already drawn at the analysis size and read (worker read, below): its RGBA bytes, the size
 * they were drawn at, the camera frame's own size and time (microseconds, as VideoFrame.timestamp).
 */
export interface BackgroundPixels {
	readonly pixels: Uint8ClampedArray<ArrayBuffer>;
	readonly width: number;
	readonly height: number;
	readonly displayWidth: number;
	readonly displayHeight: number;
	readonly timestamp: number;
	close(): void;
}

/** What the frame source needs of a background feed (a worker in a browser, a fake in tests). */
export interface BackgroundFrameFeed {
	/** Each frame the worker hands over while `active`, as a frame or as its read pixels; the callee must close() it. */
	onFrame: ((frame: VideoFrame | BackgroundPixels) => void) | null;
	/** Hand frames over (true) or drop them in the worker (false). */
	setActive(active: boolean): void;
	/** The frame handed over last is done with: the next may come (one frame in flight, never a queue). */
	ack(): void;
	close(): void;
	/**
	 * Call onWake once, about `ms` from now (a later call replaces an earlier one), from the worker: a worker's timers
	 * keep their time while a hidden page's own fall to one a second, and after 5 minutes hidden Chromium's intensive
	 * throttling can hold a chained page timer for most of a minute. A feed without it gets a page timer. Option
	 * backgroundEveryMs's schedule runs on it.
	 */
	wakeIn?(ms: number): void;
	onWake?: (() => void) | null;
	/** Worker read (createBackgroundFrameFeed's workerReadMaxWidth): frames compared with the page's own read, and whether one differed (it is then off). */
	workerRead?: { checked: number; differed: boolean };
}

/**
 * The worker, one of three ways (createBackgroundFrameFeed picks): `readable` (a MediaStreamTrackProcessor made on the
 * page, Chromium), `track` (the track itself, transferred, and the processor made here: Safari 18+, whose
 * MediaStreamTrackProcessor exists only in a dedicated worker), or `clock` (no processor anywhere, Firefox: the worker
 * only ticks, and the page draws its own video element on each tick). While active it hands over one frame (or tick)
 * at a time and drops the rest.
 */
export const BACKGROUND_WORKER_SOURCE = `
let active = false, inFlight = false, reader = null, clock = null, own = null, px = null, cv = null, cx = null, ready = null, wake = null;
// Worker read (px set): the frame drawn at the analysis size and read here, so the page's thread gets bytes, not a
// frame to read back; the first px.check frames also go over as a copy, for the page to compare with its own read.
// While the page is busy with one frame, the next frame to come is drawn and read here (ready) and sent at the ack, so
// the page never waits for a read; one ready at most, later frames are dropped as before.
const prepare = (f) => {
  try {
    const w0 = f.displayWidth, h0 = f.displayHeight, sc = px.maxWidth > 0 ? Math.min(1, px.maxWidth / w0) : 1;
    const w = Math.max(1, Math.round(w0 * sc)), h = Math.max(1, Math.round(h0 * sc));
    if (!cv || cv.width !== w || cv.height !== h) { cv = new OffscreenCanvas(w, h); cx = cv.getContext('2d'); }
    cx.drawImage(f, 0, 0, w, h);
    const data = cx.getImageData(0, 0, w, h).data;
    const m = { pixels: data.buffer, width: w, height: h, displayWidth: w0, displayHeight: h0, timestamp: f.timestamp };
    if (px.check > 0) { px.check -= 1; m.copy = f; return { m, t: [data.buffer, f] }; }
    f.close(); return { m, t: [data.buffer] };
  } catch (err) { px = null; return null; }
};
const canRead = () => px != null && typeof OffscreenCanvas === 'function';
const give = (f) => { const p = canRead() ? prepare(f) : null; if (p) postMessage(p.m, p.t); else postMessage({ frame: f }, [f]); };
const drop = () => { if (ready) { try { ready.m.copy?.close(); } catch {} ready = null; } };
const read = async (readable) => {
  reader = readable.getReader();
  for (;;) {
    let r; try { r = await reader.read(); } catch (err) { postMessage({ error: String(err) }); break; }
    if (r.done) break;
    const f = r.value;
    if (active && !inFlight) { inFlight = true; give(f); }
    else if (active && ready == null && canRead()) { ready = prepare(f); if (!ready) f.close(); }
    else f.close();
  }
};
onmessage = async (e) => {
  const d = e.data;
  if (d.active != null) { active = d.active; if (!active) drop(); }
  if (d.pixels !== undefined) { px = d.pixels; if (!px) drop(); }
  if (d.wake != null) { clearTimeout(wake); wake = setTimeout(() => postMessage({ wake: true }), d.wake); }
  if (d.ack) { inFlight = false; if (ready && active) { inFlight = true; postMessage(ready.m, ready.t); ready = null; } }
  if (d.stop) { try { await reader?.cancel(); } catch {} if (clock) clearInterval(clock); try { own?.stop(); } catch {} close(); return; }
  if (d.clock) clock = setInterval(() => { if (active && !inFlight) { inFlight = true; postMessage({ tick: true }); } }, d.clock);
  if (d.track) {
    own = d.track;
    let readable = null;
    try { readable = new MediaStreamTrackProcessor({ track: own, maxBufferSize: 1 }).readable; } catch {}
    if (!readable) { try { own.stop(); } catch {} own = null; postMessage({ unsupported: true }); return; }
    read(readable);
  }
  if (d.readable) read(d.readable);
};`;

/**
 * The clock way's tick period: twice the camera's 30 a second, so a new frame waits at most about 17 ms. At one tick a
 * frame (33 ms), Firefox 159 hidden drew 26.2 of its fake camera's 30 new frames a second (bench bgprobe.html, 145 s).
 */
export const BACKGROUND_CLOCK_MS = 16;

/** The clock way's change check: a frame is new when this small copy of it differs (a camera's noise always does). */
const CHECK_W = 16;
const CHECK_H = 12;

/**
 * A worker-backed feed for the video track, or null where no way works (no Worker, a CSP that forbids Blob workers,
 * or neither a processor nor a video element to draw): the source then keeps its visible-only frames, as without the
 * option. The three ways, tried in order:
 * - a MediaStreamTrackProcessor on the page, its readable transferred (Chromium);
 * - the track transferred to the worker and the processor made there (Safari 18+, which has the processor only in
 *   dedicated workers: WebKitGTK 2.52.6 with Safari's default for it, on, read 19.3 of its mock camera's 19.3 frames a
 *   second hidden for 145 s, bench bgprobe.html, 2026-11-03);
 * - the clock, where there is no processor anywhere (Firefox 159: none on the page or in a worker, and its tracks are
 *   not transferable): a hidden page's worker timers and messages keep their rate while its own timers fall to 1 a
 *   second, so the worker ticks and on each tick the page draws `video` and hands the drawing over when it differs
 *   from the last (Firefox 159, 145 s hidden: 26.2 new frames a second of 30). A frame's time is the tick's.
 */
/**
 * Worker read: frames the worker draws at the analysis size and reads itself, handed over as bytes. Hidden, the
 * page's own read of a track frame (drawImage then getImageData) is a readback through the GPU process that the page's
 * thread waits for, several times the cost of reading a visible video frame, and on a throttled hidden page that wait
 * comes out of the frames it can analyse. A 2d OffscreenCanvas in the worker with no willReadFrequently gave the same
 * bytes as the page's own read on every frame compared (with willReadFrequently, or through a resized ImageBitmap, it
 * did not). Because a browser or GPU may draw otherwise, the first WORKER_READ_CHECK_FRAMES frames are read both ways
 * on the page and compared byte for byte; one difference and the worker read stops for good and that frame and every
 * later one are read on the page as before, so a number never moves because of where the read ran. Chromium's way
 * (the processor on the page) only: the Safari and Firefox ways are unchanged.
 */
export const WORKER_READ_CHECK_FRAMES = 30;

export interface BackgroundFrameFeedOptions {
	/** Worker read at this width at most (MAX_ANALYSIS_WIDTH; 0: full size); left out, frames are handed over as frames. */
	workerReadMaxWidth?: number;
}

export function createBackgroundFrameFeed(track: MediaStreamTrack, video?: HTMLVideoElement, options: BackgroundFrameFeedOptions = {}): BackgroundFrameFeed | null {
	const Proc = (globalThis as { MediaStreamTrackProcessor?: new (o: { track: MediaStreamTrack; maxBufferSize?: number }) => { readable: ReadableStream } }).MediaStreamTrackProcessor;
	if (typeof Worker === "undefined" || typeof Blob === "undefined") return null;
	const canClock = video != null && typeof VideoFrame === "function" && typeof document !== "undefined";
	let worker: Worker;
	let url = "";
	let own: MediaStreamTrack | null = null;
	let clockOn = false;
	const startClock = (): boolean => {
		if (!canClock) return false;
		if (!clockOn) worker.postMessage({ clock: BACKGROUND_CLOCK_MS });
		clockOn = true;
		return true;
	};
	try {
		url = URL.createObjectURL(new Blob([BACKGROUND_WORKER_SOURCE], { type: "text/javascript" }));
		worker = new Worker(url);
		if (typeof Proc === "function") {
			// A clone, so the page's own track and video element are untouched, and stopping the feed stops only this one.
			own = track.clone();
			// maxBufferSize 1: a frame not yet read is replaced by the newer one, so the worker never hands over a stale frame.
			const proc = new Proc({ track: own, maxBufferSize: 1 });
			if (options.workerReadMaxWidth != null && typeof document !== "undefined")
				worker.postMessage({ pixels: { maxWidth: options.workerReadMaxWidth, check: WORKER_READ_CHECK_FRAMES } });
			worker.postMessage({ readable: proc.readable }, [proc.readable as unknown as Transferable]);
		} else {
			const clone = track.clone();
			let sent = false;
			try {
				worker.postMessage({ track: clone }, [clone as unknown as Transferable]);
				sent = true;
			} catch {
				clone.stop();
			}
			// Not transferable (Firefox): the clock now, or no feed.
			if (!sent && !startClock()) throw new Error("no way to read the track hidden");
		}
	} catch {
		own?.stop();
		if (url) URL.revokeObjectURL(url);
		return null;
	}
	let canvas: HTMLCanvasElement | null = null;
	let check: HTMLCanvasElement | null = null;
	let last: Uint8ClampedArray | null = null;
	/** The clock way: the video as drawn now, as a frame, or null when it still shows the frame handed over last. */
	const drawn = (): VideoFrame | null => {
		const v = video as HTMLVideoElement;
		const w = v.videoWidth;
		const h = v.videoHeight;
		if (!w || !h) return null;
		canvas ??= document.createElement("canvas");
		check ??= Object.assign(document.createElement("canvas"), { width: CHECK_W, height: CHECK_H });
		if (canvas.width !== w || canvas.height !== h) Object.assign(canvas, { width: w, height: h });
		canvas.getContext("2d")?.drawImage(v, 0, 0, w, h);
		const cx = check.getContext("2d", { willReadFrequently: true });
		if (!cx) return null;
		cx.drawImage(canvas, 0, 0, CHECK_W, CHECK_H);
		const px = cx.getImageData(0, 0, CHECK_W, CHECK_H).data;
		const prev = last;
		if (prev && prev.length === px.length && px.every((x, i) => x === prev[i])) return null;
		last = px;
		return new VideoFrame(canvas, { timestamp: Math.round(performance.now() * 1000) });
	};
	const feed: BackgroundFrameFeed = {
		onFrame: null,
		onWake: null,
		wakeIn(ms) {
			worker.postMessage({ wake: Math.max(0, ms) });
		},
		setActive(active) {
			worker.postMessage({ active });
		},
		ack() {
			worker.postMessage({ ack: true });
		},
		close() {
			worker.postMessage({ stop: true });
			own?.stop();
			setTimeout(() => worker.terminate(), 1000);
			URL.revokeObjectURL(url);
		},
	};
	const give = (f: VideoFrame | BackgroundPixels) => {
		if (feed.onFrame) feed.onFrame(f);
		else {
			f.close();
			feed.ack();
		}
	};
	let verify: { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } | null = null;
	/** The page's own read of `frame` at w x h (the frame source's way: 2d, willReadFrequently, drawImage, getImageData). */
	const pageRead = (frame: VideoFrame, w: number, h: number): Uint8ClampedArray | null => {
		if (!verify) {
			const c = document.createElement("canvas");
			const x = c.getContext("2d", { willReadFrequently: true });
			if (!x) return null;
			verify = { canvas: c, ctx: x };
		}
		if (verify.canvas.width !== w || verify.canvas.height !== h) Object.assign(verify.canvas, { width: w, height: h });
		verify.ctx.drawImage(frame as unknown as CanvasImageSource, 0, 0, w, h);
		return verify.ctx.getImageData(0, 0, w, h).data;
	};
	/** Worker-read frames compared with the page's read, and whether the worker read is still on. */
	feed.workerRead = { checked: 0, differed: false };
	const givePixels = (d: { pixels: ArrayBuffer; width: number; height: number; displayWidth: number; displayHeight: number; timestamp: number; copy?: VideoFrame }) => {
		const pixels = new Uint8ClampedArray(d.pixels);
		const copy = d.copy;
		if (copy) {
			let same = false;
			try {
				const own = pageRead(copy, d.width, d.height);
				same = own != null && own.length === pixels.length && own.every((v, i) => v === pixels[i]);
			} catch {
				same = false;
			}
			const wr = feed.workerRead as { checked: number; differed: boolean };
			wr.checked += 1;
			if (!same) {
				// Off for good: this frame and every later one go over as frames, read on the page as without it.
				wr.differed = true;
				worker.postMessage({ pixels: null });
				give(copy);
				return;
			}
			copy.close();
		}
		give({ pixels, width: d.width, height: d.height, displayWidth: d.displayWidth, displayHeight: d.displayHeight, timestamp: d.timestamp, close() {} });
	};
	worker.onmessage = (ev: MessageEvent) => {
		const d = ev.data;
		if (d?.wake) feed.onWake?.();
		else if (d?.pixels) givePixels(d);
		else if (d?.frame) give(d.frame as VideoFrame);
		else if (d?.tick) {
			let f: VideoFrame | null = null;
			try {
				f = drawn();
			} catch {
				f = null;
			}
			if (f) give(f);
			else feed.ack();
		}
		// The track went over but the worker has no processor (WebKit with it off, Safari before 18): the clock instead.
		else if (d?.unsupported) startClock();
	};
	return feed;
}

/**
 * Session option backgroundEveryMs (with backgroundFrames): while hidden, measure in bursts instead of all the time,
 * as a wrist wearable reads daytime heart rate (a minute or so of measuring every few minutes, skipped when the wearer
 * is not still). A burst runs until a reading stands (the pulse check proves a rate, or the passive reader makes a
 * reading), then BACKGROUND_HOLD_MS more, and never longer than maxBurstMs. Between bursts the worker drops every frame
 * and the camera stays open: WebKit holds a hidden page's getUserMedia until the page is shown again (WebKitGTK 2.52.6,
 * 0 of 4 hidden reopens settled; Chromium and Firefox reopened every time), so a camera stopped between bursts would
 * end background readings in Safari. Bursts start every everyMs, counted from the last burst's start. The first burst starts when the
 * page is hidden, with the check as it was (a person who just left the page has its window full). A burst after a rest
 * starts with nothing kept: the frames stopped for longer than the check's and the reader's gap rules allow
 * (FACE_GONE_MS in pulseCheck.ts, PASSIVE_RESET_GAP_MS), so both start afresh, blink gate included.
 */
export interface BackgroundDutyOptions {
	everyMs: number;
	maxBurstMs?: number;
	holdMs?: number;
}

/**
 * The longest burst, ms. Chosen by replaying received recordings cut into fresh bursts, and the lab set, at 60, 90
 * and 120 s: the share of bursts with a reading rose with length on every device kind while the shown number's
 * accuracy did not change, for a few seconds more measuring per reading (numbers: the testbed's SDK changelog).
 */
export const BACKGROUND_MAX_BURST_MS = 120_000;
/**
 * After the first reading of a burst, measure this much longer. 0: holding 10 or 20 s more raised no device kind's
 * share of shown numbers near the reference beyond its noise on the same replays, and costs its seconds every burst.
 */
export const BACKGROUND_HOLD_MS = 0;

/** What the session reports of its readings (a mark): check evaluations made, whether it shows a proven rate, passive readings made. */
export interface BackgroundReadingMark {
	evaluations: number;
	measured: boolean;
	passive: number;
	/** The check's proven rate now and the newest passive reading's rate, bpm (kept as a burst's reading). */
	checkBpm?: number | null;
	passiveBpm?: number | null;
}

export interface BackgroundBurst {
	/** performance.now() ms, and the wall clock (Date.now()) at the start when the caller gave it. */
	startMs: number;
	startEpochMs: number | null;
	endMs: number | null;
	/** When the burst's first reading stood, ms after its start; null when none did. */
	readingAfterMs: number | null;
	/** That reading: its rate (bpm) and whether the check proved it or the passive reader made it. */
	bpm: number | null;
	source: "check" | "passive" | null;
}

/** The burst schedule, pure: the source calls it with performance.now() times and the session's reading marks. */
export class BackgroundDuty {
	readonly everyMs: number;
	readonly maxBurstMs: number;
	readonly holdMs: number;
	phase: "visible" | "burst" | "rest" = "visible";
	/** The newest bursts, oldest first (at most 64): diagnostics. */
	readonly bursts: BackgroundBurst[] = [];
	private startMs = 0;
	private readingMs: number | null = null;
	private mark: BackgroundReadingMark | null = null;

	constructor(o: BackgroundDutyOptions) {
		this.everyMs = Math.max(1000, o.everyMs);
		this.maxBurstMs = Math.min(this.everyMs, Math.max(1000, o.maxBurstMs ?? BACKGROUND_MAX_BURST_MS));
		this.holdMs = Math.max(0, o.holdMs ?? BACKGROUND_HOLD_MS);
	}

	/** The page went hidden (or a rest ended): a burst starts at `now` (`epochMs`: the wall clock then, for the record). */
	begin(now: number, mark: BackgroundReadingMark, epochMs: number | null = null): void {
		this.phase = "burst";
		this.startMs = now;
		this.readingMs = null;
		this.mark = mark;
		this.bursts.push({ startMs: now, startEpochMs: epochMs, endMs: null, readingAfterMs: null, bpm: null, source: null });
		if (this.bursts.length > 64) this.bursts.shift();
	}

	/** The page is visible at `now`: no schedule. */
	visible(now: number): void {
		if (this.phase === "burst") this.end(now);
		this.phase = "visible";
	}

	/**
	 * A frame analysed (or a wake) in a burst at `now`, with the session's mark after it: true while the burst goes on.
	 * A reading stands when the check has evaluated since the burst began and shows a proven rate, or the reader made a
	 * reading since then.
	 */
	step(now: number, mark: BackgroundReadingMark): boolean {
		if (this.phase !== "burst") return false;
		const m0 = this.mark as BackgroundReadingMark;
		const proven = mark.measured && mark.evaluations > m0.evaluations;
		if (this.readingMs == null && (proven || mark.passive > m0.passive)) {
			this.readingMs = now;
			const b = this.bursts[this.bursts.length - 1];
			if (b) {
				b.readingAfterMs = now - this.startMs;
				b.source = proven ? "check" : "passive";
				b.bpm = (proven ? mark.checkBpm : mark.passiveBpm) ?? null;
			}
		}
		const over = now - this.startMs >= this.maxBurstMs || (this.readingMs != null && now - this.readingMs >= this.holdMs);
		if (!over) return true;
		this.end(now);
		this.phase = "rest";
		return false;
	}

	/** When the schedule next needs a call (performance.now() ms): the burst's longest end, or the next burst's start. */
	nextMs(): number | null {
		if (this.phase === "burst") return this.startMs + this.maxBurstMs;
		if (this.phase === "rest") return this.startMs + this.everyMs;
		return null;
	}

	private end(now: number): void {
		const b = this.bursts[this.bursts.length - 1];
		if (b && b.endMs == null) b.endMs = now;
	}
}
