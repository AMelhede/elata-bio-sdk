import { headAngles, headCentre } from "../pulseCheck";

/** A mesh with every point at the centre and the four angle points placed on a face rotated by known angles. */
function mesh(yaw: number, pitch: number, roll: number, w = 640, h = 480) {
	const pts = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
	const r = Math.PI / 180;
	const rot = (x: number, y: number, z: number) => {
		// roll about z, then pitch about x, then yaw about y (pixels; z in pixels too)
		let [a, b, c] = [x * Math.cos(roll * r) - y * Math.sin(roll * r), x * Math.sin(roll * r) + y * Math.cos(roll * r), z];
		[b, c] = [b * Math.cos(pitch * r) - c * Math.sin(pitch * r), b * Math.sin(pitch * r) + c * Math.cos(pitch * r)];
		[a, c] = [a * Math.cos(yaw * r) + c * Math.sin(yaw * r), -a * Math.sin(yaw * r) + c * Math.cos(yaw * r)];
		return { x: 0.5 + a / w, y: 0.5 + b / h, z: c / w };
	};
	pts[234] = rot(-70, 0, 0);
	pts[454] = rot(70, 0, 0);
	pts[10] = rot(0, -90, 0);
	pts[152] = rot(0, 90, 0);
	return pts;
}

describe("headAngles", () => {
	it("recovers a known yaw, pitch and roll on their own", () => {
		for (const a of [-35, -20, -10, 0, 10, 20, 35]) {
			expect(headAngles(mesh(a, 0, 0), 640, 480)!.yawDeg).toBeCloseTo(-a, 6);
			expect(headAngles(mesh(0, a, 0), 640, 480)!.pitchDeg).toBeCloseTo(a, 6);
			expect(headAngles(mesh(0, 0, a), 640, 480)!.rollDeg).toBeCloseTo(a, 6);
		}
	});
	it("a 20 degree turn reads as a 20 degree change against straight on, whatever the frame size", () => {
		for (const [w, h] of [[640, 480], [1280, 720]]) {
			const d = headAngles(mesh(20, 0, 0, w, h), w, h)!.yawDeg - headAngles(mesh(0, 0, 0, w, h), w, h)!.yawDeg;
			expect(Math.abs(d)).toBeCloseTo(20, 6);
		}
	});
	it("no depth, no angles: headCentre then carries none", () => {
		const flat = mesh(0, 0, 0).map(({ x, y }) => ({ x, y }));
		expect(headAngles(flat, 640, 480)).toBeNull();
		expect(headCentre(flat, 640, 480)!.yawDeg).toBeUndefined();
		expect(headCentre(mesh(10, 0, 0), 640, 480)!.yawDeg).toBeCloseTo(-10, 6);
	});
});

describe("the recording keeps the head angles", () => {
	it("writes yaw, pitch and roll after mouthOpen (null when absent), and replays the same as without them", async () => {
		const { RecordingPulseCheck, replayPulseCheck, parsePulseCheckRecording, serializePulseCheckRecording } = await import("../pulseCheckRecording");
		const rec = new RecordingPulseCheck();
		const plain = new RecordingPulseCheck();
		for (let i = 0; i < 300; i++) {
			const t = i * 33.3;
			const v = 100 + Math.sin((2 * Math.PI * t) / 860);
			const regions = [{ r: v, g: v, b: v }, { r: v, g: v, b: v }, { r: v, g: v, b: v }];
			rec.push(t, regions, undefined, undefined, { x: 320, y: 240, faceWidth: 140, yawDeg: 12.5, pitchDeg: -3, rollDeg: 1 });
			plain.push(t, regions, undefined, undefined, { x: 320, y: 240, faceWidth: 140 });
		}
		const f = rec.getRecording().events.find((e) => e[0] === "f")!;
		expect(f[6]).toEqual([320, 240, 140, null, 12.5, -3, 1]);
		const back = parsePulseCheckRecording(serializePulseCheckRecording(rec.getRecording()));
		expect(replayPulseCheck(back).evaluations.map((e) => e.state)).toEqual(replayPulseCheck(plain.getRecording()).evaluations.map((e) => e.state));
	});
});
