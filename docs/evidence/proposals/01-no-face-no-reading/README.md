# Fix 1. No face means no reading

- **Problem.** Point the camera at a wall and 0.14.0 still shows a heart rate, every second, for as long as you like.
- **Fix.** With face tracking on, after 1 s with no face the session shows nothing; when the face returns, the
  reading starts fresh. `requireFace: false` restores the old behaviour.
- **Verdict.** Strong.
- **Strongest evidence** [synthetic]. A true 66 with a 10 s wall gap: 0.14.0 shows a number in 10 of 10 gap seconds,
  is right in 31 of the 65 s after, and first right 35 s after the face returns. With the fix: 1 held reading in
  the gap, then nothing; right in 65 of 65 s after (test build, which also has POS in the fuser).
- **Cost.** Apps lose the number while no face is in view (the point). New public surface: `no_face` drop reason,
  `requireFace`, `faceAbsentMs()`, `resetSignal()`; minor bump.
- **Still open.** The 1 s hold rests on captures of still people; moving people are not measured.
- **Where.** Branch `fix/no-face-no-reading` 21b7326; one-commit review ref `pr/no-face-no-reading` 6950c68 (local,
  not yet pushed). In the test build: switch `noFaceNoReading`.

Files: [pr.md](pr.md) (the PR text), audit: [../../audits/runner.md](../../audits/runner.md) (fix 1 rows and its
Closed section), [face-gap.mjs](face-gap.mjs).

```
node face-gap.mjs <0.14.0 dir> gap 10      # a number in 10/10 s of the gap
node face-gap.mjs packages/rppg-web gap 10 # (from the repo root) a number in 1/10 s, right 65/65 after
node face-gap.mjs <0.14.0 dir> miss 733    # a brief face-finder miss with the face still in view
```
