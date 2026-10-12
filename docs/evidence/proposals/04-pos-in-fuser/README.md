# Fix 4. POS in the multi-region fuser

- **Problem.** The fuser's CHROM divides each channel by its mean but does not subtract 1, so alpha's wobble lands in
  the output as noise.
- **Fix.** POS (Wang et al. 2017) by default; `fusionProjection: "chrom"` keeps the old output for rollback.
- **Verdict.** Strong.
- **Strongest evidence** [synthetic]. A true 72 through the fuser, five noise seeds: 0.14.0 reads 99, 50, 67, 109, 63;
  POS reads 72 five times. With the real engine a true 120 is right in 0 of 150 s on 0.14.0 and 150 of 150 with POS.
  HRV on a steady pulse (true RMSSD about 0): 14 to 20 ms against 113 to 179 ms. That is a large drop, but 14 to 20 ms
  of error is still about the size of a real resting RMSSD, so this alone does not make HRV usable. A golden test
  pins `"chrom"` to main's output.
- **Cost.** The default rate, `signal_quality` and HRV of every face-mesh session change; minor bump.
- **Still open.** Breathing under POS has no known-answer test yet. A number still shows in about half of no-pulse
  seconds (that belongs to the estimator; the pulse check addresses it). Default against opt-in is Elata's call.
- **Where.** Branch `fix/pos-in-fuser` 564d589; `pr/pos-in-fuser` deca8d7 (local). Test build: `posFusion`.

Files: [pr.md](pr.md), audit [../../audits/runner.md](../../audits/runner.md), [fuser.mjs](fuser.mjs).

```
node fuser.mjs <0.14.0 dir>        # 99, 50, 67, 109, 63
node fuser.mjs packages/rppg-web   # default projection 72, 72, 72, 72, 72
```
