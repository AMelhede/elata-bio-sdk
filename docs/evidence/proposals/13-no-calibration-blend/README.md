# Fix 13. Show the rate the processor settled on (opt-in `calibrationBlend: false`)

- **Problem.** The number shown is a blend of two estimates through an untrained calibration, and neither of them
  measured it.
- **Fix.** An opt-in option that shows the settled (resolved) rate instead.
- **Verdict.** Fine, but modest.
- **Strongest evidence** [synthetic]. With the real WASM engine, the grey-pulse suite
  ([../05-no-rate-doubling/grey-suite.mjs](../05-no-rate-doubling/grey-suite.mjs)): right in 2,053 of 2,592 pulse
  seconds with the option against 1,813 on 0.14.0, 7 lost, 247 gained. Default unchanged (3,024 reads, 0 differ).
  The smaller demo, `blend.mjs`, stubs the engine and has it report the true rate: a true 120 shows 95.7 rising to
  116.4 on 0.14.0 while the resolved and spectral estimates say 120 and the autocorrelation says 60; with the
  option, 120.0 every second. Because the stub hands the processor the answer, read it as a picture of the
  mechanism, not as evidence; the grey-pulse suite is the evidence.
- **Limit found in review** [synthetic, 2026-10-12]. The option shows the resolved rate, and the resolved rate
  follows a confident engine. With the stub reporting 60 at confidence 0.8 for the same true 120, 0.14.0's
  `resolved_bpm` (what the option would show) is 60, and the blend shows 60 to 64.5. With the stub at 90 the
  resolved rate stays 120. So the option removes the blend's lag; it does not correct an engine that is an octave
  off. To rerun: change the stub's `bpm: 120` in `blend.mjs` to 60 and read `resolved_bpm` on 0.14.0.
- **Cost.** One more option kept forever; with it on, 23 session seconds lost and 4 more no-pulse seconds.
- **Still open.** An engine an octave off is shown as is (limit above). [owner] 19.4% to 24.3% right on main; on Elata main with fix 4,
  1,895 to 2,282 right seconds of 6,679 (37 recordings better, 8 worse). The earlier "adds nothing with fixes 4 and 5
  in place" was measured on our test build (test.19), not on Elata main.
- **Where.** Branch `fix/no-calibration-blend` 608e797; `pr/no-calibration-blend` c4f98c2 (local). Not in the test
  build: build the branch to see the "with" numbers.

Files: [pr.md](pr.md), audit [../../audits/estimators.md](../../audits/estimators.md), [blend.mjs](blend.mjs), and
[../05-no-rate-doubling/grey-suite.mjs](../05-no-rate-doubling/grey-suite.mjs).

```
node blend.mjs <0.14.0 dir>                                     # 95.7 ... 116.4
node blend.mjs <fix-branch build> '{"calibrationBlend":false}'   # 120.0 every second
```
