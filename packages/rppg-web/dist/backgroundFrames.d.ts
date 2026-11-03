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
/** What the frame source needs of a background feed (a worker in a browser, a fake in tests). */
export interface BackgroundFrameFeed {
    /** Each frame the worker hands over while `active`; the callee must close() it. */
    onFrame: ((frame: VideoFrame) => void) | null;
    /** Hand frames over (true) or drop them in the worker (false). */
    setActive(active: boolean): void;
    /** The frame handed over last is done with: the next may come (one frame in flight, never a queue). */
    ack(): void;
    close(): void;
}
/**
 * The worker, one of three ways (createBackgroundFrameFeed picks): `readable` (a MediaStreamTrackProcessor made on the
 * page, Chromium), `track` (the track itself, transferred, and the processor made here: Safari 18+, whose
 * MediaStreamTrackProcessor exists only in a dedicated worker), or `clock` (no processor anywhere, Firefox: the worker
 * only ticks, and the page draws its own video element on each tick). While active it hands over one frame (or tick)
 * at a time and drops the rest.
 */
export declare const BACKGROUND_WORKER_SOURCE = "\nlet active = false, inFlight = false, reader = null, clock = null, own = null;\nconst read = async (readable) => {\n  reader = readable.getReader();\n  for (;;) {\n    let r; try { r = await reader.read(); } catch (err) { postMessage({ error: String(err) }); break; }\n    if (r.done) break;\n    const f = r.value;\n    if (active && !inFlight) { inFlight = true; postMessage({ frame: f }, [f]); } else f.close();\n  }\n};\nonmessage = async (e) => {\n  const d = e.data;\n  if (d.active != null) active = d.active;\n  if (d.ack) inFlight = false;\n  if (d.stop) { try { await reader?.cancel(); } catch {} if (clock) clearInterval(clock); try { own?.stop(); } catch {} close(); return; }\n  if (d.clock) clock = setInterval(() => { if (active && !inFlight) { inFlight = true; postMessage({ tick: true }); } }, d.clock);\n  if (d.track) {\n    own = d.track;\n    let readable = null;\n    try { readable = new MediaStreamTrackProcessor({ track: own, maxBufferSize: 1 }).readable; } catch {}\n    if (!readable) { try { own.stop(); } catch {} own = null; postMessage({ unsupported: true }); return; }\n    read(readable);\n  }\n  if (d.readable) read(d.readable);\n};";
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
export declare function createBackgroundFrameFeed(track: MediaStreamTrack, video?: HTMLVideoElement): BackgroundFrameFeed | null;
//# sourceMappingURL=backgroundFrames.d.ts.map