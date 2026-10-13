# Pulse check: how it would be split into reviewable PRs

Written 2026-10-13. A plan only: nothing is cut, opened or pushed to Elata. Measured nothing new; every number is
copied from the pulse check case (`case.md` in this folder) or the misses analysis, with its label. [synthetic] means
generated input anyone can rerun. [owner] means one person's own 50 recordings, each with one typed reference value,
the same recordings the check's constants were tuned on (in-sample).

## Bottom line

The pulse check is about 2,000 lines in two files (`pulseCheckCore.ts`, `pulseCheck.ts`) on the test build
(`release/test-1`, test.20) over Elata main 49fdb41, plus session and runner wiring and 14 test files. It splits into
five code PRs and one issue. The first code PR fixes the issue on its own (a heart rate shown with no pulse in view);
each later one adds one rule with its own test and its own known answer. A reviewer can review each on its own; they
are released together (see the catch below).

## The order

| step | what | about how big | its own test (red without it) | its own evidence |
|---|---|---|---|---|
| 0 | **Issue**: with no pulse in view, `getMetrics().bpm` still shows a rate, and no field says it is invented | no code; a 35-line reproduction | none | [synthetic] a face with no pulse gets a number in 44 of 60 s on 0.14.0 and main; `confidence`, `signal_quality` and `canPublish` do not separate pulse from no pulse |
| 1 | **The estimator.** Resample the three face regions, POS, detrend, spectrum, one rate per region with its signal-to-noise (`estimateOwnPulse`). Internal, no API, nothing calls it yet | about 600 lines | known answers per function: a sine at a known rate is read back; POS cancels a brightness change and keeps a blood-coloured one | [synthetic] only; changes no output |
| 2 | **The verdict and the switch.** The streak rule (regions agree within 6 bpm, 8 windows of 16 s, mean above -3 dB), the strong and dark paths, the hold, the follower that shows the newest 8 s line; `PulseCheck` without any light or head rule; `pulseCheck?: boolean` on the session, default off; with it on, `bpm` is the proven rate or null, HRV and breathing null; README section; changeset (minor) | about 700 lines | the session test of case.md 3.5a: check on, no pulse, null for 60 s; a true 72 shown by 25 s within 1 bpm; no face mesh, never shown. Breaking the session's `bpm` line turns 3 of 4 red | [synthetic] no pulse: none in 74 s (0.14.0: 73 of 74); a true 72, 50 and 120 right from 18 to 22 s, the same over three seeds. [owner] step 2 alone is not measured yet; the closest measured is the older branch's check, which has no light or head rules: 773 right, 127 wrong of 900 shown (14.1%) |
| 3 | **Wall rules.** Read a patch of wall beside the face (`averageRgbInROINonSkin`, `WallTracker`) and withhold a rate the wall also carries (`wallBandEdge`, `lightFamily`, `lightTaint`, `darkWall`) | about 350 lines plus the runner's wall patch | `pulseCheckWall`, `pulseCheckDarkWall`, `pulseCheckLightEvidence`, with the two recorded wall scenes (mains flicker at 9 fps, a screen at 90 over a pulse of 70) | [synthetic] a light at 72 on face and wall shows nothing; a pulse of 70 under a light at 96 shows 70 |
| 4 | **Face flicker rule.** With no wall in view, withhold a rate the face carries far more in brightness than in colour (ratio 7) | about 80 lines | `pulseCheckFaceFlicker`: a 2% lamp at 90 with no pulse is shown in 40 of 60 s at ratio 10, none at 7 | [synthetic] lamp sweep: a lamp at colour part 0.1 shown in 35 to 40 of 60 s at 10, never at 7. [owner] cost check only: 650 right and 127 wrong at both, so 0 right seconds lost. Limit, stated: lamps at colour part 0.15 or more still pass |
| 5 | **Head rule.** Head centre from the face mesh; withhold a rate the head's own movement carries (`headMotion`) | about 250 lines plus the runner's head centre | `pulseCheckHead` with the two recorded nod scenes | [synthetic] a nod at 60 with no pulse shows nothing; a pulse of 70 under a nod at 90 shows 70 |

Each step carries its own changeset, keeps the switch off by default, and is cut from Elata main with nothing else
from the test build in it. Steps 3 to 5 each add their name to `pulseCheckRules`, so a reviewer can turn any one off
in a test.

