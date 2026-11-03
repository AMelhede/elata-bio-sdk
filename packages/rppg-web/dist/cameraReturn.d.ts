/**
 * Back on the page, a camera the browser stopped while it was hidden (or never handed over) is started again, the way a
 * video call app's camera comes back: `onEnded` runs when the page becomes visible and the track is gone or ended. Pair
 * it with `session.getPulseCheckResume()` handed to the new session as `pulseCheckResume`, so the same heart shows again
 * within seconds. Returns the function that stops watching.
 */
type VisibilityDoc = Pick<Document, "addEventListener" | "removeEventListener" | "visibilityState">;
/**
 * With `framesSeen`, a camera that reports itself live on return but sends no frame within `stallMs` is started again
 * too: a browser on a phone can unmute the track yet never hand the page another frame. Recorded returns resume within
 * a fraction of a second, the slowest within a few seconds; the default is about twice that slowest return.
 */
export declare const CAMERA_RETURN_STALL_MS = 6000;
export declare function watchCameraReturn(track: () => Pick<MediaStreamTrack, "readyState"> | null | undefined, onEnded: () => void, doc?: VisibilityDoc, opts?: {
    framesSeen?: () => number;
    stallMs?: number;
    setTimer?: (f: () => void, ms: number) => unknown;
    clearTimer?: (h: unknown) => void;
}): () => void;
export {};
//# sourceMappingURL=cameraReturn.d.ts.map