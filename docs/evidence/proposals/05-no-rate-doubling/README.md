# Fix 5. The spectral estimator stops doubling resting rates

- **Problem.** A rule reads a resting 65 with a normal second harmonic as 132.
- **Fix.** Remove the doubling rule.
- **Verdict.** Keep, with a narrower claim: its value on real recordings shows only together with fix 13's option.
- **Strongest evidence** [synthetic]. `estimateDominantBpm` on 65 bpm with harmonic 0.6: 132 on 0.14.0, 66 with the
  fix. 105 clean resting pulses: 69 right on 0.14.0, 105 with the fix. Grey-pulse suite: 1,813 against 2,237 right
  seconds of 2,592, 0 lost. `spectralNoDoubling.test.ts`: 8 of 9 red on main.
- **Cost.** No pulse: a number in 230 of 432 s against 220. A true 140 with a stronger 70 line reads 69 (conceded).
- **Still open.** The harmonic strengths 0.4 to 0.6 were chosen to make the rule fire; contact-PPG literature gives
  about 0.12 (Park et al. 2023). [owner] the ratio passed 0.35 in 41 of 568 windows; fix 5 alone through main's
  session path: 1,296 to 1,289 right of 6,679 s (p 0.87).
- **Where.** Branch `fix/no-rate-doubling` ea12c6b; `pr/no-rate-doubling` 1a73b09 (local). Test build: `noRateDoubling`.

Files: [pr.md](pr.md), audit [../../audits/estimators.md](../../audits/estimators.md), [doubling.mjs](doubling.mjs),
[grey-suite.mjs](grey-suite.mjs) (also used by fix 13).

```
node doubling.mjs <0.14.0 dir>            # 132; 60 withheld; 72 reads 98.3
node doubling.mjs packages/rppg-web       # 66; 60; 72
node grey-suite.mjs <0.14.0 dir> packages/rppg-web   # about 10 minutes; prints its self-check first
BREAK=rate node grey-suite.mjs <0.14.0 dir>           # must throw (also BREAK=window, BREAK=nogate)
```