**Left out of every step:** the agreement path (`pulseCheckAgreement`, unvalidated); `earlyPulse` and `beatRate`
(about 130 lines in the core that nothing on test.20 calls); the four dim-light candidate rules (off, waiting for the
strap study); every other fix and switch of the test build; the older branch's four speed commits.

**The catch, from the audit.** The light and head known answers (case.md 3.2: a light at 72 on face and wall, a nod
at 60, both with no pulse) pass only with the rules of steps 3 and 5 in. Step 2 alone is expected to show a rate for
them; that has not been measured on a step-2 tree. So the split is for review, not for release: steps 2 to 5 are
reviewed as separate PRs, stacked, and released together, and step 2's own text says which scenes it does not yet
cover. Each step's PR reruns all six scenes and states which pass. Two smaller asks from the same audit row ride
along: the `pulseCheckRules` switches documented as test-only, and the recorded scenes (504 KB of JSON) generated by
a script instead.

**Why this order.** Step 2 is the smallest change that fixes the issue, so it comes first among the behaviour
changes and carries the main evidence. The rules come after it, cheapest to review first. Each rule removes numbers,
never adds them, so a later step cannot make an earlier step's known answers wrong except by withholding; each step's
PR reruns the earlier known answers to show it does not.

## The four objections a maintainer will raise

**1. Over the same seconds it shows fewer right numbers than 0.14.0: 650 against 848 [owner].**
Evidence exists, and it cuts both ways.
- Fewer right numbers, by design: it removes wrong ones. On the same 6,457 seconds, 0.14.0 showed 5,878 numbers and
  85.6 of every 100 were wrong (more than 5 bpm off). The check showed 777 and 16.3 of every 100 were wrong (good is
  close to 0). It had fewer wrong seconds than 0.14.0 in all 50 recordings.
- The right numbers are the check's own, not a filter on 0.14.0's: showing 0.14.0's rate only while the check passes
  gives 112 right and 577 wrong.
- What evidence does NOT support: the light and head rules (steps 3 to 5) cost right seconds here and removed no
  wrong ones. The older check without them gave 773 right, 127 wrong. On these recordings those rules buy nothing;
  their whole case is the synthetic lamp and nod scenes. That is why they are separate steps.
- Open: whether 16.3 is the right price is a product call. The 10 in 100 bar set in advance failed.

**2. It shows no number at all in 10 of 50 recordings [owner].**
Partly explained, mostly open.
- What exists: the check withholds when the regions do not agree above the noise, and the dim recordings are where
  it struggles (where it does show, 31.8 of every 100 dim seconds are wrong against 10.4 in the rest, split by the
  light word in the file name, after looking).
- What does not exist: no analysis yet says why each of the 10 got nothing (light, frame rate, rate below 58 bpm,
  face mesh). That is a description run on the existing rows, to be pre-registered before it is run.
- Open: whether "nothing" is better than "a number wrong 86 times in 100" for those 10 is a product call. The
  project's own rule is show less, never invent.

**3. The median wait for a first number is 48.6 s [owner], against 1 to 3 s on 0.14.0.**
Partly explained.
- What exists: on clean generated faces the first number comes at 18 to 22 s in Node and 23.6 to 28.5 s in a real
  browser [synthetic]. That floor is structural: a 16 s window plus 8 agreeing one-second evaluations. In dim light the
  check takes the dark path, which needs 16 windows, not 8, so it is slower there by construction.
- When it does show, the first number was right in 34 of 40 recordings (0.14.0: 9 of 50).
- What does not exist: how much of the gap from about 20 s to 48.6 s is dim light, low frame rate, or movement. Not
  measured. The older branch's speed commits were withdrawn because they changed defaults.
- Open: a faster first number without more wrong ones. No candidate is measured.

**4. Size: about 2,000 lines in one change.**
Answered by this plan: five code PRs of about 80 to 700 lines each, each with its own test and evidence, plus about
150 lines left out entirely. Still true: about 22 KB gzipped once all five land, imported by the session whether the
switch is on or off (a lazy import is a possible follow-up, not measured).

## What has to happen before step 2 is opened

1. Cut step 2 from Elata main and rerun case.md 3.1 and 3.5a on it (the numbers above are from the test build's tree).
2. Outside review of the method (step 4 of the release path).
3. The strap study, scored against the bars fixed in advance in `open-gaps.md`.
4. The owner's decision on whether the recordings may be shared with Elata.
