import { FACE_GONE_RESET_MS } from "../demoRunner";
import { RppgSession, wantsChestMotion, wantsHrvTracking } from "../rppgSession";
import { HrvRegionBuffer, type HrvWindowResult } from "../hrvTracking";

// experimentalVitals: HRV and chest breathing handed over in their own box, labelled experimental.
// With the pulse check on, the session's own reads (getMetrics, the debug feed) never carry them.
const raw = { bpm: 97, confidence: 0.75, signal_quality: 0.3, hrv_rmssd: 180, respiration_rate: 12.3, respiration_confidence: 1 };
const debug = { totalSamplesReceived: 10, windowSampleCount: 5, windowDurationMs: 1000, lastSampleTimestampMs: 1, lastSampleAgeMs: 0, lastSample: null, issues: [] };

type Opts = {
	verdict?: string | null; // null: pulse check off
	shown?: number | null; // the rate the check shows (null: proven but no longer shown)
	vitals?: boolean;
	faceAbsentMs?: number;
	sinceRestart?: number | null;
	hrv?: number | null;
	chest?: { rate: number; share: number } | null;
	/** The tracking-band timer's latest window (experimentalHrv "tracking"); left out: the engine's HRV. */
	tracking?: Partial<HrvWindowResult> | null;
};
const make = ({ verdict = "measured", shown = 71.5, vitals = true, faceAbsentMs = 0, sinceRestart = null, hrv = raw.hrv_rmssd, chest = { rate: 14.5, share: 0.8 }, tracking }: Opts = {}) => {
	const metrics = { ...raw, hrv_rmssd: hrv };
	const engine = {
		reads: 0,
		getMetrics() {
			engine.reads += 1;
			return { ...metrics };
		},
		getDebugSnapshot: () => ({ ...debug, backendMetrics: { ...metrics } }),
		resetSignal: () => {},
	};
	const session = new RppgSession(
		{} as never,
		engine as never,
		{ faceAbsentMs: () => faceAbsentMs, msSinceAnalysisRestart: () => sinceRestart, fixes: undefined } as never,
		"wasm",
		"face_mesh",
		{
			pulseCheck: verdict == null ? null : ({ getState: () => ({ verdict, bpm: verdict === "measured" ? shown : null, snrDb: null, streak: 0 }) } as never),
			chestMotion: { rate: () => chest, getSamples: () => [] } as never,
			experimentalVitals: vitals,
			...(tracking !== undefined ? { hrvRegions: { read: () => tracking } as never } : {}),
		},
	);
	return { session, engine };
};
/** The box after one ordinary getMetrics() poll, as an app reads it. */
const vitalsAfterPoll = (o: Opts = {}) => {
	const { session } = make(o);
	session.getMetrics();
	return session.getExperimentalVitals();
};

describe("experimentalVitals off (the default)", () => {
	it("hands over nothing", () => {
		expect(vitalsAfterPoll({ vitals: false })).toBeNull();
	});
	it("keeps HRV and breathing out of the metrics and out of the debug feed while the pulse check is on", () => {
		const { session } = make({ vitals: false });
		const m = session.getMetrics();
		expect([m.hrv_rmssd, m.respiration_rate, m.respiration_confidence]).toEqual([null, null, null]);
		const b = session.getDebugSnapshot().backendMetrics;
		expect([b.hrv_rmssd, b.respiration_rate, b.respiration_confidence]).toEqual([null, null, null]);
	});
	it("leaves the rest of the debug feed as the engine reported it", () => {
		const d = make({ vitals: false }).session.getDebugSnapshot();
		expect(d.backendMetrics.bpm).toBe(97);
		expect(d.backendMetrics.signal_quality).toBe(0.3);
		expect(d.totalSamplesReceived).toBe(10);
		expect(d.issues).toEqual([]);
	});
	it("with the pulse check off, the debug feed is the published one, raw values included", () => {
		const b = make({ verdict: null, vitals: false }).session.getDebugSnapshot().backendMetrics;
		expect(b.hrv_rmssd).toBe(180);
		expect(b.respiration_rate).toBe(12.3);
	});
});

