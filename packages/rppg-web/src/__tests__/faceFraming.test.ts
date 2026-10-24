import {
	DEFAULT_FRAMING_THRESHOLDS,
	PUBLISHED_FRAMING_THRESHOLDS,
	faceBoxFromLandmarks,
	faceFramingFromBox,
	padFaceBoxToHead,
	type FaceBox,
} from "../faceFraming";

const centered: FaceBox = { x: 0.3, y: 0.3, width: 0.4, height: 0.4 };

describe("faceFramingFromBox", () => {
	test("well-framed face is ok", () => {
		expect(faceFramingFromBox(centered).code).toBe("ok");
	});

	test("null box reads as no_face", () => {
		expect(faceFramingFromBox(null).code).toBe("no_face");
	});

	test("small face → move_closer", () => {
		expect(faceFramingFromBox({ ...centered, width: 0.06 }).code).toBe(
			"move_closer",
		);
	});

	test("large face → move_back", () => {
		expect(
			faceFramingFromBox({ x: 0.05, y: 0.05, width: 0.85, height: 0.85 }).code,
		).toBe("move_back");
	});

	test("distance is corrected before centering", () => {
		// Far off-center but also too small: distance wins.
		expect(
			faceFramingFromBox({ x: 0.0, y: 0.3, width: 0.06, height: 0.06 }).code,
		).toBe("move_closer");
	});

	test("off-center face → center_face", () => {
		expect(faceFramingFromBox({ ...centered, x: 0.0 }).code).toBe("center_face");
	});

	test("vertical position hints", () => {
		expect(
			faceFramingFromBox({ x: 0.3, y: 0.05, width: 0.4, height: 0.4 }).code,
		).toBe("face_too_high");
		expect(
			faceFramingFromBox({ x: 0.3, y: 0.55, width: 0.4, height: 0.4 }).code,
		).toBe("face_too_low");
	});

	test("non-ok codes carry a user-facing message", () => {
		const g = faceFramingFromBox({ ...centered, width: 0.06 });
		expect(g.message.length).toBeGreaterThan(0);
	});
});

describe("move closer only for a face too small to find (measured, not assumed)", () => {
	// Real webcam recordings of people at rest had padded head boxes of 0.136 to 0.263 of the frame width and read
	// right against a reference pulse; under the published 0.34 every one of them was told "move closer" and, through
	// the app adapter, shown no heart rate.
	test("the smallest real face that read right (0.136) is ok", () => {
		expect(faceFramingFromBox({ x: 0.43, y: 0.35, width: 0.136, height: 0.2 }).code).toBe("ok");
	});

	test("a typical laptop face (0.17 to 0.26) is ok", () => {
		for (const width of [0.17, 0.2, 0.26])
			expect(faceFramingFromBox({ x: 0.5 - width / 2, y: 0.3, width, height: width * 1.3 }).code).toBe("ok");
	});

	test("below the face finder's floor it still says move closer", () => {
		expect(faceFramingFromBox({ ...centered, width: 0.06 }).code).toBe("move_closer");
		expect(DEFAULT_FRAMING_THRESHOLDS.minWidth).toBeGreaterThan(0.06);
	});

	test("PUBLISHED_FRAMING_THRESHOLDS gives back 0.14.0's rule (the off switch)", () => {
		expect(PUBLISHED_FRAMING_THRESHOLDS).toEqual({ minWidth: 0.34, maxWidth: 0.78, centerTol: 0.18 });
		expect(faceFramingFromBox({ x: 0.37, y: 0.3, width: 0.26, height: 0.34 }, PUBLISHED_FRAMING_THRESHOLDS).code).toBe("move_closer");
	});
});

