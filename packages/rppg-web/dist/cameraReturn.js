export function watchCameraReturn(track, onEnded, doc = document) {
    const onVisible = () => {
        if (doc.visibilityState !== "visible")
            return;
        const t = track();
        if (!t || t.readyState === "ended")
            onEnded();
    };
    doc.addEventListener("visibilitychange", onVisible);
    return () => doc.removeEventListener("visibilitychange", onVisible);
}
