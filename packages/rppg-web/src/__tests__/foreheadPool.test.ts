import { FACE_PATCH_FIELDS, FACE_PATCH_LANDMARKS, FOREHEAD_POOL_GRID, FOREHEAD_POOL_SIZE, facePatchesFromFrame, foreheadPoolFromFrame } from "../facePatches";
import type { Frame } from "../frameSource";
import { ForeheadPool } from "../foreheadPool";

// The forehead pool (switch foreheadPool): the forehead read from 49 small patches weighted toward the cleanest.

function frame(W = 320, H = 240): { frame: Frame; landmarks: { x: number; y: number }[] } {
	const data = new Uint8ClampedArray(W * H * 4);
	for (let y = 0; y < H; y++)
		for (let x = 0; x < W; x++) {
			const i = (y * W + x) * 4;
			// A skin-like colour that varies over the frame, so every patch has its own mean.
			data[i] = 180 + ((x * 7 + y * 3) % 40);
			data[i + 1] = 120 + ((x * 5 + y * 11) % 30);
			data[i + 2] = 100 + ((x * 13 + y) % 20);
			data[i + 3] = 255;
		}
	const landmarks = Array.from({ length: 478 }, (_, k) => ({ x: 0.3 + 0.4 * ((k * 37) % 100) / 100, y: 0.25 + 0.5 * ((k * 53) % 100) / 100 }));
	return { frame: { data, width: W, height: H, timestampMs: 0 } as unknown as Frame, landmarks };
}

describe("foreheadPoolFromFrame", () => {
	it("reads exactly the pool's patches of the full layout: grid cells 0 to 31, then the first 17 landmark squares", () => {
		const { frame: f, landmarks } = frame();
		const all = facePatchesFromFrame(f, landmarks)!;
		const pool = foreheadPoolFromFrame(f, landmarks)!;
		const PF = FACE_PATCH_FIELDS.length;
		const idx = [...Array.from({ length: FOREHEAD_POOL_GRID }, (_, k) => k), ...Array.from({ length: FOREHEAD_POOL_SIZE - FOREHEAD_POOL_GRID }, (_, j) => 64 + j)];
		expect(idx.length).toBe(FOREHEAD_POOL_SIZE);
		expect(FACE_PATCH_LANDMARKS.slice(0, 3)).toEqual([10, 151, 9]);
		idx.forEach((src, k) => {
			const o = src * PF;
			const [sR, sG, sB, sk, n] = Array.from(all.values.slice(o, o + PF));
			expect(pool.skin[k]).toBe(sk);
			expect(pool.n[k]).toBe(n);
			if (sk) expect([pool.mean[3 * k], pool.mean[3 * k + 1], pool.mean[3 * k + 2]]).toEqual([sR / sk, sG / sk, sB / sk]);
		});
	});
});

describe("ForeheadPool", () => {
	// 12 patches carry the same 1.2 Hz pulse; 4 of them also carry strong per-channel noise. After the first
	// 16 s window the pool weights the noisy ones down, so its output carries far less high-band noise than an equal mean.
	function run(pool: ForeheadPool) {
		const P = 12, fps = 30;
		let seed = 7;
		const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5);
		const out: number[] = [], eq: number[] = [];
		for (let i = 0; i < fps * 40; i++) {
			const t = (i * 1000) / fps;
			const mean = new Float64Array(P * 3), skin = new Float64Array(P).fill(900), n = new Float64Array(P).fill(1000);
			let eqG = 0;
			for (let p = 0; p < P; p++) {
				const pulse = 0.01 * Math.sin((2 * Math.PI * 1.2 * t) / 1000);
				// Sensor noise differs per colour channel (the pool judges noise in the colour-difference signals, where a
				// shared brightness change cancels).
				const amp = p < 4 ? 0.05 : 0.001;
				const g = 120 * (1 + pulse + amp * rnd());
				mean[3 * p] = 170 * (1 + 0.3 * pulse + amp * rnd()); mean[3 * p + 1] = g; mean[3 * p + 2] = 110 * (1 + 0.6 * pulse + amp * rnd());
				eqG += g / P;
			}
			const v = pool.push({ t, mean, skin, n });
			if (t > 20000) { out.push(v!.g * 255); eq.push(eqG); }
		}
		const hf = (x: number[]) => { let s = 0; for (let i = 2; i < x.length; i++) { const d = x[i] - 2 * x[i - 1] + x[i - 2]; s += d * d; } return s / x.length; };
		return { pool: hf(out), equal: hf(eq) };
	}
	it("weights noisy patches down after the first window", () => {
		const r = run(new ForeheadPool(12, 30));
		expect(r.pool).toBeLessThan(r.equal / 4);
	});
	it("gives no value before any patch counts, then the region's level", () => {
		const pool = new ForeheadPool(2, 30);
		expect(pool.push({ t: 0, mean: new Float64Array(6).fill(NaN), skin: new Float64Array(2), n: new Float64Array(2).fill(100) })).toBeNull();
		const v = pool.push({ t: 33, mean: Float64Array.from([200, 100, 50, 200, 100, 50]), skin: new Float64Array(2).fill(90), n: new Float64Array(2).fill(100) })!;
		expect(v.g).toBeCloseTo(100 / 255, 12);
	});
});