describe("experimentalVitals on", () => {
	it("hands over HRV while the session shows a proven rate, and breathing from chest motion", () => {
		expect(vitalsAfterPoll()).toEqual({ experimental: true, hrvRmssd: 180, breathing: { rate: 14.5, share: 0.8 } });
	});
	it("gives no HRV until the pulse check has proven a pulse: HRV of something that is not a pulse means nothing", () => {
		expect(vitalsAfterPoll({ verdict: "not-measured" })?.hrvRmssd).toBeNull();
	});
	it("gives no HRV once the check stops showing its rate (the newest seconds no longer carry the pulse)", () => {
		expect(vitalsAfterPoll({ verdict: "measured", shown: null })?.hrvRmssd).toBeNull();
	});
	it("gives no HRV once the face has been gone for a second, like every other number", () => {
		expect(vitalsAfterPoll({ faceAbsentMs: FACE_GONE_RESET_MS })?.hrvRmssd).toBeNull();
		expect(vitalsAfterPoll({ faceAbsentMs: FACE_GONE_RESET_MS - 1 })?.hrvRmssd).toBe(180);
	});
	it("needs no wait after the face returns: the engine's window starts afresh then", () => {
		expect(vitalsAfterPoll({ sinceRestart: 0 })?.hrvRmssd).toBe(180);
		expect(vitalsAfterPoll({ sinceRestart: null })?.hrvRmssd).toBe(180);
	});
	it("gives no HRV when the engine has none or a non-number", () => {
		expect(vitalsAfterPoll({ hrv: null })?.hrvRmssd).toBeNull();
		expect(vitalsAfterPoll({ hrv: Number.NaN })?.hrvRmssd).toBeNull();
	});
	it("with the pulse check off, hands over the engine's HRV as published", () => {
		expect(vitalsAfterPoll({ verdict: null })?.hrvRmssd).toBe(180);
	});
	it("gives no breathing while the chest window is not covered", () => {
		expect(vitalsAfterPoll({ chest: null })?.breathing).toBeNull();
	});
	it("does not read the engine itself: its HRV is the one behind the latest getMetrics(), none before", () => {
		const { session, engine } = make();
		expect(session.getExperimentalVitals()?.hrvRmssd).toBeNull();
		session.getMetrics();
		const reads = engine.reads;
		session.getExperimentalVitals();
		session.getExperimentalVitals();
		expect(engine.reads).toBe(reads);
		expect(session.getExperimentalVitals()?.hrvRmssd).toBe(180);
	});
	it("still keeps HRV and breathing out of the metrics and the debug feed", () => {
		const { session } = make();
		expect(session.getMetrics().hrv_rmssd).toBeNull();
		expect(session.getMetrics().respiration_rate).toBeNull();
		expect(session.getDebugSnapshot().backendMetrics.hrv_rmssd).toBeNull();
		expect(session.getDebugSnapshot().backendMetrics.respiration_rate).toBeNull();
	});
	it("says so in the session's switches", () => {
		const { session } = make();
		expect(session.getBuildSwitches().experimentalVitals).toBe(true);
		expect(make({ vitals: false }).session.getBuildSwitches().experimentalVitals).toBe(false);
	});
	// test.12 to test.14 had a second way to the same chest breathing (chestBreathing and
	// getChestBreathing). Two switches for one reading is one a tester can set wrong; this box is the one.
	it("is the only way to chest breathing: there is no separate chestBreathing switch or reader", () => {
		const { session } = make();
		expect("chestBreathing" in session.getBuildSwitches()).toBe(false);
		expect("getChestBreathing" in session).toBe(false);
	});
});

describe("which sessions read chest motion", () => {
	it("only with experimentalVitals on (its breathing comes from the chest)", () => {
		expect(wantsChestMotion({ experimentalVitals: true })).toBe(true);
		expect(wantsChestMotion({})).toBe(false);
		expect(wantsChestMotion({ experimentalVitals: false })).toBe(false);
		expect(wantsChestMotion({ chestBreathing: true } as never)).toBe(false);
	});
});

