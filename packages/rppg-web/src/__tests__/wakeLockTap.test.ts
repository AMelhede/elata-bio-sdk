import { keepScreenOn, WAKE_LOCK_RETRY_EVENTS } from "../wakeLock";

// Safari on iPhone: refused outside a tap (NotAllowedError), granted inside one.
function doc() {
	const ls = new Map<string, Set<() => void>>();
	return {
		visibilityState: "visible",
		addEventListener: (t: string, f: () => void) => { if (!ls.has(t)) ls.set(t, new Set()); ls.get(t)!.add(f); },
		removeEventListener: (t: string, f: () => void) => { ls.get(t)?.delete(f); },
		fire: (t: string) => { for (const f of [...(ls.get(t) ?? [])]) f(); },
		count: (t: string) => ls.get(t)?.size ?? 0,
	};
}
function safariLock() {
	let tapping = false; let asks = 0;
	return {
		get asks() { return asks; },
		tap(d: ReturnType<typeof doc>, t = "touchend") { tapping = true; d.fire(t); tapping = false; },
		wakeLock: { request: (_t: string) => { asks++; return tapping ? Promise.resolve({ release: async () => {}, onrelease: null }) : Promise.reject(Object.assign(new Error("not in a gesture"), { name: "NotAllowedError" })); } },
	};
}
const tick = () => new Promise((r) => setTimeout(r, 0));

describe("wake lock on Safari (granted only during a tap)", () => {
	it("refused at start, then asked again and granted on the next tap", async () => {
		const d = doc(), lock = safariLock(), states: string[] = [];
		keepScreenOn(lock as never, d, (s) => states.push(s));
		await tick();
		expect(states).toEqual(["denied:NotAllowedError"]);
		for (const t of WAKE_LOCK_RETRY_EVENTS) expect(d.count(t)).toBe(1);
		lock.tap(d);
		await tick();
		expect(states).toEqual(["denied:NotAllowedError", "granted"]);
		for (const t of WAKE_LOCK_RETRY_EVENTS) expect(d.count(t)).toBe(0);
		expect(lock.asks).toBe(2);
	});
	it("stopping removes the tap listeners", async () => {
		const d = doc(), lock = safariLock();
		const stop = keepScreenOn(lock as never, d, () => {});
		await tick();
		stop();
		for (const t of WAKE_LOCK_RETRY_EVENTS) expect(d.count(t)).toBe(0);
	});
	it("another refusal (not NotAllowedError) does not wait for taps", async () => {
		const d = doc(), states: string[] = [];
		keepScreenOn({ wakeLock: { request: () => Promise.reject(Object.assign(new Error("x"), { name: "AbortError" })) } } as never, d, (s) => states.push(s));
		await tick();
		expect(states).toEqual(["denied:AbortError"]);
		for (const t of WAKE_LOCK_RETRY_EVENTS) expect(d.count(t)).toBe(0);
	});
});
