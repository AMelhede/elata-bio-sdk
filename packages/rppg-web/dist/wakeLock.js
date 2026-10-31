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
            onState(`denied:${e instanceof Error ? e.name : String(e)}`);
        });
    };
    doc.addEventListener("visibilitychange", ask);
    ask();
    return () => {
        stopped = true;
        doc.removeEventListener("visibilitychange", ask);
        const s = held;
        held = null;
        if (s)
            void s.release().catch(() => { });
    };
}
