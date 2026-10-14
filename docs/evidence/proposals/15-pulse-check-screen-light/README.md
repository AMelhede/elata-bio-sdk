# Fix 15. Pulse check rule `screenLight`: a window one light steps on the whole face is not evidence

- **Depends on.** The pulse check ([../pulse-check/](../pulse-check/)), a fork feature that is not on Elata main:
  `pulseCheck.ts` does not exist at 49fdb41. So this cannot be one commit on 49fdb41. It is one commit on
  `release/test-1` e3e44c3 (test.21) and belongs in the pulse check's split ([../pulse-check/split-plan.md](../pulse-check/split-plan.md))
  as one more rule PR, after the rule PRs it sits beside (it edits the same rule list and the same evaluation step).
- **Problem.** A face with no pulse lit only by a screen showing video gets a heart rate: one light moves forehead
  and both cheeks together, so the regions agree on whatever rhythm the screen has.
- **Fix.** A 16 s window with 10 or more equal light steps (all three regions change brightness in one frame, same
  direction, nearly the same share, and the new level holds) does not count toward the proof. It only withholds.
- **Verdict.** Strong on known answers, with stated misses.
- **Strongest evidence** [synthetic]. `screen-light.mjs`: five screen-lit pulseless faces show a rate in 2 to 16 of
  90 s with the rule off and in 0 with it on, at both value scales (0 to 255 and 0 to 1). In jest, 30 such faces:
  a rate on 14 with the rule off, on none with it on; a 70 bpm pulse in steady light, under uneven-drop mains flicker
  and under hunting auto exposure still reads 70.
- **Measured in an app that runs the same rule** [synthetic, contributor-side]: of 134 generated screen-lit faces
  with no pulse, a rate was shown on 70 without it and 9 with it.
- **Limits.** Slow screens (steps 1 to 3 s apart) or shallow ones (5%) make too few steps and are still missed: those
  are the 9 of 134. A real pulse under a changing screen is withheld, not read: in the same app's 134 variants with a
  70 bpm pulse, 6 showed wrong seconds without the rule and none with it, but only 44 were read at all.
- **Found and fixed.** The first version's brightness floor assumed 0 to 255; the session sends 0 to 1, so every frame
  was discarded and the rule never fired live. The floor now reads the scale from the values; a test pins it.
- **Cost.** One more rule and switch (`pulseCheckRules.screenLight`, on by default), two state fields.
- **Where.** `fix.patch`: one commit on `release/test-1` e3e44c3; the fork's own commits are 46911ae, 0aa5f12,
  e86066f, 6aa1beb on `night/trial-budget`.

Files: [pr.md](pr.md), [fix.patch](fix.patch), [screen-light.mjs](screen-light.mjs).

```
node screen-light.mjs <tree with fix.patch>/packages/rppg-web    # rule off: a rate; rule on: none, both scales
node screen-light.mjs <release/test-1 e3e44c3>/packages/rppg-web # no rule yet: on = off
BREAK=pulse node screen-light.mjs <tree>/packages/rppg-web       # must throw "self-check"
```

The package needs `dist/` built (`npx tsc -p . && node scripts/fix-dist-import-specifiers.mjs` in `packages/rppg-web`).
