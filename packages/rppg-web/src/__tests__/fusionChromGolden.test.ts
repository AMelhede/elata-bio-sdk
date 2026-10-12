import { MultiRoiRppgFuser, type FusionRoiName } from '../multiRoiFusion';

// fusionProjection "chrom" is kept so that the fuser's previous output stays reachable. This pins it:
// the summary below was produced by the fuser on Elata main 49fdb41 (and by the published 0.14.0
// dist) for exactly this input, which has a region dropping out, a region below the skin threshold
// and a reset part way through. If any of it moves, "chrom" no longer reproduces the old fuser.

function runStream(fuser: MultiRoiRppgFuser) {
  let s = 12345;
  const noise = () => {
    let t = 0;
    for (let k = 0; k < 4; k++) { s = (s * 1664525 + 1013904223) >>> 0; t += s / 4294967296; }
    return (t - 2) * 1.5;
  };
  const sum = { valid: 0, fused: 0, fused2: 0, fusedOrder: 0, fusedSnr: 0, foreheadWeight: 0, cheekSnr: 0 };
  for (let i = 0; i < 900; i++) {
    if (i === 500) fuser.reset();
    const p = 0.004 * Math.sin((2 * Math.PI * 1.2 * i) / 30);
    const region = (skin: number) => ({ r: 180 * (1 + 0.33 * p) + noise(), g: 120 * (1 + 0.77 * p) + noise(), b: 100 * (1 + 0.53 * p) + noise(), skinFraction: skin });
    const frame: Partial<Record<FusionRoiName, ReturnType<typeof region>>> = {
      forehead: region(0.9),
      leftCheek: i % 97 < 20 ? undefined : region(0.8),
      rightCheek: region(i % 61 < 15 ? 0.05 : 0.7),
    };
    const out = fuser.pushFrame(frame);
    if (!out.valid) continue;
    sum.valid += 1;
    sum.fused += out.fused;
    sum.fused2 += out.fused * out.fused;
    sum.fusedOrder += out.fused * ((i % 13) - 6);
    sum.fusedSnr += out.fusedSnr;
    sum.foreheadWeight += out.weights.forehead;
    sum.cheekSnr += out.snr.leftCheek + out.snr.rightCheek;
  }
  return sum;
}

// Printed with toPrecision(17) from 49fdb41's dist/multiRoiFusion.js.
const MAIN_49FDB41 = {
  valid: 900,
  fused: -1.8361663750866783,
  fused2: 2.8756434728875888,
  fusedOrder: 4.0572133439041371,
  fusedSnr: 2846.7296577304264,
  foreheadWeight: 315.29913304827431,
  cheekSnr: 7034.6825814065014,
};

function expectSame(actual: Record<string, number>, expected: Record<string, number>) {
  for (const [key, want] of Object.entries(expected)) {
    // Relative 1e-9: far tighter than any change to the projection could stay inside, loose
    // enough that a different libm rounding of Math.sin in another Node version does not trip it.
    const tol = Math.max(1e-12, Math.abs(want) * 1e-9);
    expect({ key, diff: Math.abs(actual[key] - want) <= tol, actual: actual[key] }).toEqual({ key, diff: true, actual: actual[key] });
  }
}

describe('fusionProjection "chrom"', () => {
  test('reproduces the fuser on Elata main 49fdb41', () => {
    expectSame(runStream(new MultiRoiRppgFuser(30, undefined, undefined, 'chrom')), MAIN_49FDB41);
  });

  test('the default projection is not the old fuser, so the check above can fail', () => {
    const pos = runStream(new MultiRoiRppgFuser(30));
    expect(Math.abs(pos.fused - MAIN_49FDB41.fused)).toBeGreaterThan(1e-3);
  });
});
