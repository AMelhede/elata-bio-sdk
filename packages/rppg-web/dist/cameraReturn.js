/**
 * With `framesSeen`, a camera that reports itself live on return but sends no frame within `stallMs` is started again
 * too. Firefox on Android (the owner's phone, 2026-11-03): back from another app the track unmuted, yet no frame reached
 * the page for the 12 s before the file was saved. On every received file that records visibility, frames resumed 0.01
 * to 0.06 s after a return, once 2.91 s (the owner's 35-minute background run); 6 s is about twice that slowest return.
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
