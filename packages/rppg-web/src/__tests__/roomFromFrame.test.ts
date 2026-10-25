import { RecordingPulseCheck, parsePulseCheckRecording, replayPulseCheck } from "../index";
import { ROOM_CORNER_SHARE, roomFromFrame } from "../pulseCheck";

// lane/wallroom step 1: the room in the frame's upper corners, recorded only.
type F = Parameters<typeof roomFromFrame>[0];
function frame(width: number, height: number, paint: (x: number, y: number) => [number, number, number]): F {
	const data = new Uint8ClampedArray(width * height * 4);
	for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data.set([...paint(x, y), 255], (y * width + x) * 4);
	return { data, width, height, timestampMs: 0 } as unknown as F;
}
// A face box as mesh points, normalised: an oval's worth of points filling [x0,x1] x [y0,y1].
function face(x0: number, x1: number, y0: number, y1: number) {
	const pts = [];
	for (let i = 0; i <= 20; i++) for (let j = 0; j <= 20; j++) pts.push({ x: x0 + ((x1 - x0) * i) / 20, y: y0 + ((y1 - y0) * j) / 20 });
	return pts;
}

describe("roomFromFrame (recorded only)", () => {
	it("recovers a 1% lamp at 72 a minute on a dark, noisy wall that no single pixel shows", () => {
		// Wall at 30 DN with +-3 DN noise: a 1% lamp is 0.3 DN, under one step and under the noise.
		let s = 5;
		const noise = () => ((s = (s * 16807) % 2147483647) / 2147483647 - 0.5) * 6;
		const fps = 30, n = 16 * fps, width = 160, height = 120;
		const series: number[] = [];
		for (let i = 0; i < n; i++) {
			const g = 1 + 0.01 * Math.sin((2 * Math.PI * 1.2 * i) / fps);
			const f = frame(width, height, () => { const v = Math.round(30 * g + noise()); return [v, v, v]; });
			series.push(roomFromFrame(f, face(0.35, 0.65, 0.3, 0.8))!.rgb.g);
		}
		const proj = (hz: number) => { let c = 0, d = 0; const m = series.reduce((a, b) => a + b, 0) / n;
			series.forEach((v, i) => { c += (v - m) * Math.sin((2 * Math.PI * hz * i) / fps); d += (v - m) * Math.cos((2 * Math.PI * hz * i) / fps); });
			return Math.hypot(c, d); };
		const others = [0.8, 0.9, 1.5, 1.7, 2.0, 2.3, 2.6].map(proj).sort((a, b) => a - b);
		expect(proj(1.2) / others[3]).toBeGreaterThan(10);
	});

	it("leaves out a face that reaches into a corner, and everything near it", () => {
		const width = 200, height = 100;
		// Face box in the top-left corner, painted bright; the rest of the room grey 50.
		const pts = face(0.0, 0.1, 0.0, 0.15);
		const f = frame(width, height, (x, y) => (x < 0.1 * width && y < 0.15 * height ? [250, 250, 250] : [50, 50, 50]));
		const r = roomFromFrame(f, pts)!;
		expect(r.rgb.g).toBeCloseTo(50 / 255, 6);
		// Fewer pixels than the two full corners: the face and its margin are out.
		expect(r.n).toBeLessThan(2 * Math.floor(width * ROOM_CORNER_SHARE) * Math.floor(height * ROOM_CORNER_SHARE));
	});

	it("gives null when the corners are skin-coloured, or too small to average", () => {
		expect(roomFromFrame(frame(200, 100, () => [200, 150, 120]), null)).toBeNull();
		expect(roomFromFrame(frame(10, 10, () => [50, 50, 50]), null)).toBeNull();
	});

	it("is kept by a recording and changes no read on replay (planted null)", () => {
		const rec = new RecordingPulseCheck();
		expect(rec.wantsDiagnostics).toBe(true);
		const plain = new RecordingPulseCheck();
		for (let t = 0; t <= 20000; t += 1000 / 30) {
			const p = 0.01 * Math.sin((2 * Math.PI * 70 * t) / 60000);
			const reg = { r: 150 * (1 - 0.3 * p), g: 120 * (1 - p), b: 100 * (1 - 0.6 * p) };
			const wall = { r: 0.4, g: 0.4, b: 0.4 };
			rec.push(t, [reg, reg, reg], wall, undefined, null, wall, { room: { rgb: wall, n: 500 }, patch: [1, 2, 3, 4, 12] });
			plain.push(t, [reg, reg, reg], wall, undefined, null, wall);
		}
		const a = parsePulseCheckRecording(JSON.stringify(rec.getRecording()));
		const b = parsePulseCheckRecording(JSON.stringify(plain.getRecording()));
		const f = a.events.find((e) => e[0] === "f")!;
		expect(f[7]).toEqual([0.4, 0.4, 0.4, 500]);
		expect(f[8]).toEqual([1, 2, 3, 4, 12]);
		expect(replayPulseCheck(a).reads.map((r) => r.bpm)).toEqual(replayPulseCheck(b).reads.map((r) => r.bpm));
	});

	it("writes the room to 7 decimals (no distinct value lost at the stride's pixel counts) and the patch as given", () => {
		const rec = new RecordingPulseCheck();
		const reg = { r: 0.5, g: 0.4, b: 0.3 };
		rec.push(0, [reg, reg, reg], undefined, undefined, null, undefined, { room: { rgb: { r: 0.123456789, g: 0.2, b: 1 / 3 }, n: 6144 }, patch: [10, 20, 30, 40, 900] });
		const f = rec.getRecording().events.find((e) => e[0] === "f")!;
		expect(f[7]).toEqual([0.1234568, 0.2, 0.3333333, 6144]);
		expect(f[8]).toEqual([10, 20, 30, 40, 900]);
	});
});
