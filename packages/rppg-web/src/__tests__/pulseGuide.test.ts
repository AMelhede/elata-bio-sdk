// Run: node --experimental-strip-types --test tests/coach.test.ts
import { adviceFor, meter, isBlocking, needsYou, shownAfter, ADVICE_HOLD_MS, movementOf, MOVE_MAX, MOVE_WINDOW_MS, STALL_MS, WARM_MAX, warmthOf, blueWarmthOf, ADVICE_TEXT as ADVICE } from '../pulseGuide';
// Ported from the test page's coach tests (2026-10-31): the instruction state machine now lives in the library.
const assert = {
	equal: (a: unknown, b: unknown, _m?: string) => expect(a).toBe(b),
	notEqual: (a: unknown, b: unknown, _m?: string) => expect(a).not.toBe(b),
	ok: (x: unknown, _m?: string) => expect(x).toBeTruthy(),
	deepEqual: (a: unknown, b: unknown, _m?: string) => expect(a).toEqual(b),
};


const lit = { face: 0.45, centre: 0.45, room: 0.45 };

test('advice follows the order a person fixes things in', () => {
  assert.equal(adviceFor({ light: null, faceFound: false, lampOn: false, hasNumber: false }), 'no_camera');
  assert.equal(adviceFor({ light: lit, faceFound: false, lampOn: false, hasNumber: false }), 'no_face');
  assert.equal(adviceFor({ light: lit, faceFound: true, lampOn: false, hasNumber: false }), 'still');
  assert.equal(adviceFor({ light: lit, faceFound: true, lampOn: false, hasNumber: true }), 'still');
});

test('a dark face behind a bright room is backlit, the 2026-09-13 silhouette (face 0.25, room 0.3836 + gap)', () => {
  assert.equal(adviceFor({ light: { face: 0.25, centre: 0.25, room: 0.5 }, faceFound: false, lampOn: false, hasNumber: false }), 'backlit');
  // A dark room is not backlit: there is no light to turn toward.
  assert.equal(adviceFor({ light: { face: 0.1, centre: 0.1, room: 0.12 }, faceFound: false, lampOn: false, hasNumber: false }), 'no_face');
  // A found face is never called backlit.
  assert.equal(adviceFor({ light: { face: 0.3, centre: 0.3, room: 0.5 }, faceFound: true, lampOn: false, hasNumber: false }), 'still');
});

test('too dark asks for the screen first, then for a real light once the lamp is already on', () => {
  const dark = { face: 0.15, centre: 0.15, room: 0.15 };
  assert.equal(adviceFor({ light: dark, faceFound: true, lampOn: false, hasNumber: false }), 'brighter_screen');
  assert.equal(adviceFor({ light: dark, faceFound: true, lampOn: true, hasNumber: false }), 'more_light');
  // Light advice never blocks: the ring keeps showing the check's progress while the person adds light.
  assert.ok(!isBlocking('more_light'));
  assert.ok(!isBlocking('brighter_screen'));
});

test('meter weights the centre: a dark centre in a bright frame reads as a dark face', () => {
  const size = 16;
  const data: number[] = [];
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const centre = Math.abs(x - 7.5) < 4 && Math.abs(y - 7.5) < 4;
      const v = centre ? 40 : 230;
      data.push(v, v, v, 255);
    }
  const m = meter(data, size)!;
  assert.ok(m.face < m.room - 0.2, `face ${m.face} room ${m.room}`);
});

test('a lit face on a dark wall reads lit (the face box, not the whole frame)', () => {
  const size = 16;
  const data: number[] = [];
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const face = Math.abs(x - 7.5) < 4 && Math.abs(y - 7.5) < 5;
      const v = face ? 150 : 40; // the synthetic face video: face 150, wall 40
      data.push(v, v, v, 255);
    }
  const m = meter(data, size)!;
  assert.ok(m.face >= 0.38, `face ${m.face}`);
});

