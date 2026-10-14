# Fix 15: a screen showing video on a face with no pulse is read as a heart rate

Base: `release/test-1` e3e44c3 on github.com/AMelhede/elata-bio-sdk (test.21), not Elata main 49fdb41. `fix.patch`
is one commit on e3e44c3 and `git am` applies it cleanly there. It does not apply to 49fdb41: it adds a rule to the
pulse check (`packages/rppg-web/src/pulseCheck.ts`), which is a fork feature Elata main does not have.

## Dependency

The pulse check is proposed as its own series ([../pulse-check/](../pulse-check/), split in
[../pulse-check/split-plan.md](../pulse-check/split-plan.md)). This rule is one more step of that series: one rule,
one switch, its own test. There is no upstream equivalent to write it against, because main has no notion of a
proven pulse that a window could fail to count toward. So it goes after the check's base PR and the light rules,
and is cut from this commit when the series is cut.

## Issue

**Title:** with the pulse check on, a face with no pulse lit by a screen showing video still gets a heart rate

**How it happens.** The check shows a rate only when forehead and both cheeks agree on one rate, above the noise,
over consecutive windows, and the wall and head rules do not explain it. A screen is the one light that defeats
that: it lights all three regions alike, so they agree, and with the wall dark (the screen lights the face, not the
room) the wall rules see nothing. A screen showing video changes level every 0.3 to 1.5 s, and that sequence has
enough periodic power in the pulse band to be proven as a rate.

**What separates it from blood.** Blood changes the skin smoothly, a few percent over a whole beat. A screen cut, a
switched lamp or an exposure change scales all the skin at once, in one frame, by the same share everywhere.
Movement and a passing hand step the regions unequally.

## Pull request

**Title:** feat(rppg-web): pulse check rule screenLight, a window one light steps on the whole face is not evidence

**What changes**

- `equalLightStep(a, b)`: frames under 250 ms apart in which all three regions move the same direction, the smallest
  move over max(1%, 0.4 per second x the frame gap) of the region's brightness (0.4/s bounds a 2% pulse's slope at
  3 Hz, 2 pi x 3 x 0.02), the largest at most 1.35 x the smallest, every region brighter than 30 of 765 of full scale.
- `levelHolds`: a step counts only if no region gives back half of it within 100 ms. A screen holds its new level;
  mains flicker filmed with uneven frame drops moves every region together too, but reverses on the next kept frame.
- `screenSteps`: equal steps in the 16 s window; consecutive frames stepping the same way (auto exposure easing over
  several frames) count once.
- In the evaluation, a window with 10 or more (`SCREEN_STEPS_PER_WINDOW`) is tainted: not counted toward the proof
  streak or the early and strong paths. It never makes or changes a rate.
- Rule switch `pulseCheckRules.screenLight`, on by default; `false` is the behaviour before. State fields
  `windowScreenSteps` and `screenLight`. README row, `llms.txt`, a patch changeset.
- `pulseCheckRules.test.ts`: two lamp tests written before this rule now set `screenLight: false` to judge the rules
  they were written for, and pin that this rule alone also withholds that lamp.

**How it was tested** (on e3e44c3 with `fix.patch` applied by `git am`, 2026-10-14)

- `pulseCheckScreenLight.test.ts` (new, 12 tests), generated rows, no camera:
  - five screen-lit pulseless faces: a rate with the rule off, none with it on, 10 or more steps in a window;
  - 30 such faces: a rate on 14 with the rule off, on none with it on;
  - a 70 bpm chromatic pulse in steady light, under uneven-drop mains flicker (17 of 30 frames kept, the lamp
    +-15%), and while auto exposure hunts (8 gains, each eased over 4 frames) still reads 70 (within 3 or 4);
  - the same screen as 0 to 1 values, as the session's skin-masked region mean sends them: still caught;
  - a screen on one region only: no step counted.
- Break on purpose, each alone: the rule never firing (`SCREEN_STEPS_PER_WINDOW` set to 1e9) turns 7 of 12 red; the
  brightness floor fixed to the 0 to 255 scale turns 1 red (the 0 to 1 case).
- The pulse check's and the README's suites with the patch: 18 suites, 229 tests pass; the whole rppg-web jest
  suite: 84 suites, 844 tests pass.
- `screen-light.mjs` (in this folder, Node 20+, needs only a built `dist/`): self-checks that a known 70 reads
  69.3 to 70.4 with the rule on, then prints, for screen seeds 2, 4, 6, 7, 8:

```
no pulse, screen seed 2, 0 to 255: rule off a rate in 2 of 90 s; rule on 0 (most steps in a window 20)
no pulse, screen seed 4, 0 to 255: rule off a rate in 15 of 90 s; rule on 0 (most steps in a window 21)
no pulse, screen seed 6, 0 to 255: rule off a rate in 6 of 90 s; rule on 0 (most steps in a window 18)
no pulse, screen seed 7, 0 to 255: rule off a rate in 8 of 90 s; rule on 0 (most steps in a window 19)
no pulse, screen seed 8, 0 to 255: rule off a rate in 16 of 90 s; rule on 0 (most steps in a window 17)
```

  and the same five lines at 0 to 1. On e3e44c3 without the patch the switch does not exist, so "on" equals "off".

**Measured in an app that runs the same rule (contributor-side, generated faces).** 134 screen variants with no
pulse: a rate on 70 without the rule, on 9 with it. The same 134 with a 70 bpm pulse: wrong seconds on 6 without the
rule, on none with it; read at all on 44. The rule's thresholds were checked there against recorded captures with a
reference pulse, which it left unchanged; those captures are private and are not evidence for this PR.

**Costs and limits**

- **Still missed:** slow screens (steps 1 to 3 s apart) and shallow ones (5%) make too few steps in 16 s. They are
  the 9 of 134 above. Lowering the step count to catch them was not tried against real captures.
- **A real pulse under a changing screen is withheld, not read.** That is by design: the rule only withholds. It
  removes the wrong seconds; it does not recover the right ones.
- **A bug found and fixed before this proposal.** The first version discarded regions darker than 30, a 0 to 255
  floor. The session sends its skin-masked region mean as 0 to 1, so every frame was below 30 and the rule never
  fired in a live session while its 0 to 255 tests passed. The floor is now 30 of 765 of full scale with the scale
  read from the values (at most 3 is read as 0 to 1), and a test feeds 0 to 1 rows.
- One more rule, switch and two state fields kept forever.
