import { watchCameraReturn } from "../cameraReturn";

describe("watchCameraReturn", () => {
	const fakeDoc = () => {
		let fn: (() => void) | null = null;
		const d = {
			visibilityState: "hidden" as DocumentVisibilityState,
			addEventListener: (_: string, f: () => void) => { fn = f; },
			removeEventListener: () => { fn = null; },
			fire(state: DocumentVisibilityState) { d.visibilityState = state; fn?.(); },
			get watching() { return fn != null; },
		};
		return d;
	};
	it("restarts only on return to a visible page with the track ended or gone", () => {
		const d = fakeDoc();
		let calls = 0;
		let track: { readyState: MediaStreamTrackState } | null = { readyState: "live" };
		const stop = watchCameraReturn(() => track, () => calls++, d as never);
		d.fire("visible");
		expect(calls).toBe(0);
		track = { readyState: "ended" };
		d.fire("hidden");
		expect(calls).toBe(0);
		d.fire("visible");
		expect(calls).toBe(1);
		track = null;
		d.fire("visible");
		expect(calls).toBe(2);
		stop();
		expect(d.watching).toBe(false);
	});
	it("restarts a live camera that sends no frame after the page is back (Firefox on Android, 2026-11-03)", () => {
		const d = fakeDoc();
		let calls = 0;
		let frames = 100;
		const timers: (() => void)[] = [];
		const stop = watchCameraReturn(() => ({ readyState: "live" }), () => calls++, d as never, {
			framesSeen: () => frames,
			setTimer: (f: () => void) => { timers.push(f); return timers.length; },
			clearTimer: () => {},
		});
		// Frames come back: no restart.
		d.fire("visible");
		frames += 30;
		timers.shift()?.();
		expect(calls).toBe(0);
		// The camera reports live but no frame arrives: one restart.
		d.fire("hidden");
		d.fire("visible");
		timers.shift()?.();
		expect(calls).toBe(1);
		// Hidden again before the check runs: no restart.
		d.fire("visible");
		d.fire("hidden");
		timers.shift()?.();
		expect(calls).toBe(1);
		stop();
	});
});
