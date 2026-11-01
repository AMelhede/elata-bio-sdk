/** The user activations a refused lock is asked for again on (each is one in Safari and Chrome). */
export const WAKE_LOCK_RETRY_EVENTS = ["pointerup", "touchend", "click", "keydown"];
/** Holds a screen wake lock until the returned function is called. */
export function keepScreenOn(nav, doc, onState) {
    const api = nav.wakeLock;
    if (!api || typeof api.request !== "function") {
        onState("unsupported");
        return () => { };
    }
    let stopped = false;
    let held = null;
    let asking = false;
    const ask = () => {
        if (stopped || held || asking || doc.visibilityState !== "visible")
            return;
        asking = true;
        api.request("screen").then((s) => {
            asking = false;
            if (stopped) {
                void s.release().catch(() => { });
                return;
            }
            held = s;
            s.onrelease = () => {
                if (held === s)
                    held = null;
                if (!stopped)
                    onState("released");
            };
            onState("granted");
        }, (e) => {
            asking = false;
            const name = e instanceof Error ? e.name : e?.name ?? String(e);
            onState(`denied:${name}`);
            if (name === "NotAllowedError")
                waitForTap();
        });
    };
    let waiting = false;
    const onTap = () => {
        unwait();
        ask();
    };
    const waitForTap = () => {
        if (stopped || waiting)
            return;
        waiting = true;
        for (const t of WAKE_LOCK_RETRY_EVENTS)
            doc.addEventListener(t, onTap);
    };
    const unwait = () => {
        if (!waiting)
            return;
        waiting = false;
        for (const t of WAKE_LOCK_RETRY_EVENTS)
            doc.removeEventListener(t, onTap);
    };
    doc.addEventListener("visibilitychange", ask);
    ask();
    return () => {
        stopped = true;
        unwait();
        doc.removeEventListener("visibilitychange", ask);
        const s = held;
        held = null;
        if (s)
            void s.release().catch(() => { });
    };
}
