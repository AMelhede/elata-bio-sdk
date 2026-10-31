/**
 * Keep the screen on while the camera reads, the way native heart-rate apps do during a measurement.
 *
 * Why: a reading means sitting still without touching the phone. iPhone Auto-Lock defaults to 30 s and many Android
 * phones dim at 30 s, and a muted camera feed does not hold the screen on, so the screen dimmed and then locked partway
 * through a 60 to 90 s reading, which stops the camera. The Screen Wake Lock API (Chrome 84, Safari 16.4) holds it.
 * The browser drops the lock whenever the page is hidden, so it is asked for again each time the page is visible.
 *
 * Reports each state to `onState` for the saved file: granted, released, unsupported, or denied:<error name>.
 */
export type WakeLockState = "granted" | "released" | "unsupported" | `denied:${string}`;
interface Sentinel {
    release(): Promise<void>;
    onrelease: (() => void) | null;
}
interface NavLike {
    wakeLock?: {
        request(type: "screen"): Promise<Sentinel>;
    };
}
interface DocLike {
    visibilityState: string;
    addEventListener(type: "visibilitychange", f: () => void): void;
    removeEventListener(type: "visibilitychange", f: () => void): void;
}
/** Holds a screen wake lock until the returned function is called. */
export declare function keepScreenOn(nav: NavLike, doc: DocLike, onState: (s: WakeLockState) => void): () => void;
export {};
//# sourceMappingURL=wakeLock.d.ts.map