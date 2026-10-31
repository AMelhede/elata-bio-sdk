/**
 * Back on the page, a camera the browser stopped while it was hidden (or never handed over) is started again, the way a
 * video call app's camera comes back: `onEnded` runs when the page becomes visible and the track is gone or ended. Pair
 * it with `session.getPulseCheckResume()` handed to the new session as `pulseCheckResume`, so the same heart shows again
 * within seconds. Returns the function that stops watching.
 */
type VisibilityDoc = Pick<Document, "addEventListener" | "removeEventListener" | "visibilityState">;
export declare function watchCameraReturn(track: () => Pick<MediaStreamTrack, "readyState"> | null | undefined, onEnded: () => void, doc?: VisibilityDoc): () => void;
export {};
//# sourceMappingURL=cameraReturn.d.ts.map