test('an instruction changes only after the new one has held ADVICE_HOLD_MS; a number on screen shows "hold still" at once', () => {
  let s = { advice: 'still' as const, pending: null, since: 0 } as ReturnType<typeof shownAfter>;
  s = shownAfter(s, 'more_light', 1000, false);
  assert.equal(s.advice, 'still');
  s = shownAfter(s, 'brighter_screen', 2000, false); // flip: the clock restarts
  s = shownAfter(s, 'brighter_screen', 2000 + ADVICE_HOLD_MS - 1, false);
  assert.equal(s.advice, 'still');
  s = shownAfter(s, 'brighter_screen', 2000 + ADVICE_HOLD_MS, false);
  assert.equal(s.advice, 'brighter_screen');
  // With no number on screen, "hold still" waits like any other change (it used to cut in at once, so the instruction
  // swapped every few seconds: 13.6 raw changes a minute on the owner's mother's run, 2026-10-31).
  assert.equal(shownAfter(s, 'still', 99999, false).advice, 'brighter_screen');
  // A number on screen: "hold still" at once, whatever was pending.
  assert.equal(shownAfter(s, 'more_light', 99999, true).advice, 'still');
});

test('after 30 s with a face and no number, good light becomes a nudge', () => {
  assert.equal(STALL_MS, 30_000);
  assert.equal(adviceFor({ light: lit, faceFound: true, lampOn: false, hasNumber: false, searchingMs: 29_999 }), 'still');
  assert.equal(adviceFor({ light: lit, faceFound: true, lampOn: false, hasNumber: false, searchingMs: 30_000 }), 'stalled');
});

// ---- "Hold still": the 2026-10-20 Mac tester. Readings came when he was still (97% of seconds in his best run) and
// stopped when he moved; the page waited 42 s and then gave a generic hint. ----
const rows = (n: number, f: (i: number) => { x: number; y: number; w: number }) =>
  Array.from({ length: n }, (_, i) => ({ t_ms: i * 33, ...f(i) }));

test('movement is the head drift over the last 8 s in face widths; a still head reads near 0', () => {
  const still = rows(300, () => ({ x: 300, y: 240, w: 240 }));
  assert.ok(movementOf(still, 300 * 33)! < 0.001);
  // Leaning in and out: face width swinging +-17% (the tester's first run).
  const leaning = rows(300, (i) => ({ x: 300, y: 240, w: 240 * (1 + 0.17 * Math.sin(i / 30)) }));
  assert.ok(movementOf(leaning, 300 * 33)! > MOVE_MAX);
  // Too few frames to judge (under 2 s): no verdict, so no hint.
  assert.equal(movementOf(rows(40, () => ({ x: 300, y: 240, w: 240 })), 40 * 33), null);
  // Only the last MOVE_WINDOW_MS count: an old lean followed by 8 s of stillness is still.
  const settled = [...rows(300, (i) => ({ x: 300 + 60 * Math.sin(i / 10), y: 240, w: 240 })), ...rows(300, () => ({ x: 300, y: 240, w: 240 })).map((r) => ({ ...r, t_ms: r.t_ms + 300 * 33 }))];
  assert.ok(movementOf(settled, 600 * 33)! < 0.001);
  assert.equal(MOVE_WINDOW_MS, 8000);
});

test('with the screen lamp on and the face well lit, the page never asks for a brighter screen', () => {
  // Owner laptop run 2026-10-27 (page 59626d1d3e85): a 3 s dip to 0.35 latched the lamp, then the face read 0.53 to
  // 0.60 for 31 s while the page said "Turn screen brightness all the way up".
  const lit = { face: 0.56, centre: 0.56, room: 0.28 };
  assert.equal(adviceFor({ light: lit, faceFound: true, lampOn: true, hasNumber: false }), 'still');
  assert.equal(adviceFor({ light: lit, faceFound: true, lampOn: true, hasNumber: false, searchingMs: STALL_MS }), 'stalled');
  // Lit by the lamp but still under the target: more screen light is still the right ask.
  assert.equal(adviceFor({ light: { face: 0.3, centre: 0.3, room: 0.2 }, faceFound: true, lampOn: true, hasNumber: false }), 'brighter_screen');
});

