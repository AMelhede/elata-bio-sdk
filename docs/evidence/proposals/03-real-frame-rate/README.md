# Fix 3. Feed the fuser at the speed it was built for

- **Problem.** The multi-region fuser assumes 30 frames a second whatever the camera delivers.
- **Fix.** Put the frames on a steady 30-a-second grid before the fuser.
- **Verdict.** Narrow, and **held from the first round** (not withdrawn). Once fix 4 is in it changes no rate anyone
  reads; it corrects a quality score. It comes back only with a pre-registered test on recordings nobody has looked
  at; if it does, it lands after fix 4 (merge plan, section 2).
- **Strongest evidence** [synthetic]. 160 bpm at 15 fps keeps 0.48 of its 30 fps amplitude on 0.14.0 and 0.93 to
  0.94 with the grid; first quality score at 15 fps 6.93 s against 3.47 s. On the merged tree the quality test is
  red with fix 4 alone (0.19 and 2.77 of the 30 fps value) and green with fix 3 (1.00 and 1.00).
- **Cost.** At 15 fps `getMetrics()` takes 142 ms against 57 ms (equal to a 30 fps camera without the grid);
  237 more lines. Alone, with CHROM, it reads resting rates worse at 15 to 24 fps.
- **Still open.** "Fewer numbers, right more often" was seen after the fact, not pre-registered; a held-out check needs
  recordings nobody has looked at. [owner] with fix 4: 30.0% against 29.9% of windows right (p 0.76).
  Interaction [owner, 2026-10-13]: with fix 3 in, fix 13's option adds nothing on the owner's recordings (the blend it
  replaces is already about as right), so if fix 3 returns, fix 13 is re-measured with it.
- **Where.** Branch `fix/real-frame-rate` bd72c7e; `pr/real-frame-rate` ff1cc00 (local). Test build: `realFrameRate`.

Files: [pr.md](pr.md), audit [../../audits/runner.md](../../audits/runner.md), [grid-amp.mjs](grid-amp.mjs).

```
node grid-amp.mjs <0.14.0 dir>        # 0.48, 0.63, 6.93 s
node grid-amp.mjs packages/rppg-web   # the test build: 0.93, 1.01, 3.47 s (rerun 2026-10-12); the fix branch's own build
                                      # prints 0.94, 1.04, 3.47 s (pr.md); both carry the grid, the two builds differ elsewhere
```
