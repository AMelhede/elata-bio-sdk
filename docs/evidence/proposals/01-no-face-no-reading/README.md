# Fix 1. No face means no reading

- **Problem.** Point the camera at a wall and 0.14.0 still shows a heart rate, every second, for as long as you like.
- **Fix.** With face tracking on, after 2 s with no face the session shows nothing; when the face returns, the
  reading starts fresh. `requireFace: false` restores the old behaviour.
- **Verdict.** Strong.
- **Strongest evidence** [synthetic]. A true 66 with a 10 s wall gap: 0.14.0 shows a number in 10 of 10 gap seconds,
  is right in 31 of the 65 s after, and first right 35 s after the face returns. With the fix alone (55de1a7): 2 held
  readings in the gap, then nothing; right in 61 of 65 s after (the 3 wrong ones are the CHROM fuser restarting; merged
  with POS in the fuser, 65 of 65). In the test build (1 s hold, POS in the fuser): 1 held reading, then right in 65 of 65.
- **Cost.** Apps lose the number while no face is in view (the point); the last number stays up to 2 s after the face
  goes. A 1.5 to 2 s loss on a still face reads up to 6 bpm low for 10 to 27 s after [synthetic]. New public surface: `no_face` drop reason,
  `requireFace`, `faceAbsentMs()`, `resetSignal()`; minor bump.
- **Why 2 s** [synthetic, 2026-10-12]. A synthetic face turning away, nodding, moving fast or staying still while
  the face finder misses (180 runs, true 60, 72, 100, face lost 0.3 to 5 s): wrong / right seconds 1083 / 2917 on
  main, 539 / 3177 with a 1 s hold, 388 / 3428 with 2 s. Almost all of the gain is losses of 1 to 2 s, where 1 s
  restarts and a restarted window on a moving head is wrong for 1 to 11 s (median about 5). Holding the number back
  3 to 12 s after a 1 s restart lost more right seconds than it saved. [owner] 1 of 20 real face-loss moments fell
  in the 1 to 2 s band. **Decided: the PR holds 2 s** (it shows the old number one second longer than 1 s would).
- **Still open.** Real people moving, turning and leaving have not been measured; only the synthetic head above.
- **Where.** Branch `fix/no-face-no-reading` 55de1a7; one-commit review ref `pr/no-face-no-reading` 8dde554 (local,
  not yet pushed). In the test build: switch `noFaceNoReading`, still with the 1 s hold as of test.21 (see open-gaps.md).

Files: [pr.md](pr.md) (the PR text), audit: [../../audits/runner.md](../../audits/runner.md) (fix 1 rows and its
Closed section), [face-gap.mjs](face-gap.mjs).

```
node face-gap.mjs <0.14.0 dir> gap 10      # a number in 10/10 s of the gap
node face-gap.mjs packages/rppg-web gap 10 # (from the test build's repo root, 1 s hold) a number in 1/10 s, right 65/65 after
node face-gap.mjs <0.14.0 dir> miss 733    # a brief face-finder miss with the face still in view
```