test('a warm screen filter (night light, f.lux) is named before darkness or movement', () => {
  const lit = { face: 0.3, centre: 0.3, room: 0.2 };
  // The owner's f.lux run read green over red 0.28 on the face; real faces in white light read 0.39 to 0.82.
  assert.equal(adviceFor({ light: lit, faceFound: true, lampOn: true, hasNumber: false, warmth: 0.28, movement: 0.5 }), 'night_light');
  // Under the light floor, light first: the colour of a near-black picture cannot be judged, and light fixes it either way.
  assert.equal(adviceFor({ light: { face: 0.1, centre: 0.1, room: 0.1 }, faceFound: true, lampOn: false, hasNumber: false, warmth: 0.28 }), 'brighter_screen');
  // A warm filter cuts blue more than green (the owner's night-light runs: blue over red 0.06 to 0.08, green 0.07 to
  // 0.25). A dark camera picture with more blue than green is not a filter: light is the fix (his girlfriend's dark run,
  // 2026-10-31: green 0.28, blue 0.34, face 0.12).
  assert.equal(adviceFor({ light: { face: 0.1, centre: 0.1, room: 0.1 }, faceFound: true, lampOn: false, hasNumber: false, warmth: 0.28, blueWarmth: 0.34 }), 'brighter_screen');
  assert.equal(adviceFor({ light: { face: 0.1, centre: 0.1, room: 0.1 }, faceFound: true, lampOn: false, hasNumber: false, warmth: 0.28, blueWarmth: 0.08 }), 'brighter_screen');
  assert.equal(adviceFor({ light: { face: 0.3, centre: 0.3, room: 0.3 }, faceFound: true, lampOn: false, hasNumber: false, warmth: 0.25, blueWarmth: 0.06 }), 'night_light');
  assert.equal(adviceFor({ light: lit, faceFound: true, lampOn: true, hasNumber: false, warmth: 0.10, blueWarmth: 0.08 }), 'night_light');
  assert.equal(adviceFor({ light: lit, faceFound: true, lampOn: true, hasNumber: false, warmth: 0.39 }), 'brighter_screen');
  assert.equal(adviceFor({ light: lit, faceFound: true, lampOn: false, hasNumber: false, warmth: null }), 'still');
  // A number showing, or no face, wins as before.
  assert.equal(adviceFor({ light: lit, faceFound: true, lampOn: true, hasNumber: true, warmth: 0.28 }), 'still');
  assert.equal(adviceFor({ light: lit, faceFound: false, lampOn: true, hasNumber: false, warmth: 0.28 }), 'no_face');
  assert.ok(isBlocking('night_light'));
  assert.ok(WARM_MAX > 0.28 && WARM_MAX < 0.385);
});

test('blue over red of the face regions, for telling a warm filter from a dark picture', () => {
  const f = (t: number, b: number) => ['f', t, [[1, 0.5, b], [1, 0.5, b], [1, 0.5, b]]];
  assert.equal(blueWarmthOf([f(0, 0.3), f(1000, 0.3)]), 0.3);
  assert.equal(blueWarmthOf([['r', null]]), null);
});

test("warmth is green over red of the check's own face regions over the last 2 s, and null without frames", () => {
  const f = (t: number, g: number) => ['f', t, [[0.9, g, 0.1], [0.9, g, 0.1], [0.9, g, 0.1]]];
  assert.equal(warmthOf([['r', null], f(0, 0.27), f(1000, 0.27), f(1500, 0.27)]), 0.3);
  assert.equal(warmthOf([['r', null]]), null);
  // Only the last 2 s count: an old white frame does not dilute a fresh warm one.
  const v = warmthOf([f(0, 0.9), f(5000, 0.27), f(6000, 0.27)]);
  assert.ok(v != null && Math.abs(v - 0.3) < 1e-9);
});

