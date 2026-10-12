# Fix 11. The processor's own colour path (opt-in `rgbPulse: "pos"`)

- **Problem.** Apps that push colour straight into `RppgProcessor` read about 84 whatever the true rate.
- **Fix.** An opt-in option that uses POS and the fuser's band-pass on that path, with no raw green while it warms up.
- **Verdict.** Strong.
- **Strongest evidence** [synthetic]. A true 50, 72, 120 at 30 fps and 72 at 20 fps: 0.14.0's spectral estimate
  reads 84.0 every time; with the option 51, 72, 120, 72. With the real WASM over 3 seeds, right in 0 to 9 of 90 s on
  main and 87 to 90 of 90 with the option. 14 break-on-purpose mutations all go red.
- **Cost.** No measurable speed cost; the suite runs 56 s against 34 s. Opt-in, so nobody benefits until they switch.
  On by default it fails the stated rule: with no pulse it shows a number in 72% of seconds against 19%.
- **Real recordings** [owner]. `owner-recordings.mjs`, re-run 2026-10-12: published 0.14.0 right on 1,044 of 6,679
  seconds, the test build with the switch on 2,002, better in 43 of 50 recordings and worse in 7. The audit scored
  the fix branch itself at 1,692 with its own harness; why the two differ was not traced.
- **Still open.** The band-pass corner
  reads 54 to 56 for a true 50 in 3 of 10 seeds.
- **Where.** Branch `fix/processor-colour-pulse` b748546; `pr/processor-colour-pulse` 9828923 (local). Test build:
  `fixes: { rgbPulse: true }` (off by default).

Files: [pr.md](pr.md), audit [../../audits/processor.md](../../audits/processor.md), [colour-path.mjs](colour-path.mjs),
[owner-recordings.mjs](owner-recordings.mjs) (needs the private recordings).

```
node colour-path.mjs <0.14.0 dir>                                          # spectral 84.0 four times
node colour-path.mjs packages/rppg-web '{"fixes":{"rgbPulse":true}}'      # 51, 72, 120, 72
RECORDINGS_DIR=<private folder> node owner-recordings.mjs <0.14.0 dir> packages/rppg-web '{"fixes":{"rgbPulse":true}}'
```
