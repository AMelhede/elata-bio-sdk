/**
 * The timer path (no requestVideoFrameCallback: Safari before 15.4, Firefox before 132, KaiOS) reads the video at a
 * fixed rate whatever the camera sends, so a camera slower than the timer is read more than once per frame. Those
 * copies are not samples: at 7.5 fps under a 30 Hz timer each frame came in 4 times, runs the heldFrames rule takes for
 * a video encoder, and every window was thrown away (150 recorded lab faces: 0 seconds with a number per 100, against 27.5
 * when each frame was read once). This gate lets a read through only when the video has presented a new frame, by the
 * browser's own count (getVideoPlaybackQuality().totalVideoFrames). Where the count is missing, or does not move while
 * the timer runs from the start (a browser that does not count a live stream's frames), it lets every read through:
 * today's path. Once the count has moved, a stall reads as no new frame (a gap, which the check bridges), never as copies.
 */
export const ADVANCE_TRUST_READS = 30;
export function frameAdvanceGate(video) {
    const v = video;
    let last = null;
    let still = 0;
    let moved = 0;
    let off = typeof v?.getVideoPlaybackQuality !== "function";
    return () => {
        if (off)
            return true;
        let n;
        try {
            n = v.getVideoPlaybackQuality?.().totalVideoFrames;
        }
        catch {
            n = undefined;
        }
        if (typeof n !== "number" || !Number.isFinite(n)) {
            off = true;
            return true;
        }
        if (last == null || n !== last) {
            if (last != null)
                moved++;
            last = n;
            still = 0;
            return true;
        }
        // The count has not moved: a copy of the frame already read, unless it never moves at all.
        if (moved === 0 && ++still >= ADVANCE_TRUST_READS) {
            off = true;
            return true;
        }
        return false;
    };
}
