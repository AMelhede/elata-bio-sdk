import { PulseCheck } from "../pulseCheck";

// A proven reading belongs to the face it came from. Found on the owner's laptop 2026-10-02:
// the check proved 67 from his face, the camera was turned to a wall, and 67 stayed on screen
// with no face in view, because nothing reached the check to change its mind.
function feed(check: PulseCheck, bpm: number, fromS: number, seconds: number) {
	let s = 7;
	const noise = () => ((s = (s * 16807) % 2147483647) / 2147483647 - 0.5) * 0.4;
	for (let t = fromS * 1000; t <= (fromS + seconds) * 1000; t += 1000 / 30) {
		const p = 0.01 * Math.sin((2 * Math.PI * bpm * t) / 60000);
		const region = () => ({ r: 150 * (1 - 0.3 * p) + noise(), g: 120 * (1 - p) + noise(), b: 100 * (1 - 0.6 * p) + noise() });
		check.push(t, [region(), region(), region()]);
	}
}
function noFace(check: PulseCheck, fromS: number, seconds: number) {
	for (let t = fromS * 1000; t <= (fromS + seconds) * 1000; t += 1000 / 30) check.faceLost(t);
}

describe("PulseCheck when the face leaves", () => {
	it("drops the rate once the face has been gone for a second", () => {
		const check = new PulseCheck();
		feed(check, 67, 0, 40);
		expect(check.getState().verdict).toBe("measured");
		noFace(check, 40.04, 1.1);
		expect(check.getState().bpm).toBeNull();
		expect(check.getState().verdict).toBe("unknown");
	});

	it("keeps the rate through a face-finder blip shorter than a second", () => {
		const check = new PulseCheck();
		feed(check, 67, 0, 40);
		noFace(check, 40.04, 0.5);
		expect(check.getState().verdict).toBe("measured");
		feed(check, 67, 40.6, 3);
		expect(check.getState().verdict).toBe("measured");
	});

	it("starts over when frames stop arriving for over a second, even unannounced", () => {
		const check = new PulseCheck();
		feed(check, 67, 0, 40);
		feed(check, 67, 43, 0.1);
		expect(check.getState().bpm).toBeNull();
	});

	it("has to prove the returning face from scratch", () => {
		const check = new PulseCheck();
		feed(check, 67, 0, 40);
		noFace(check, 40.04, 2);
		feed(check, 90, 42.1, 5);
		expect(check.getState().bpm).toBeNull();
	});
});
