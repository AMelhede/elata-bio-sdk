import { BACKGROUND_HOLD_MS, BACKGROUND_MAX_BURST_MS, BackgroundDuty, type BackgroundReadingMark } from '../backgroundFrames';

// Option backgroundEveryMs: bursts while hidden, the worker dropping frames between them.
describe('backgroundEveryMs (BackgroundDuty)', () => {
  const mark = (evaluations: number, measured: boolean, passive = 0): BackgroundReadingMark => ({ evaluations, measured, passive });

  test('a burst ends at its first reading plus the hold, or at its longest; the next starts every everyMs from the last start', () => {
    const d = new BackgroundDuty({ everyMs: 300_000, maxBurstMs: 90_000, holdMs: 10_000 });
    d.begin(0, mark(5, true));
    // A proven rate left from before the burst does not count until the check evaluates again.
    expect(d.step(1000, mark(5, true))).toBe(true);
    expect(d.step(20_000, mark(20, true))).toBe(true);
    expect(d.step(29_000, mark(29, true))).toBe(true);
    expect(d.step(30_000, mark(30, true))).toBe(false);
    expect(d.phase).toBe('rest');
    expect(d.bursts[0]).toEqual({ startMs: 0, startEpochMs: null, endMs: 30_000, readingAfterMs: 20_000, bpm: null, source: 'check' });
    expect(d.nextMs()).toBe(300_000);
    d.begin(300_000, mark(30, false));
    expect(d.step(389_000, mark(119, false))).toBe(true);
    expect(d.step(390_000, mark(120, false))).toBe(false);
    expect(d.bursts[1].readingAfterMs).toBeNull();
    // A passive reading made in the burst stands too.
    d.begin(600_000, mark(120, false, 2));
    expect(d.step(650_000, mark(170, false, 3))).toBe(true);
    expect(d.step(660_000, mark(180, false, 3))).toBe(false);
  });

  test('each burst keeps its reading: the rate, from the check or the passive reader, and the wall clock at its start', () => {
    const d = new BackgroundDuty({ everyMs: 300_000, maxBurstMs: 120_000, holdMs: 0 });
    d.begin(0, { ...mark(0, false), checkBpm: null, passiveBpm: 61 }, 1_700_000_000_000);
    expect(d.step(25_000, { ...mark(25, true), checkBpm: 70.5, passiveBpm: 61 })).toBe(false);
    d.begin(300_000, { ...mark(25, true, 4), checkBpm: 70.5, passiveBpm: 61 }, 1_700_000_300_000);
    expect(d.step(350_000, { ...mark(75, false, 5), checkBpm: null, passiveBpm: 66.2 })).toBe(false);
    d.begin(600_000, mark(75, false, 5));
    expect(d.step(720_000, mark(195, false, 5))).toBe(false);
    expect(d.bursts.map((b) => [b.startEpochMs, b.source, b.bpm, b.endMs])).toEqual([
      [1_700_000_000_000, 'check', 70.5, 25_000],
      [1_700_000_300_000, 'passive', 66.2, 350_000],
      [null, null, null, 720_000],
    ]);
  });

  test('defaults: the longest burst and the hold; a burst never outlasts the interval', () => {
    const d = new BackgroundDuty({ everyMs: 300_000 });
    expect([d.maxBurstMs, d.holdMs]).toEqual([BACKGROUND_MAX_BURST_MS, BACKGROUND_HOLD_MS]);
    expect([BACKGROUND_MAX_BURST_MS, BACKGROUND_HOLD_MS]).toEqual([120_000, 0]);
    expect(new BackgroundDuty({ everyMs: 60_000, maxBurstMs: 120_000 }).maxBurstMs).toBe(60_000);
  });
});
