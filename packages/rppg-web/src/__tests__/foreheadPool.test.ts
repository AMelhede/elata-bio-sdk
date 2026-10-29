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

import { OWN_PULSE_STRONG_STREAK } from "../pulseCheckCore";
import { POOL_BUILDING_STREAK, buildingRate, resolvePulseCheckRules, streakNeeded } from "../pulseCheck";
import { sessionPulseCheck } from "../rppgSession";

describe("rule foreheadPool: the building number needs one more window while the forehead is the pool", () => {
	const v = (streak: number) => ({ verdict: "not-measured", streak, streakBpm: 70, streakSnrDb: 0 });
	it("shows a streak of OWN_PULSE_STRONG_STREAK without the rule and needs POOL_BUILDING_STREAK with it", () => {
		expect(POOL_BUILDING_STREAK).toBe(OWN_PULSE_STRONG_STREAK + 1);
		expect(buildingRate(v(OWN_PULSE_STRONG_STREAK), false)).toBe(70);
		expect(buildingRate(v(OWN_PULSE_STRONG_STREAK), false, POOL_BUILDING_STREAK)).toBeNull();
		expect(buildingRate(v(POOL_BUILDING_STREAK), false, POOL_BUILDING_STREAK)).toBe(70);
	});
	it("tells an app's progress the same streak, and leaves re-lock as it was", () => {
		const on = resolvePulseCheckRules({ moreReadings: true, foreheadPool: true });
		const off = resolvePulseCheckRules({ moreReadings: true });
		expect(streakNeeded(on, false)).toBe(POOL_BUILDING_STREAK);
		expect(streakNeeded(off, false)).toBe(OWN_PULSE_STRONG_STREAK);
		expect(streakNeeded(on, true)).toBe(streakNeeded(off, true));
	});
	it("is set by the session's foreheadPool switch, so the check always knows what it is fed, and is off otherwise", () => {
		expect(sessionPulseCheck({ foreheadPool: true, pulseCheckRules: { moreReadings: true } })!.rules.foreheadPool).toBe(true);
		expect(sessionPulseCheck({ foreheadPool: true, pulseCheckRules: { moreReadings: true } })!.rules.moreReadings).toBe(true);
		expect(sessionPulseCheck({ pulseCheckRules: { moreReadings: true } })!.rules.foreheadPool).toBe(false);
		expect(sessionPulseCheck({ foreheadPool: true, pulseCheck: false })).toBeNull();
	});
});

import { RecordingPulseCheck, parsePulseCheckRecording, replayPulseCheck, serializePulseCheckRecording } from "../pulseCheckRecording";
import { shownPulseBpm } from "../pulseCheck";

describe("a recording with the pool keeps the forehead box it replaced, so the file replays both ways", () => {
	// A 72 bpm pulse in colour (green more than red and blue, as blood absorbs), each region with its own small noise.
	// noise 0.0005: proven at once by the strong-window path; 0.03: a weak pulse whose first number is the building one.
	function feed(check: RecordingPulseCheck, withBox: boolean, noise = 0.0005) {
		let seed = 11;
		const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5);
		const live: { t: number; bpm: number | null }[] = [];
		for (let i = 0; i < 30 * 40; i++) {
			const t = (i * 1000) / 30;
			const p = Math.sin((2 * Math.PI * 1.2 * t) / 1000);
			const region = () => ({ r: 0.6 * (1 + 0.002 * p + noise * rnd()), g: 0.4 * (1 + 0.006 * p + noise * rnd()), b: 0.3 * (1 + 0.003 * p + noise * rnd()) });
			const before = check.evaluations;
			check.push(t, [region(), region(), region()], undefined, undefined, undefined, undefined, withBox ? { foreheadBox: { r: 0.61, g: 0.41, b: 0.31 } } : undefined);
			if (check.evaluations !== before) live.push({ t, bpm: shownPulseBpm(check.getState()) });
		}
		return live;
	}
	it("writes the box as the frame's last field with the pool and leaves the event as it was without", () => {
		const a = new RecordingPulseCheck({ rules: { moreReadings: true, foreheadPool: true } });
		feed(a, true);
		const fa = a.getRecording().events.find((e) => e[0] === "f")!;
		expect(fa.length).toBe(10);
		expect(fa[9]).toEqual([0.61, 0.41, 0.31]);
		const b = new RecordingPulseCheck({ rules: { moreReadings: true } });
		feed(b, false);
		expect(b.getRecording().events.find((e) => e[0] === "f")!.length).toBe(9);
	});
	it("the check itself shows its first building number one window later under the rule", () => {
		const first = (rules: object) => feed(new RecordingPulseCheck({ rules }), false, 0.03).findIndex((e) => e.bpm != null);
		const plain = first({ moreReadings: true });
		expect(plain).toBeGreaterThan(0);
		expect(first({ moreReadings: true, foreheadPool: true })).toBe(plain + 1);
	});
	it("replays with its own rules, through a file, to every number the live check showed (the box is recorded only)", () => {
		const check = new RecordingPulseCheck({ rules: { moreReadings: true, foreheadPool: true } });
		const live = feed(check, true);
		expect(live.filter((e) => e.bpm != null).length).toBeGreaterThan(10);
		const rec = parsePulseCheckRecording(serializePulseCheckRecording(check.getRecording()));
		expect(rec.rules.foreheadPool).toBe(true);
		expect(replayPulseCheck(rec).evaluations.map((e) => ({ t: e.t, bpm: e.bpm }))).toEqual(live);
	});
});

import { BUILDING_MIN_SNR_DB } from "../pulseCheck";
import { OWN_PULSE_MIN_SNR_DB } from "../pulseCheckCore";

describe("the building number's bar sits two dB under the proof's", () => {
	const v = (snr: number) => ({ verdict: "not-measured", streak: 4, streakBpm: 70, streakSnrDb: snr });
	it("shows a streak at -4.5 dB and not one at -5.5", () => {
		expect(BUILDING_MIN_SNR_DB).toBe(OWN_PULSE_MIN_SNR_DB - 2);
		expect(buildingRate(v(-4.5), false)).toBe(70);
		expect(buildingRate(v(BUILDING_MIN_SNR_DB), false)).toBe(70);
		expect(buildingRate(v(-5.5), false)).toBeNull();
	});
});
