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
});
