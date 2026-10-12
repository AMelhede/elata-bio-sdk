# Fix 13. Show the rate the processor settled on (opt-in `calibrationBlend: false`)

- **Problem.** The number shown is a blend of two estimates through an untrained calibration, and neither of them
  measured it.
- **Fix.** An opt-in option that shows the settled (resolved) rate instead.
- **Verdict.** Fine, but modest.
- **Strongest evidence** [synthetic]. A true 120 shows 95.7 rising to 116.4 on 0.14.0 while the resolved and spectral
  estimates say 120 and the autocorrelation says 60; with the option, 120.0 every second. Default unchanged
  (3,024 reads, 0 differ). Grey-pulse suite with the option: 2,053 against 1,813 right seconds, 7 lost, 247 gained.
- **Cost.** One more option kept forever; with it on, 23 session seconds lost and 4 more no-pulse seconds.
- **Still open.** [owner] 19.4% to 24.3% right; with fixes 4 and 5 in place it adds nothing on those recordings.
- **Where.** Branch `fix/no-calibration-blend` 608e797; `pr/no-calibration-blend` c4f98c2 (local). Not in the test
  build: build the branch to see the "with" numbers.

Files: [pr.md](pr.md), audit [../../audits/estimators.md](../../audits/estimators.md), [blend.mjs](blend.mjs), and
[../05-no-rate-doubling/grey-suite.mjs](../05-no-rate-doubling/grey-suite.mjs).

```
node blend.mjs <0.14.0 dir>                                     # 95.7 ... 116.4
node blend.mjs <fix-branch build> '{"calibrationBlend":false}'   # 120.0 every second
```