test('a moving head gets "hold still" at once, not the 42 s stall; light and face problems come first; a number wins', () => {
  const lit = { face: 0.45, centre: 0.45, room: 0.45 };
  assert.equal(adviceFor({ light: lit, faceFound: true, lampOn: false, hasNumber: false, movement: MOVE_MAX + 0.01 }), 'moving');
  assert.equal(adviceFor({ light: lit, faceFound: true, lampOn: false, hasNumber: false, movement: MOVE_MAX - 0.01 }), 'still');
  assert.equal(adviceFor({ light: lit, faceFound: true, lampOn: false, hasNumber: false, movement: null }), 'still');
  assert.equal(adviceFor({ light: lit, faceFound: true, lampOn: false, hasNumber: true, movement: 0.5 }), 'still');
  assert.equal(adviceFor({ light: lit, faceFound: false, lampOn: false, hasNumber: false, movement: 0.5 }), 'no_face');
  assert.equal(adviceFor({ light: { face: 0.1, centre: 0.1, room: 0.1 }, faceFound: true, lampOn: false, hasNumber: false, movement: 0.5 }), 'brighter_screen');
  // With the screen lamp latched on in a dark room, movement still gets its own advice.
  assert.equal(adviceFor({ light: { face: 0.3, centre: 0.3, room: 0.3 }, faceFound: true, lampOn: true, hasNumber: false, movement: 0.5 }), 'moving');
  assert.equal(isBlocking('still'), false);
});

test("with the check's own cause, the instruction names its fix and never says nothing is wrong over a weak signal (SPEC-reading-state.md section 4)", () => {
  const lit = { face: 0.5, centre: 0.5, room: 0.4 }, dim = { face: 0.3, centre: 0.3, room: 0.3 }, dark = { face: 0.1, centre: 0.1, room: 0.1 };
  const base = { faceFound: true, lampOn: false, hasNumber: false, searchingMs: 50_000, movement: 0.01, warmth: 0.65 };
  assert.equal(adviceFor({ ...base, light: lit, cause: 'weakSignal', colourDamaged: true }), 'more_light');
  assert.equal(adviceFor({ ...base, light: lit, cause: 'noRate', colourDamaged: true }), 'more_light');
  assert.equal(adviceFor({ ...base, light: dim, cause: 'weakSignal' }), 'brighter_screen');
  assert.equal(adviceFor({ ...base, light: dark, cause: 'weakSignal' }), 'brighter_screen');
  assert.equal(adviceFor({ ...base, light: dark, lampOn: true, cause: 'weakSignal' }), 'more_light');
  assert.equal(adviceFor({ ...base, light: lit, cause: 'lightFlicker' }), 'flicker');
  assert.equal(adviceFor({ ...base, light: lit, cause: 'headMotion' }), 'moving');
  assert.equal(adviceFor({ ...base, light: lit, cause: 'agreeing' }), 'almost');
  assert.equal(adviceFor({ ...base, light: lit, cause: 'waitingForBlink' }), 'almost');
  assert.equal(adviceFor({ ...base, light: lit, movement: 0.2, cause: 'agreeing' }), 'moving');
  assert.equal(adviceFor({ ...base, light: lit, cause: 'noFace' }), 'no_face');
  assert.equal(adviceFor({ ...base, light: lit, hasNumber: true, cause: 'shown' }), 'still');
  // The check has a number the screen does not show yet (the display's 5 s step): almost there, not a fix.
  assert.equal(adviceFor({ ...base, light: lit, hasNumber: false, cause: 'shown' }), 'almost');
  for (const cause of ['weakSignal', 'noRate', 'agreeing', 'lightFlicker', 'headMotion', 'waitingForBlink'] as const)
    for (const light of [lit, dim, dark]) assert.notEqual(adviceFor({ ...base, light, cause }), 'stalled', cause);
  // Without a cause (a library before test.52) the advice is as before.
  assert.equal(adviceFor({ ...base, light: lit, searchingMs: 0 }), 'still');
});

