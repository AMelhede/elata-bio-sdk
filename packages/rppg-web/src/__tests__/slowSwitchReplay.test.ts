import { RecordingPulseCheck, parsePulseCheckRecording, replayPulseCheck, serializePulseCheckRecording } from "../pulseCheckRecording";

// The slow-device switch turns the check's tracker on mid-session (PulseCheck.switchToTracker). A recording keeps it as
// an "s" event between the two frames it fell between, so a replay with the recording's own rules gives back every
// state of the live check, as for any other recording (the recording's exactness promise).

function pulseFrames(seconds: number, fps: number): { t: number; rgb: { r: number; g: number; b: number } }[] {
	const out = [];
	let seed = 7;
	const noise = () => {
		seed = (seed * 16807) % 2147483647;
		return seed / 2147483647 - 0.5;
	};
	for (let i = 0; i < seconds * fps; i++) {
		const t = 1000 + (i * 1000) / fps;
		const p = Math.sin((2 * Math.PI * 72 * t) / 60_000);
		out.push({ t, rgb: { r: 140 + 0.3 * p + 0.2 * noise(), g: 100 + 0.8 * p + 0.2 * noise(), b: 80 + 0.2 * p + 0.2 * noise() } });
	}
	return out;
}

describe("a recording of a switched check replays exactly", () => {
	const frames = pulseFrames(60, 15);
	const head = { x: 320, y: 240, faceWidth: 200 };

	function live() {
		const check = new RecordingPulseCheck();
		const states: string[] = [];
		frames.forEach(({ t, rgb }, i) => {
			const before = check.evaluations;
			check.push(t, [rgb, rgb, rgb], undefined, undefined, head);
			if (check.evaluations !== before) states.push(JSON.stringify(check.getState()));
			if (i === 30 * 15) check.switchToTracker();
		});
		return { check, states };
	}

	test("the rules it started with, the s event after the frame it followed, and every live state back", () => {
		const { check, states } = live();
		expect(check.rules.tracker).toBe(true);
		const rec = parsePulseCheckRecording(serializePulseCheckRecording(check.getRecording()));
		expect(rec.rules.tracker).toBe(false);
		const at = rec.events.findIndex((e) => e[0] === "s");
		expect(rec.events[at - 1][1]).toBe(frames[30 * 15].t);
		const replayed = replayPulseCheck(rec).evaluations.map((e) => JSON.stringify(e.state));
		expect(replayed).toEqual(states);
	});

	test("the switch changes what the check does, so a replay that dropped it would not match", () => {
		const { check, states } = live();
		const rec = check.getRecording();
		const without = { ...rec, events: rec.events.filter((e) => e[0] !== "s") };
		const replayed = replayPulseCheck(without).evaluations.map((e) => JSON.stringify(e.state));
		expect(replayed).not.toEqual(states);
	});

	test("slowSwitch 'ignore' replays as if the switch never fired; the default is 'recorded'", () => {
		const { check, states } = live();
		const rec = check.getRecording();
		const without = { ...rec, events: rec.events.filter((e) => e[0] !== "s") };
		const st = (r: ReturnType<typeof replayPulseCheck>) => r.evaluations.map((e) => JSON.stringify(e.state));
		const ignored = st(replayPulseCheck(rec, { slowSwitch: "ignore" }));
		expect(ignored).toEqual(st(replayPulseCheck(without)));
		const recorded = st(replayPulseCheck(rec, { slowSwitch: "recorded" }));
		expect(recorded).toEqual(states);
		expect(st(replayPulseCheck(rec))).toEqual(recorded);
		// Identical up to the switch frame, different after it.
		const switchT = frames[30 * 15].t;
		const evs = replayPulseCheck(rec).evaluations;
		const before = evs.filter((e) => e.t <= switchT).length;
		expect(ignored.slice(0, before)).toEqual(recorded.slice(0, before));
		expect(ignored.slice(before)).not.toEqual(recorded.slice(before));
	});
});
