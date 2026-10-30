import { RecordingPulseCheck, parsePulseCheckRecording, replayPulseCheck } from "../index";
import { ROOM_CORNER_SHARE, combineRoom, roomFromFrame } from "../pulseCheck";

// lane/wallroom: the room in the frame's two upper corners, each corner on its own.
type F = Parameters<typeof roomFromFrame>[0];
function frame(width: number, height: number, paint: (x: number, y: number) => [number, number, number]): F {
	const data = new Uint8ClampedArray(width * height * 4);
	for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data.set([...paint(x, y), 255], (y * width + x) * 4);
	return { data, width, height, timestampMs: 0 } as unknown as F;
}
// A face box as mesh points, normalised, filling [x0,x1] x [y0,y1].
function face(x0: number, x1: number, y0: number, y1: number) {
	const pts = [];
	for (let i = 0; i <= 20; i++) for (let j = 0; j <= 20; j++) pts.push({ x: x0 + ((x1 - x0) * i) / 20, y: y0 + ((y1 - y0) * j) / 20 });
	return pts;
}

describe("roomFromFrame", () => {
	it("recovers a 1% lamp at 72 a minute on a dark, noisy wall that no single pixel shows", () => {
		// Wall at 30 DN with +-3 DN noise: a 1% lamp is 0.3 DN, under one step and under the noise.
		let s = 5;
		const noise = () => ((s = (s * 16807) % 2147483647) / 2147483647 - 0.5) * 6;
		const fps = 30, n = 16 * fps, width = 160, height = 120;
		const series: number[] = [];
		for (let i = 0; i < n; i++) {
			const g = 1 + 0.01 * Math.sin((2 * Math.PI * 1.2 * i) / fps);
			const f = frame(width, height, () => { const v = Math.round(30 * g + noise()); return [v, v, v]; });
			series.push(combineRoom(roomFromFrame(f, face(0.35, 0.65, 0.3, 0.8)))!.g);
		}
		const proj = (hz: number) => { let c = 0, d = 0; const m = series.reduce((a, b) => a + b, 0) / n;
			series.forEach((v, i) => { c += (v - m) * Math.sin((2 * Math.PI * hz * i) / fps); d += (v - m) * Math.cos((2 * Math.PI * hz * i) / fps); });
			return Math.hypot(c, d); };
		const others = [0.8, 0.9, 1.5, 1.7, 2.0, 2.3, 2.6].map(proj).sort((a, b) => a - b);
		expect(proj(1.2) / others[3]).toBeGreaterThan(10);
	});

	it("leaves out the face and the ROOM_FACE_CLEAR margin around it, in the corner the face reaches only", () => {
		const width = 400, height = 200;
		// Face box: x 0..0.06 of the width, y 0..0.1 of the height (24 x 20 px, face width 24 px, margin 12 px).
		// Bright inside the face AND in a band 1 to 11 px outside it: all of it must be left out of the left corner.
		const fw = 0.06 * width, fh = 0.1 * height;
		const f = frame(width, height, (x, y) => (x <= fw + 11 && y <= fh + 11 ? [250, 250, 250] : [50, 50, 50]));
		const r = roomFromFrame(f, face(0, 0.06, 0, 0.1))!;
		expect(r.left!.rgb.g).toBeCloseTo(50 / 255, 6);
		expect(r.right!.rgb.g).toBeCloseTo(50 / 255, 6);
		// The left corner lost pixels to the face and margin; the right corner, untouched by the face, did not.
		expect(r.left!.n).toBeLessThan(r.right!.n);
		expect(r.right!.n).toBe(Math.ceil(Math.floor(width * ROOM_CORNER_SHARE) / 2) * Math.ceil(Math.floor(height * ROOM_CORNER_SHARE) / 2));
	});

	it("gives null when the corners are skin-coloured, or too small to average", () => {
		expect(roomFromFrame(frame(200, 100, () => [200, 150, 120]), null)).toBeNull();
		expect(roomFromFrame(frame(10, 10, () => [50, 50, 50]), null)).toBeNull();
	});
});

// A recording of a 70 bpm face, read once a second as RppgSession reads it. `room`: what each frame's room holds.
function record(room: (t: number, p: number) => Parameters<RecordingPulseCheck["push"]>[6]) {
	const rec = new RecordingPulseCheck();
	let s = 9, next = 1000;
	const noise = () => ((s = (s * 16807) % 2147483647) / 2147483647 - 0.5) * 0.2;
	for (let t = 0; t <= 40000; t += 1000 / 30) {
		const p = 0.01 * Math.sin((2 * Math.PI * 70 * t) / 60000);
		const reg = () => ({ r: 150 * (1 - 0.3 * p) + noise(), g: 120 * (1 - p) + noise(), b: 100 * (1 - 0.6 * p) + noise() });
		// head left out (undefined): no face mesh handed over, so headMotion is not judged (null would mean 'no head seen').
		rec.push(t, [reg(), reg(), reg()], undefined, undefined, undefined, undefined, room(t, p));
		if (t >= next) { const st = rec.getState(); rec.noteRead(st.verdict === "measured" ? st.bpm : null, null); next += 1000; }
	}
	return parsePulseCheckRecording(JSON.stringify(rec.getRecording()));
}

