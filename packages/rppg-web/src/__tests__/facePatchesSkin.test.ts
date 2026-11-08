import { faceChroma, facePatchesFromFrame } from "../facePatches";

// A 200x200 face under a night light: skin read as orange (R 200, G 70, B 20, Cb about 77-25, out of the fixed box), with
// a darker band of hair at the top. The skin test, centred on the face's own colour, still finds the skin.
const W = 200, H = 200;
function frame(skin: [number, number, number]) {
	const data = new Uint8ClampedArray(W * H * 4);
	for (let y = 0; y < H; y++)
		for (let x = 0; x < W; x++) {
			const i = (y * W + x) * 4, hair = y < 30;
			data[i] = hair ? 20 : skin[0]; data[i + 1] = hair ? 15 : skin[1]; data[i + 2] = hair ? 10 : skin[2]; data[i + 3] = 255;
		}
	return { data, width: W, height: H, timestampMs: 0 } as never;
}
const mesh = Array.from({ length: 478 }, (_, i) => ({ x: 0.05 + 0.9 * (((i * 37) % 101) / 100), y: 0.03 + 0.94 * (((i * 61) % 103) / 102) }));
const skinShare = (f: never) => { const p = facePatchesFromFrame(f, mesh)!; let sk = 0, n = 0; for (let i = 0; i < p.values.length / 5; i++) { sk += p.values[i * 5 + 3]; n += p.values[i * 5 + 4]; } return sk / n; };

describe("face patches: skin judged against the face's own colour", () => {
	it("a night-lit face, outside the fixed Cb/Cr box, still counts as skin", () => {
		expect(skinShare(frame([200, 70, 20]))).toBeGreaterThan(0.7);
	});
	it("a face under white light counts as before", () => {
		expect(skinShare(frame([200, 150, 120]))).toBeGreaterThan(0.7);
	});
	it("the face's chroma is its centre's, not the hair's", () => {
		const f = frame([200, 150, 120]) as { data: Uint8ClampedArray };
		const [cb] = faceChroma(f.data, W, H, 0, 0, W, H);
		expect(Math.abs(cb - (128 - 0.168736 * 200 - 0.331264 * 150 + 0.5 * 120))).toBeLessThan(1);
	});
});