test("light is named only where it is measurably the fault; a filling window says nothing is wrong (owner, 2026-10-29)", () => {
  // On the owner's phone, 52 of 86 seconds of "more white light" were the check filling its window after a start or a
  // return, and the rest a weak signal on a lit face with undamaged colour (face 0.49, no filter).
  const lit = { face: 0.5, centre: 0.5, room: 0.5 };
  const base = { faceFound: true, lampOn: false, hasNumber: false, searchingMs: 50_000, movement: 0.01, warmth: 0.65 };
  assert.equal(adviceFor({ ...base, light: lit, cause: 'collecting' }), 'still');
  assert.equal(adviceFor({ ...base, light: lit, cause: 'weakSignal' }), 'still');
  assert.equal(adviceFor({ ...base, light: lit, cause: 'noRate' }), 'still');
  assert.equal(adviceFor({ ...base, light: lit, cause: 'weakSignal', colourDamaged: true }), 'more_light');
  assert.equal(ADVICE[adviceFor({ ...base, light: lit, cause: 'weakSignal' })], 'Hold still');
  // Owner's copy, 2026-10-29: "white" misled where the light was already white; the fix is the amount of light.
  assert.equal(ADVICE.more_light, 'Add some light in front of you');
  assert.equal(adviceFor({ ...base, light: lit, movement: 0.2, cause: 'weakSignal' }), 'moving');
});

test('a camera starved of light (exposure one frame long or more) on a weak signal asks for light, even on a face that looks lit', async () => {
  const { cameraStarved, EXPOSURE_STARVED } = await import('../pulseGuide');
  // Chrome reports exposureTime in 100 microsecond units: 333 is 33.3 ms, one frame at 30 fps.
  assert.equal(EXPOSURE_STARVED, 333);
  assert.equal(cameraStarved(625), true); // laptop camera in a dim room (received files: -3.3 dB median)
  assert.equal(cameraStarved(416.66), true); // phone in a dim room
  assert.equal(cameraStarved(156.25), false); // laptop in a bright room (+1.5 dB)
  assert.equal(cameraStarved(83.3), false); // phone in daylight
  assert.equal(cameraStarved(null), false); // Safari and others do not report it: no change
  const b = { light: lit, faceFound: true, lampOn: false, hasNumber: false } as const;
  assert.equal(adviceFor({ ...b, cause: 'weakSignal', starved: true }), 'more_light');
  assert.equal(adviceFor({ ...b, cause: 'noRate', starved: true }), 'more_light');
  assert.equal(adviceFor({ ...b, cause: 'weakSignal', starved: false }), 'still');
  assert.equal(adviceFor({ ...b, cause: 'weakSignal' }), 'still');
  // Only for a weak signal: a filling window, a shown number or a moving head keep their own advice.
  assert.equal(adviceFor({ ...b, cause: 'collecting', starved: true }), 'still');
  assert.equal(adviceFor({ ...b, hasNumber: true, starved: true }), 'still');
});

test('only an instruction that asks the person to do something is shown', () => {
  for (const a of ['no_face', 'backlit', 'night_light', 'brighter_screen', 'more_light', 'flicker', 'stalled', 'moving'] as const) assert.equal(needsYou(a), true, a);
  for (const a of ['no_camera', 'still', 'almost'] as const) assert.equal(needsYou(a), false, a);
});


