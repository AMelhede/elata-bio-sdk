import { eyeBlink } from "../pulseCheck";

// The blink score is recorded only (HeadPosition.blink), so a liveness test can be built offline: a photo does not blink.

describe("eyeBlink", () => {
	it("is the mean of eyeBlinkLeft and eyeBlinkRight, null when either is missing", () => {
		expect(eyeBlink([{ categoryName: "eyeBlinkLeft", score: 0.2 }, { categoryName: "jawOpen", score: 0.9 }, { categoryName: "eyeBlinkRight", score: 0.6 }])).toBeCloseTo(0.4, 12);
		expect(eyeBlink([{ categoryName: "eyeBlinkLeft", score: 0.2 }])).toBeNull();
		expect(eyeBlink(undefined)).toBeNull();
	});
});

describe("the recording keeps the blink score", () => {
	it("writes it eighth, absent head fields null before it, and replays the same as without it", async () => {
		const { RecordingPulseCheck, replayPulseCheck, parsePulseCheckRecording, serializePulseCheckRecording } = await import("../pulseCheckRecording");
		const rec = new RecordingPulseCheck();
		const plain = new RecordingPulseCheck();
		for (let i = 0; i < 300; i++) {
			const t = i * 33.3;
			const v = 100 + Math.sin((2 * Math.PI * t) / 860);
			const regions = [{ r: v, g: v, b: v }, { r: v, g: v, b: v }, { r: v, g: v, b: v }];
			rec.push(t, regions, undefined, undefined, { x: 320, y: 240, faceWidth: 140, mouthOpen: 0.05, blink: 0.75 });
			plain.push(t, regions, undefined, undefined, { x: 320, y: 240, faceWidth: 140, mouthOpen: 0.05 });
		}
		const f = rec.getRecording().events.find((e) => e[0] === "f")!;
		expect(f[6]).toEqual([320, 240, 140, 0.05, null, null, null, 0.75]);
		const back = parsePulseCheckRecording(serializePulseCheckRecording(rec.getRecording()));
		expect(replayPulseCheck(back).evaluations.map((e) => e.state)).toEqual(replayPulseCheck(plain.getRecording()).evaluations.map((e) => e.state));
	});
});
