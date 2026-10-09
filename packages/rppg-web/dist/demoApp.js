import { createRppgSession } from "./rppgSession.js";
export async function initDemo(videoEl, opts = {}) {
    const session = await createRppgSession({
        video: videoEl,
        backend: "auto",
        faceMesh: "auto",
        // The rate shown is the pulse check's, which the engine's rate tracker does not move.
        enableTracker: false,
        roiSmoothingAlpha: 0.25,
        useSkinMask: true,
        ...opts,
    });
    const { source, processor: proc, runner } = session;
    // expose info for debugging
    window.__rppg_demo = {
        source,
        proc,
        runner,
        session,
        backendAvailable: session.backendMode === "wasm",
    };
    return { source, proc, runner, session };
}
