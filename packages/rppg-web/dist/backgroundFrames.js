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
 * The worker, one of three ways (createBackgroundFrameFeed picks): `readable` (a MediaStreamTrackProcessor made on the
 * page, Chromium), `track` (the track itself, transferred, and the processor made here: Safari 18+, whose
 * MediaStreamTrackProcessor exists only in a dedicated worker), or `clock` (no processor anywhere, Firefox: the worker
 * only ticks, and the page draws its own video element on each tick). While active it hands over one frame (or tick)
 * at a time and drops the rest.
 */
export const BACKGROUND_WORKER_SOURCE = `
let active = false, inFlight = false, reader = null, clock = null, own = null;
const read = async (readable) => {
  reader = readable.getReader();
  for (;;) {
    let r; try { r = await reader.read(); } catch (err) { postMessage({ error: String(err) }); break; }
    if (r.done) break;
    const f = r.value;
    if (active && !inFlight) { inFlight = true; postMessage({ frame: f }, [f]); } else f.close();
  }
};
onmessage = async (e) => {
  const d = e.data;
  if (d.active != null) active = d.active;
  if (d.ack) inFlight = false;
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
export function createBackgroundFrameFeed(track, video) {
    const Proc = globalThis.MediaStreamTrackProcessor;
    if (typeof Worker === "undefined" || typeof Blob === "undefined")
        return null;
    const canClock = video != null && typeof VideoFrame === "function" && typeof document !== "undefined";
    let worker;
    let url = "";
    let own = null;
    let clockOn = false;
    const startClock = () => {
        if (!canClock)
            return false;
        if (!clockOn)
            worker.postMessage({ clock: BACKGROUND_CLOCK_MS });
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
            worker.postMessage({ readable: proc.readable }, [proc.readable]);
        }
        else {
            const clone = track.clone();
            let sent = false;
            try {
                worker.postMessage({ track: clone }, [clone]);
                sent = true;
            }
            catch {
                clone.stop();
            }
            // Not transferable (Firefox): the clock now, or no feed.
            if (!sent && !startClock())
                throw new Error("no way to read the track hidden");
        }
    }
    catch {
        own?.stop();
        if (url)
            URL.revokeObjectURL(url);
        return null;
    }
    let canvas = null;
    let check = null;
    let last = null;
    /** The clock way: the video as drawn now, as a frame, or null when it still shows the frame handed over last. */
    const drawn = () => {
        const v = video;
        const w = v.videoWidth;
        const h = v.videoHeight;
        if (!w || !h)
            return null;
        canvas ?? (canvas = document.createElement("canvas"));
        check ?? (check = Object.assign(document.createElement("canvas"), { width: CHECK_W, height: CHECK_H }));
        if (canvas.width !== w || canvas.height !== h)
            Object.assign(canvas, { width: w, height: h });
        canvas.getContext("2d")?.drawImage(v, 0, 0, w, h);
        const cx = check.getContext("2d", { willReadFrequently: true });
        if (!cx)
            return null;
        cx.drawImage(canvas, 0, 0, CHECK_W, CHECK_H);
        const px = cx.getImageData(0, 0, CHECK_W, CHECK_H).data;
        const prev = last;
        if (prev && prev.length === px.length && px.every((x, i) => x === prev[i]))
            return null;
        last = px;
        return new VideoFrame(canvas, { timestamp: Math.round(performance.now() * 1000) });
    };
    const feed = {
        onFrame: null,
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
    const give = (f) => {
        if (feed.onFrame)
            feed.onFrame(f);
        else {
            f.close();
            feed.ack();
        }
    };
    worker.onmessage = (ev) => {
        const d = ev.data;
        if (d?.frame)
            give(d.frame);
        else if (d?.tick) {
            let f = null;
            try {
                f = drawn();
            }
            catch {
                f = null;
            }
            if (f)
                give(f);
            else
                feed.ack();
        }
        // The track went over but the worker has no processor (WebKit with it off, Safari before 18): the clock instead.
        else if (d?.unsupported)
            startClock();
    };
    return feed;
}
