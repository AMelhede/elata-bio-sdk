/**
 * With `framesSeen`, a camera that reports itself live on return but sends no frame within `stallMs` is started again
 * too: a browser on a phone can unmute the track yet never hand the page another frame. Recorded returns resume within
 * a fraction of a second, the slowest within a few seconds; the default is about twice that slowest return.
 */
export const CAMERA_RETURN_STALL_MS = 6000;
export function watchCameraReturn(track, onEnded, doc = document, opts = {}) {
    const setTimer = opts.setTimer ?? ((f, ms) => setTimeout(f, ms));
    const clearTimer = opts.clearTimer ?? ((h) => clearTimeout(h));
    let pending = null;
    const onVisible = () => {
        if (pending != null) {
            clearTimer(pending);
            pending = null;
        }
        if (doc.visibilityState !== "visible")
            return;
        const t = track();
        if (!t || t.readyState === "ended") {
            onEnded();
            return;
        }
        const framesSeen = opts.framesSeen;
        if (!framesSeen)
            return;
        const before = framesSeen();
        pending = setTimer(() => {
            pending = null;
            if (doc.visibilityState !== "visible")
                return;
            const now = track();
            if (now && now.readyState !== "ended" && framesSeen() === before)
                onEnded();
        }, opts.stallMs ?? CAMERA_RETURN_STALL_MS);
    };
    doc.addEventListener("visibilitychange", onVisible);
    return () => {
        if (pending != null)
            clearTimer(pending);
        doc.removeEventListener("visibilitychange", onVisible);
    };
}
