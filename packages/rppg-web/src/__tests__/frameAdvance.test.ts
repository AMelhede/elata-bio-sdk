import { ADVANCE_TRUST_READS, frameAdvanceGate } from '../frameAdvance';

const counting = () => { const v = { n: 0, getVideoPlaybackQuality: () => ({ totalVideoFrames: v.n }) }; return v; };

describe('frameAdvanceGate', () => {
  test('a 7.5 fps camera under a 30 Hz timer: one read per camera frame, not four', () => {
    const v = counting(); const gate = frameAdvanceGate(v); let passed = 0;
    for (let tick = 0; tick < 120; tick++) { if (tick % 4 === 0) v.n++; if (gate()) passed++; }
    expect(passed).toBe(30);
  });
  test('no frame counter: every read passes (the path as before)', () => {
    const gate = frameAdvanceGate({}); let passed = 0;
    for (let i = 0; i < 50; i++) if (gate()) passed++;
    expect(passed).toBe(50);
  });
  test('a counter that never moves (live stream not counted): passes again after ADVANCE_TRUST_READS', () => {
    const v = counting(); const gate = frameAdvanceGate(v); let passed = 0;
    for (let i = 0; i < 100; i++) if (gate()) passed++;
    expect(passed).toBe(100 - ADVANCE_TRUST_READS + 1);
  });
  test('a counter that throws or is not a number: every read passes', () => {
    const bad = frameAdvanceGate({ getVideoPlaybackQuality: () => { throw new Error('x'); } });
    const nan = frameAdvanceGate({ getVideoPlaybackQuality: () => ({}) });
    expect([bad(), bad(), nan(), nan()]).toEqual([true, true, true, true]);
  });
  test('a camera that stalls for 2 s after its counter has moved: no copies read during the stall, gate stays on', () => {
    const v = counting(); const gate = frameAdvanceGate(v); let passed = 0;
    for (let tick = 0; tick < 20; tick++) { if (tick % 2 === 0) v.n++; if (gate()) passed++; }
    expect(passed).toBe(10);
    for (let tick = 0; tick < 60; tick++) if (gate()) passed++;
    expect(passed).toBe(10);
    v.n++; expect(gate()).toBe(true); expect(gate()).toBe(false);
  });
  test('a camera that pauses for under ADVANCE_TRUST_READS reads and comes back is still gated', () => {
    const v = counting(); const gate = frameAdvanceGate(v); const out: boolean[] = [];
    v.n = 1; out.push(gate()); for (let i = 0; i < 10; i++) out.push(gate()); v.n = 2; out.push(gate()); out.push(gate());
    expect(out.filter(Boolean).length).toBe(2);
  });
});