describe("move back when the head no longer fits top to bottom (measured, advice only)", () => {
	// Real webcam recordings zoomed in (lane/facesize run7): readings held while the padded head box was up to about
	// 0.63 of the frame height and faded from about 0.8 (13 then 5 shown seconds of 73 at 0.80 and 0.89), at widths of
	// only 0.34 to 0.48, far under maxWidth 0.78. No size gave a wrong reading, so this hint never withholds.
	test("a head box taller than maxHeight says move back, marked as advice", () => {
		const g = faceFramingFromBox({ x: 0.3, y: 0.05, width: 0.42, height: 0.85 });
		expect(g.code).toBe("move_back");
		expect(g.advisory).toBe(true);
		expect(DEFAULT_FRAMING_THRESHOLDS.maxHeight).toBe(0.8);
	});

	test("a head that fits (0.63 tall, read like full size) is ok", () => {
		expect(faceFramingFromBox({ x: 0.3, y: 0.18, width: 0.38, height: 0.63 }).code).toBe("ok");
	});

	test("too wide stays a blocking move back", () => {
		const g = faceFramingFromBox({ x: 0.05, y: 0.1, width: 0.85, height: 0.7 });
		expect(g.code).toBe("move_back");
		expect(g.advisory).toBeUndefined();
	});

	test("PUBLISHED_FRAMING_THRESHOLDS has no height limit (the off switch)", () => {
		expect(faceFramingFromBox({ x: 0.3, y: 0.05, width: 0.42, height: 0.85 }, PUBLISHED_FRAMING_THRESHOLDS).code).toBe("ok");
	});
});

describe("move closer is judged against the frame's longer side (portrait frames, measured)", () => {
	// The face finder reads the whole frame scaled into a small square, so the face it can find is a fixed size against
	// the frame's longer side, not its width. Landscape 640x360 lost faces at a box of 0.087 to 0.10 of the width (56 to
	// 64 px); a portrait 360x640 frame (a phone held upright) found one at 0.195 of its width and lost it at about 0.16
	// (59 px) (lane/portrait run13). Judged by width alone, a portrait face is lost before "move closer" ever shows.
	test("a portrait face under the floor says move closer although its width share is above minWidth", () => {
		const g = faceFramingFromBox({ x: 0.41, y: 0.4, width: 0.17, height: 0.15, frameAspect: 360 / 640 });
		expect(g.code).toBe("move_closer");
	});

	test("a portrait face well above the floor is ok", () => {
		expect(faceFramingFromBox({ x: 0.33, y: 0.35, width: 0.34, height: 0.25, frameAspect: 360 / 640 }).code).toBe("ok");
	});

	test("landscape frames are judged as before", () => {
		expect(faceFramingFromBox({ x: 0.43, y: 0.35, width: 0.136, height: 0.2, frameAspect: 640 / 360 }).code).toBe("ok");
		expect(faceFramingFromBox({ x: 0.45, y: 0.35, width: 0.1, height: 0.15, frameAspect: 640 / 360 }).code).toBe("move_closer");
	});

	test("PUBLISHED_FRAMING_THRESHOLDS judges width alone (the off switch)", () => {
		expect(faceFramingFromBox({ x: 0.3, y: 0.3, width: 0.36, height: 0.25, frameAspect: 360 / 640 }, PUBLISHED_FRAMING_THRESHOLDS).code).toBe("ok");
	});

	test("padFaceBoxToHead keeps the frame's aspect", () => {
		expect(padFaceBoxToHead({ x: 0.4, y: 0.4, width: 0.2, height: 0.2, frameAspect: 0.5625 }).frameAspect).toBe(0.5625);
	});
});

describe("faceBoxFromLandmarks", () => {
	test("empty set is null", () => {
		expect(faceBoxFromLandmarks([])).toBeNull();
	});

	test("computes the bounding box", () => {
		const box = faceBoxFromLandmarks([
			{ x: 0.2, y: 0.3 },
			{ x: 0.6, y: 0.7 },
			{ x: 0.4, y: 0.5 },
		]);
		expect(box!.x).toBeCloseTo(0.2);
		expect(box!.y).toBeCloseTo(0.3);
		expect(box!.width).toBeCloseTo(0.4);
		expect(box!.height).toBeCloseTo(0.4);
	});
});

describe("padFaceBoxToHead", () => {
	test("grows the box outward (most above for the skull)", () => {
		const mesh: FaceBox = { x: 0.3, y: 0.3, width: 0.4, height: 0.4 };
		const head = padFaceBoxToHead(mesh);
		expect(head.y).toBeLessThan(mesh.y);
		expect(head.width).toBeGreaterThan(mesh.width);
		expect(head.height).toBeGreaterThan(mesh.height);
		// Top pad dominates the bottom pad.
		expect(mesh.y - head.y).toBeGreaterThan(head.y + head.height - (mesh.y + mesh.height));
	});
});