describe("experimentalHrv \"tracking\": the tracking-band beat timer (hrvTracking.ts) in place of the engine's HRV", () => {
	const win = { rmssdMs: 42.5, sdnnMs: 51.2, snrDb: 2.3, centreBpm: 66, intervals: 66, kept: 60, pairs: 55, gated: false, reason: null };
	it("hands over the timer's rMSSD, and its window in its own field", () => {
		const v = vitalsAfterPoll({ tracking: win });
		expect(v?.hrvRmssd).toBe(42.5);
		expect(v?.hrvTracking).toEqual({ rmssdMs: 42.5, sdnnMs: 51.2, snrDb: 2.3, centreBpm: 66, kept: 60, pairs: 55, gated: false, reason: null });
	});
	it("gives no HRV under the timer's SNR gate, never the engine's in its place", () => {
		const v = vitalsAfterPoll({ tracking: { ...win, rmssdMs: null, sdnnMs: null, gated: true, reason: "gated" } });
		expect(v?.hrvRmssd).toBeNull();
		expect(v?.hrvTracking?.gated).toBe(true);
	});
	it("gives no HRV before the timer has a window", () => {
		const v = vitalsAfterPoll({ tracking: null });
		expect(v?.hrvRmssd).toBeNull();
		expect(v?.hrvTracking).toBeNull();
	});
	it("keeps the session's conditions: no proven rate or no face, no HRV", () => {
		expect(vitalsAfterPoll({ tracking: win, verdict: "not-measured" })?.hrvRmssd).toBeNull();
		expect(vitalsAfterPoll({ tracking: win, faceAbsentMs: FACE_GONE_RESET_MS })?.hrvRmssd).toBeNull();
	});
	it("leaves the default box as it was (no hrvTracking field), so an A/B against the engine's HRV is one switch", () => {
		expect("hrvTracking" in (vitalsAfterPoll() ?? {})).toBe(false);
	});
	it("runs only with experimentalVitals on, the pulse check on (its three regions feed it), and asked for", () => {
		expect(wantsHrvTracking({ experimentalVitals: true, experimentalHrv: "tracking" })).toBe(true);
		expect(wantsHrvTracking({ experimentalVitals: true })).toBe(false);
		expect(wantsHrvTracking({ experimentalVitals: true, experimentalHrv: "engine" })).toBe(false);
		expect(wantsHrvTracking({ experimentalHrv: "tracking" })).toBe(false);
		expect(wantsHrvTracking({ experimentalVitals: true, experimentalHrv: "tracking", pulseCheck: false })).toBe(false);
	});
	it("says which HRV in the session's switches", () => {
		expect(make().session.getBuildSwitches().experimentalHrv).toBe("engine");
		expect(make({ tracking: win }).session.getBuildSwitches().experimentalHrv).toBe("tracking");
	});
});

describe("HrvRegionBuffer: the frames the timer reads", () => {
	const rgb = { r: 150, g: 110, b: 90 };
	it("keeps only the newest keepS seconds", () => {
		const b = new HrvRegionBuffer(10);
		for (let t = 0; t <= 30000; t += 33) b.push(t, [rgb, rgb, rgb]);
		expect(b.size).toBeLessThanOrEqual(Math.ceil(10000 / 33) + 1);
		expect(b.size).toBeGreaterThan(290);
	});
	it("needs three regions per frame, and reset() empties it", () => {
		const b = new HrvRegionBuffer();
		b.push(0, [rgb, rgb]);
		expect(b.size).toBe(0);
		b.push(0, [rgb, rgb, rgb]);
		expect(b.size).toBe(1);
		b.reset();
		expect(b.size).toBe(0);
		expect(b.read()).toBeNull();
	});
	it("reads at most once a second of frames: the same window object in between", () => {
		const b = new HrvRegionBuffer();
		for (let t = 0; t <= 70000; t += 33) b.push(t, [rgb, rgb, rgb]);
		const first = b.read();
		expect(first).not.toBeNull();
		b.push(70033, [rgb, rgb, rgb]);
		expect(b.read()).toBe(first);
		for (let t = 70066; t <= 71100; t += 33) b.push(t, [rgb, rgb, rgb]);
		expect(b.read()).not.toBe(first);
	});
});
