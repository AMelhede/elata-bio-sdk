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
/** The worker: reads the track's frames; while active, hands one over at a time and drops the rest. */
export declare const BACKGROUND_WORKER_SOURCE = "\nlet active = false, inFlight = false, reader = null;\nonmessage = async (e) => {\n  const d = e.data;\n  if (d.active != null) active = d.active;\n  if (d.ack) inFlight = false;\n  if (d.stop) { try { await reader?.cancel(); } catch {} close(); return; }\n  if (d.readable) {\n    reader = d.readable.getReader();\n    for (;;) {\n      let r; try { r = await reader.read(); } catch (err) { postMessage({ error: String(err) }); break; }\n      if (r.done) break;\n      const f = r.value;\n      if (active && !inFlight) { inFlight = true; postMessage({ frame: f }, [f]); } else f.close();\n    }\n  }\n};";
/**
 * A worker-backed feed for the video track, or null where the browser cannot read a track in a worker this way (no
 * MediaStreamTrackProcessor on the page, no Worker, a CSP that forbids Blob workers): the source then keeps its
 * visible-only frames, as without the option. Chromium exposes MediaStreamTrackProcessor on the page and lets its
 * readable be transferred; Safari and Firefox are not handled here (untested).
 */
export declare function createBackgroundFrameFeed(track: MediaStreamTrack): BackgroundFrameFeed | null;
//# sourceMappingURL=backgroundFrames.d.ts.map