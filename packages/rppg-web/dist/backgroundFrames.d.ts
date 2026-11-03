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
    /** Worker read (createBackgroundFrameFeed's workerReadMaxWidth): frames compared with the page's own read, and whether one differed (it is then off). */
    workerRead?: {
        checked: number;
        differed: boolean;
    };
}
/**
 * The worker, one of three ways (createBackgroundFrameFeed picks): `readable` (a MediaStreamTrackProcessor made on the
 * page, Chromium), `track` (the track itself, transferred, and the processor made here: Safari 18+, whose
 * MediaStreamTrackProcessor exists only in a dedicated worker), or `clock` (no processor anywhere, Firefox: the worker
 * only ticks, and the page draws its own video element on each tick). While active it hands over one frame (or tick)
 * at a time and drops the rest.
 */
export declare const BACKGROUND_WORKER_SOURCE = "\nlet active = false, inFlight = false, reader = null, clock = null, own = null, px = null, cv = null, cx = null;\n// Worker read (px set): the frame drawn at the analysis size and read here, so the page's thread gets bytes, not a\n// frame to read back; the first px.check frames also go over as a copy, for the page to compare with its own read.\nconst give = (f) => {\n  if (px && typeof OffscreenCanvas === 'function') {\n    try {\n      const w0 = f.displayWidth, h0 = f.displayHeight, sc = px.maxWidth > 0 ? Math.min(1, px.maxWidth / w0) : 1;\n      const w = Math.max(1, Math.round(w0 * sc)), h = Math.max(1, Math.round(h0 * sc));\n      if (!cv || cv.width !== w || cv.height !== h) { cv = new OffscreenCanvas(w, h); cx = cv.getContext('2d'); }\n      cx.drawImage(f, 0, 0, w, h);\n      const data = cx.getImageData(0, 0, w, h).data;\n      const m = { pixels: data.buffer, width: w, height: h, displayWidth: w0, displayHeight: h0, timestamp: f.timestamp };\n      if (px.check > 0) { px.check -= 1; m.copy = f; postMessage(m, [data.buffer, f]); } else { f.close(); postMessage(m, [data.buffer]); }\n      return;\n    } catch (err) { px = null; }\n  }\n  postMessage({ frame: f }, [f]);\n};\nconst read = async (readable) => {\n  reader = readable.getReader();\n  for (;;) {\n    let r; try { r = await reader.read(); } catch (err) { postMessage({ error: String(err) }); break; }\n    if (r.done) break;\n    const f = r.value;\n    if (active && !inFlight) { inFlight = true; give(f); } else f.close();\n  }\n};\nonmessage = async (e) => {\n  const d = e.data;\n  if (d.active != null) active = d.active;\n  if (d.ack) inFlight = false;\n  if (d.pixels !== undefined) px = d.pixels;\n  if (d.stop) { try { await reader?.cancel(); } catch {} if (clock) clearInterval(clock); try { own?.stop(); } catch {} close(); return; }\n  if (d.clock) clock = setInterval(() => { if (active && !inFlight) { inFlight = true; postMessage({ tick: true }); } }, d.clock);\n  if (d.track) {\n    own = d.track;\n    let readable = null;\n    try { readable = new MediaStreamTrackProcessor({ track: own, maxBufferSize: 1 }).readable; } catch {}\n    if (!readable) { try { own.stop(); } catch {} own = null; postMessage({ unsupported: true }); return; }\n    read(readable);\n  }\n  if (d.readable) read(d.readable);\n};";
/**
 * The clock way's tick period: twice the camera's 30 a second, so a new frame waits at most about 17 ms. At one tick a
 * frame (33 ms), Firefox 159 hidden drew 26.2 of its fake camera's 30 new frames a second (bench bgprobe.html, 145 s).
 */
export declare const BACKGROUND_CLOCK_MS = 16;
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
export declare const WORKER_READ_CHECK_FRAMES = 30;
export interface BackgroundFrameFeedOptions {
    /** Worker read at this width at most (MAX_ANALYSIS_WIDTH; 0: full size); left out, frames are handed over as frames. */
    workerReadMaxWidth?: number;
}
export declare function createBackgroundFrameFeed(track: MediaStreamTrack, video?: HTMLVideoElement, options?: BackgroundFrameFeedOptions): BackgroundFrameFeed | null;
//# sourceMappingURL=backgroundFrames.d.ts.map