describe("PulseGuide: the line an app shows", () => {
	const lit = { face: 0.5, centre: 0.5, room: 0.5 };
	it("shows a fix after it holds, nothing for progress, nothing over a number on screen", async () => {
		const { PulseGuide, ADVICE_HOLD_MS } = await import("../pulseGuide");
		const g = new PulseGuide();
		const dark = { light: { face: 0.1, centre: 0.1, room: 0.1 }, faceFound: true, lampOn: true, cause: "weakSignal" as const };
		expect(g.next(0, dark, false).text).toBeNull();
		g.next(1000, dark, false);
		expect(g.next(1000 + ADVICE_HOLD_MS, dark, false).text).toBe("Add some light in front of you");
		expect(g.next(1000 + ADVICE_HOLD_MS + 1, dark, true).text).toBeNull();
		const calm = { light: lit, faceFound: true, lampOn: false, cause: "agreeing" as const };
		const h = new PulseGuide();
		for (let t = 0; t <= 20_000; t += 1000) expect(h.next(t, calm, false).text).toBeNull();
	});
	it("Safari: a long weak wait on a lit face, exposure unknown, gets the stall line; with exposure known it does not", async () => {
		const { adviceFor, STALL_MS } = await import("../pulseGuide");
		const base = { light: lit, faceFound: true, lampOn: false, hasNumber: false, cause: "weakSignal" as const };
		expect(adviceFor({ ...base, exposureKnown: false, searchingMs: STALL_MS })).toBe("stalled");
		expect(adviceFor({ ...base, exposureKnown: false, searchingMs: STALL_MS - 1 })).toBe("still");
		expect(adviceFor({ ...base, exposureKnown: true, searchingMs: STALL_MS })).toBe("still");
		expect(adviceFor({ ...base, searchingMs: STALL_MS })).toBe("still");
	});
});

describe("hold still while the first window fills", () => {
	it("a moving head while the window fills is told to hold still; a still one is told nothing", async () => {
		const { adviceFor, MOVE_MAX } = await import("../pulseGuide");
		const base = { light: { face: 0.5, centre: 0.5, room: 0.5 }, faceFound: true, lampOn: false, hasNumber: false, cause: "collecting" as const };
		expect(adviceFor({ ...base, movement: MOVE_MAX + 0.05 })).toBe("moving");
		expect(adviceFor({ ...base, movement: MOVE_MAX - 0.01 })).toBe("still");
		expect(adviceFor({ ...base, movement: null })).toBe("still");
	});
});

// "Hold still" follows what the head does now (owner, 2026-11-01: it stayed up while he was still). The 8 s spread says
// whether the window is spoiled; the last 2 s say whether the head is still moving; the line clears the moment it is not.
test('"hold still" only while the head is still moving now, and it clears at once', async () => {
  const { MOVE_STILL_MAX, MOVE_NOW_WINDOW_MS } = await import('../pulseGuide');
  assert.deepEqual([MOVE_STILL_MAX, MOVE_NOW_WINDOW_MS], [0.02, 2000]);
  const lit = { face: 0.5, centre: 0.5, room: 0.5 };
  const base = { light: lit, faceFound: true, lampOn: false, hasNumber: false } as const;
  for (const cause of [undefined, 'collecting', 'weakSignal', 'agreeing', 'headMotion'] as const) {
    assert.equal(adviceFor({ ...base, cause, movement: 0.2, movementNow: 0.05 }), 'moving', `${cause} moving now`);
    assert.notEqual(adviceFor({ ...base, cause, movement: 0.2, movementNow: 0.01 }), 'moving', `${cause} still now`);
  }
  // No 2 s judgement (too few rows): the 8 s spread decides, as before.
  assert.equal(adviceFor({ ...base, movement: 0.2, movementNow: null }), 'moving');
  // "Hold still" shows and clears at once; other lines keep their hold.
  assert.equal(shownAfter({ advice: 'still', pending: null, since: 0 }, 'moving', 100, false).advice, 'moving');
  const shown = { advice: 'moving' as const, pending: null, since: 0 };
  assert.equal(shownAfter(shown, 'still', 100, false).advice, 'still');
  const light = { advice: 'more_light' as const, pending: null, since: 0 };
  assert.equal(shownAfter(light, 'still', 100, false).advice, 'more_light');
  // The 2 s window: a head that moved and then stopped reads still over 2 s while the 8 s spread still holds the move.
  const pts = Array.from({ length: 240 }, (_, i) => ({ t_ms: i * 33, x: i < 120 ? 300 + (i % 2) * 40 : 300, y: 240, w: 240 }));
  assert.ok(movementOf(pts, 239 * 33)! > MOVE_MAX);
  assert.ok(movementOf(pts, 239 * 33, MOVE_NOW_WINDOW_MS)! < MOVE_STILL_MAX);
});
