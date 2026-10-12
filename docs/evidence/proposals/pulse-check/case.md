# Proposal outline: an opt-in pulse check for rppg-web (`pulseCheck: true`)

Status: OUTLINE, not a PR text yet. Written 2026-10-12 by a skeptical review of our own evidence. Nothing has been
opened, pushed to Elata or published. Numbers carry a label: [synthetic] (anyone can regenerate them with the named
script), [owner] (one person's own webcam recordings, colour time series only, shareable only with his consent),
[private] (recordings that cannot be shared; in this public copy every number from them is removed, and the
private appendix holds them: ask Andreas Melhede). Scripts and outputs named below live in our scratchpad
(`case/pc/`), not in any repo.

## 0. In one paragraph

Published `@elata-biosciences/rppg-web` 0.14.0 reports a heart rate whether or not a pulse is in the signal, and none
of its own outputs (`confidence`, `signal_quality`, the README's `canPublish` gate) can tell the two apart. The
proposal adds an opt-in check: with `pulseCheck: true`, `getMetrics().bpm` is a number only while the forehead and
both cheeks agree on one rate, clearly above the noise, over consecutive one-second evaluations of a 16 s window, and
while light and head-movement rules do not attribute that rate to something other than blood; otherwise it is null.
With the option off (the default), nothing changes. The price, measured: fewer numbers, a first number after about
18 to 25 s instead of 1 to 3 s, HRV and breathing withheld while the check is on, and about 22 KB gzipped of code.
The honest limit: on the only real recordings Elata could be given (one person, the same recordings the constants
were tuned on, one typed reference each), the check was still more than 5 bpm off on 16% of the seconds it showed,
against 86% for 0.14.0; its near-zero error rate on many people is private and cannot be offered as evidence.

## 1. The issue (draft text)

**Title:** With no pulse in view, `getMetrics().bpm` still reports a heart rate, and no field says it is invented

**Who hits it.** Every app that shows `bpm`: the README quick start, `createRppgAppAdapter().canPublish` (the README's
recommended UI gate), the generated starter.

**Reproduce (no data, Node 20+, the real WASM core, the SDK's own session path).** `case/pc/repro-session.mjs`
(about 35 lines): a 96 x 96 frame of skin colour with one grey level of noise, forehead and both cheeks as the three
regions and a face mesh spread over the face box, `DemoRunner` then the multi-region fuser then `RppgProcessor` then
`RppgSession`, read once a second for 60 s. On 0.14.0 and on main, identically:

```
published no pulse: bpm each second: - 82 82 82 82 82 77 63 63 63 70 - 63 81 81 - - 70 - - 67 68 - - 60 46 79 77 ...
seconds with a number: 44 of 60
```

The same script with the test build's check (every other fix off): no pulse, 0 of 60; a true 72, 42 of 60, every
one 71 or 72, from 19 s. The longer harness behind the tables below
(`publishaudit/bin19/drive4.mjs`, a module hook that injects region colours) gives, on 0.14.0 and on Elata main
49fdb41 identically (same digest of every read) [synthetic]:

| Signal (truth) | seconds 16 to 89 with a number | right within 5 bpm | first number | `confidence` range |
|---|---|---|---|---|
| no pulse | 73 of 74 (55 to 105) | none can be | 1.3 s | 0.30 to 0.82 |
| pulse 72 | 74 of 74 | 74 | 1.6 s | 0.44 to 1.00 |
| pulse 50 | 70 of 74 | 42 | 1.6 s | 0.29 to 0.87 |

- **`confidence` does not separate them.** A threshold that removes every no-pulse second (0.83) also removes 33 of 74
  seconds of the clean 72 and 69 of 74 of the clean 50. At 0.7, no pulse still shows in 6 of 74 seconds. Over three
  noise seeds and 30 and 15 fps, no-pulse confidence reaches 0.96; at that bar the clean 50 at 30 fps keeps 0 of 74
  seconds [synthetic, `case/pc/out8`]. On one person's real recordings it is worse than useless: the higher the bar,
  the larger the wrong share (0.14.0 wrong on 85.6% of shown seconds with no bar, 97.4% at 0.5, 98.2% at 0.8, 98.8% at
  0.9) [owner, `case/pc/r12.out`].
- **`signal_quality` cannot**: 0.41 to 1.00 with no pulse, 1.00 with a pulse.
- **`canPublish` does not.** The README's gate replayed on the same reads (`case/pc/canpub.mjs`): 73 of 74 seconds
  published with no pulse (55 to 105), 74 of 74 with the 72.
- **HRV and breathing are invented too.** Same no-pulse run, no breathing in the video: `hrv_rmssd` 112 to 230 ms and
  `respiration_rate` 6 to 34 in every second. With a pulse whose beat-to-beat timing is known (`case/pc/bin/drive5.mjs`,
  beats generated one by one, 0.14.0's session path, seconds 30 to 89), the reported HRV does not follow the truth:

  | Known answer | `hrv_rmssd` reported (median, range) | within 25% of truth | `respiration_rate` reported | within 2 of truth |
  |---|---|---|---|---|
  | 72, every beat equal: RMSSD 0, no breathing | 120 (104 to 132) | 0 of 60 s | 21 (15 to 25) | none to find |
  | 72, RR +-25 ms alternating: RMSSD 50, no breathing | 120 (105 to 139) | 0 of 60 | 21 (10 to 23) | none to find |
  | 72, RR +-60 ms at 15 breaths/min: RMSSD 51.6, breathing 15 | 139 (113 to 163) | 0 of 60 | 20 (15 to 22) | 22 of 60 |
  | 72, RR +-60 ms at 6 breaths/min: RMSSD 21.7, breathing 6 | 133 (113 to 140) | 0 of 60 | 16 (6 to 24) | 17 of 60 |

  HRV reads about 120 to 140 ms whatever the truth (0, 22, 50 or 52 ms), so it does not measure beat-to-beat timing on
  this input; breathing is right in about a third of seconds when present and reported when absent.
- **Elata's own lab saw it.** `elata-perception-lab`, RQ-37 (docs/RESEARCH-QUESTIONS.md): the production SDK
  "published 78 bpm at confidence 0.58" on a still photograph, and read about 84 for a known 72 at confidence 1.00.
  RQ-36 in the same file calls the SDK's 193 ms RMSSD implausible for a still adult.

**Why the estimator fixes do not cover this.** Proposals 1 to 13 make the engine's rate right more often; none
makes it know when there is no pulse. Fix 12 (`engineFallback: false`) removes one source of no-pulse numbers but
stays opt-in because it costs right readings. A presence decision is a separate job.

## 2. What the PR would contain

Cut fresh from Elata main, from the test build's method (release/test-1 c85bc9b, byte-identical method since
test.15), not from `feat/pulse-check-on-main` (section 8):

- `src/pulseCheckCore.ts` (pure estimator and verdict, about 1,000 lines) and `src/pulseCheck.ts` (the class, the
  wall tracker, the light and head rules, the shown rate, about 1,000 lines).
- `src/frameSource.ts`: `averageRgbInROINonSkin` (the wall patch reads only non-skin pixels).
- `src/demoRunner.ts`: feed the check each frame's three region means, the wall patch and the head centre; tell it
  when the face is gone. Main already puts `landmarks` on each frame.
- `src/rppgSession.ts`: `pulseCheck?: boolean` (default false), `pulseCheckRules?` (each rule on unless false, for
  testing), `getPulseCheck()`; with the check on, `bpm` is the check's proven rate or null, HRV and breathing null.
- `src/index.ts` exports; README section; a changeset (minor); the unit tests (13 files and 127 cases once the agreement tests are dropped; all 137 of the 14 files pass on the
  test build) and the
  four recorded fixture scenes (504 KB of per-frame colours from generated videos).
- Left out: the agreement path (`pulseCheckAgreement`, unvalidated), every other fix and switch of the test build,
  and the four speed commits on `feat/pulse-check-on-main` (fixed analysis schedule, 640 px analysis, face finder
  every 60 ms, Web Worker), each its own proposal if wanted.

## 3. Evidence a maintainer can re-run

3.1 Known answers through the session path [synthetic; `case/pc/bin/matrix.sh`, drive4 harness, real WASM, 90 s]:
the test build's check on Elata's published routing (every other fix off):

| Signal | 0.14.0 / main | with the check |
|---|---|---|
| no pulse | a number in 73 of 74 s | none in 74 s |
| pulse 72 | 74 of 74 right, from 1.6 s | 72 of 74 right, first at 18.1 s |
| pulse 50 (all three regions) | 70 shown: 42 right, 28 wrong (48 to 73) | 68 of 74 right, first at 22.1 s |
| pulse 120 | 54 shown: 46 right, 8 wrong (84 to 129) | 72 of 74 right, first at 18.1 s |
| at 15 fps: no pulse | 73 of 74 (41 to 106, confidence up to 0.96) | none |
| at 15 fps: 72 / 50 | 68 right, 6 wrong / 44 right, 30 wrong (36 to 115) | 72 right from 18.1 s / 68 right from 22.1 s |

Seconds 16 to 89 of a 90 s run (74), right within 5 bpm. One generated face. Repeated with two more noise seeds
(`case/pc/bin/drive5.mjs`, `SEED=2` and `3`; the default seed reproduces drive4's digest exactly): the check gave the
same counts in every cell (no pulse 0; 72 and 120: 72 right from 18.1 s; 50: 68 right from 22.1 s; same at 15 fps).
0.14.0 varied with the seed but never stopped inventing: no pulse 61 to 73 of 74 seconds shown (54 to 115); the clean
50 at 30 fps right on 42, 35 and 0 of 74; the 120 right on 46, 52 and 35.

3.2 Light and movement known answers [synthetic; `case/pc/r3.mjs`, the scenes of the test build's
`verify-test-release.mjs` check 6, 60 s]: pulse 72 shows 72; no pulse, a light at 72 on face and wall, and a nod at
60 with no pulse show nothing; a pulse of 70 under a nod at 90 and under a light at 96 shows 70. Six of six.

3.3 Brand-new apps in a real browser [synthetic; `night/fresh-app-e2e.md`]: the README quick start in a new Vite app
and the generated starter, Chromium's fake camera playing generated face videos. Check on: a true 70 first shown at
23.6 and 24.7 s, every number 68 to 72; no pulse, nothing in 120 s. 0.14.0: a number within 3 s on every video,
including the no-pulse one (97.3 and 45 first), numbers from 43 to 174.

3.4 One person's real recordings [owner; IN-SAMPLE, the check's constants were swept on these; `case/pc/r4.mjs`,
pre-registered in `case/pc/prereg-R4.md`, self-checks seen to throw when broken]. 50 recordings, 15 to 29 fps, one
reference value per recording written in its file name (14 from an Oura ring, 36 marked "ref"), typed, not followed
over time. Read once a second from 20 s, 6,457 reads, the same reads for every arm. Right within 5 bpm:

| Arm | right | wrong | silent | wrong share of shown | recordings with a number | first number right / wrong |
|---|---|---|---|---|---|---|
| 0.14.0's path (its fuser, its processor, its WASM) | 848 | 5,030 | 579 | 85.6% | 50 | 9 / 41 |
| the test build's check | 650 | 127 | 5,680 | 16.3% | 40 | 34 / 6 |
| 0.14.0's rate, shown only while the check passes | 112 | 577 | 5,768 | 83.7% | 40 | 3 / 37 |
| the older branch's check (no light or head rules) | 773 | 127 | 5,557 | 14.1% | 41 | 36 / 5 |

Within max(5 bpm, 10%): 0.14.0 wrong on 4,674 of 5,878 shown (79.5%), the check on 85 of 777 (10.9%). The check
had fewer wrong seconds in all 50 recordings; 0.14.0 had more right seconds in 34 and the check in 16. On the
pulseless fixture 0.14.0 showed a number in 7 of 10 reads, the check in none.

**The pre-registered "worse for the case" rule fired:** the check is wrong on 10% or more of the seconds it shows,
under both judges. 106 of its 127 wrong seconds sit in 7 recordings. In four of those the file name records that
Peak's own reading agreed with the check rather than the typed reference (Peak's estimator is the same method family,
so that is not independent evidence), and in one the reference was taken later than the capture. A single typed
value per recording cannot tell a check error from a reference error; only the chest-strap study can.

3.5a A unit test a maintainer can run in jest [synthetic; `case/pc/r11/pulseCheckNoPulse.test.ts`, to be added on the
re-cut branch]: pixel frames of a skin-coloured face with forehead and both cheeks, a face mesh, the SDK's own
`DemoRunner` and `RppgSession`; the engine is a stub that always reports 82 (the check's number never reads the
engine, so the stub cannot help the check). Four cases: check off, 82 passes through; check on, no pulse, null for
60 s; check on, a true 72, shown by 25 s and always within 1 bpm; check on, no face mesh, never shown. On the test
build's tree: 4 of 4 pass (41 s). With the session's `bpm` line broken on purpose (the engine's number passed through
instead of the check's): 3 of 4 fail. On Elata main: does not compile (no `pulseCheck` module, no session field), as
for any new module; the behaviour on main is what section 1's reproduction shows with the real WASM.

3.5 Private context, not reproducible by Elata [private]: the check was also evaluated on recordings of other
people that cannot be shared. No number from that evaluation is quoted in this public copy; it is in the private
appendix (ask Andreas Melhede). The full methods packet is under outside review (step 4 of our own release path).

## 4. What it costs (measured)

- **Fewer numbers.** It never adds right seconds; it removes wrong ones. [owner] right seconds 848 to 650, and 10 of 50 recordings got no number. Coverage falls with heart rate and after exercise
  [private].
- **Needs a face mesh.** Frames without landmarks hand the check a null head, so no window counts as evidence and it
  never proves: the 35-line reproduction without landmarks showed nothing for a true 72 in 60 s. Elata's own README
  quick start uses `faceMesh: "off"`. An app that copies it and adds `pulseCheck: true` never sees a number.
- **Later first number:** 18.1 to 22.1 s [synthetic, Node] and 23.6 to 28.5 s [synthetic, browser], against 1.1 to
  2.9 s; on the owner's recordings a median 48.6 s from the start of the capture.
- **A low resting rate needs the forehead too.** Below 58 bpm all three regions must carry the line: a cheeks-only
  50 showed nothing in 120 s in the browser apps; with the forehead it showed from 28 s [synthetic]. The rule rests on
  one person's recordings [owner].
- **HRV and breathing are null while the check is on** (they are invented without it, section 1).
- **Code size:** the two files are 71.6 KB unminified (comments included), 22.0 KB gzipped, against 267 KB / 63.5 KB
  for all of 0.14.0's JavaScript. Imported statically by the session, so present in every bundle that uses
  `createRppgSession`, on or off.
- **CPU:** the check alone, 120 s of frames at 30 fps in Node on this 4-core container: 402 ms, so 3.4 ms per second
  of video (112 microseconds a frame). Not counted: the per-frame read of the wall patch's pixels in the runner.
- **A light on the face with no wall in view is only partly covered.** The face flicker rule withholds a rate the face
  carries far more in brightness than in colour. A lamp whose light changes colour by a tenth or more of its brightness
  change is shown as a pulse whether the rule is on or off (2% lamp at 90, no pulse, no wall: 35 to 42 of 60 s shown at
  89 to 91) [synthetic, `case/pc/r9c.out`]; only the wall rules catch it, and they need a wall beside the face.
- **Off by default:** an app that does not opt in gets none of the benefit.

## 4a. Where each constant comes from

Labels as everywhere in this outline; [private] means the value was swept on development data Elata cannot re-run.
The source comments in the code say only "chosen by measurement on recorded captures"; the re-cut should carry this
table in the PR and a one-line source next to each constant.

| Constant | Value | Source | Evidence |
|---|---|---|---|
| Resample rate | 20 Hz | physics | above twice the 3 Hz band edge |
| Band | 0.7 to 3.0 Hz | the SDK's own limits | |
| Window, streak, SNR bar | 16 s, 8 windows, mean -3 dB | [owner], [synthetic] | 2 of 125 pulse-free surrogates falsely proved at 16 s / 8, against 42 at 12 s / 6 and 18 at 14 s / 6; checks on [private] |
| Regions agree within | 6 bpm | design, [private] | one bin and a half; 8 bpm gave more wrong seconds |
| Detrend | 1.5 s | [owner] | 2.0 s: 680 reads 5 wrong against 656 reads 19 wrong |
| Harmonic weight | 0.5 | [owner] | most reads at no wrong reads across 0, 0.5, 1, 2 |
| Whitening | +-0.65 Hz, power 0.4 | [owner] | 0 wrong of 971 reads; +-0.4 Hz 16 wrong, +-1.0 Hz 17 wrong |
| POS window | 1.6 s | literature | Wang et al., IEEE TBME 2017 |
| Strong stop | 4 windows, 12 dB, rate at least 58 | [owner], [private] check | 0 wrong of 586 locks; 4 dB gave 13 wrong |
| Under 58 bpm needs three regions | 58 | [owner] | no rule: 43 of 171 wrong; under 58: 0 wrong |
| Regions needed | 2 | [owner] | wrong 9 to 3 for reads 776 to 703; an owner preference on that curve |
| Band edge under 52 bpm needs 0 dB | 52 | [private] | found on one held-out batch, decided on a second |
| 15 to 18 fps needs -2 dB | -2 dB | [owner] | 43 wrong to 23 on 18 recordings with a reference |
| Dark path, hold, shown-rate support | see methods packet 3.8 | [owner], [private] | |
| Colour switch | damage at least 20 | [private], [owner] | no on/off switch |
| darkWall | 0.10 | [synthetic], [owner], [private] | synthetic screen-light failure at 0.036; owner minimum 0.158 |
| Wall brightness bar | 12 dB | [private], [synthetic] | a 3% synthetic lamp reached +26 to +32 dB; the real-wall margin is private |
| Light family | 0.5 to 4 times | [synthetic] | mains flicker folded by a slow camera |
| Face flicker ratio | 10 | **not supported** | see below and section 5 |
| Head bar, size | 3.9 dB, 0.3% of face width | [synthetic] | a test pins it inside a measured 2.4 to 5.4 dB gap |

The face flicker ratio, measured this time [synthetic, `case/pc/r9.out`, `r9b.out`, `r9c.out`, `r9d.out`; owner,
in-sample]. The ratio is the brightness part over the colour part of the face's rhythm at the proven rate; for a light
whose colour change is L times its brightness change it is about 1/L. A synthetic blood pulse reads 2.8 to 3.2, as the
code comment says (the physics: sqrt(0.885 / 0.098) = 3.0). But a pure brightness flicker is never shown even with the
rule off (the POS projection removes it), so the rule only matters for a light that also changes colour slightly. On
the owner's real pulses the ratio at the shown rate was not near 3: median 1.3, 90th percentile 4.6, 99th 8.5, maximum
14.4, above 10 in 4 of 777 shown seconds; the rule withheld none of them, because it needs four windows running.

| Ratio | lamp at L = 0.05 / 0.1 / 0.15 / 0.2 / 0.3 shown (s of 60, 3 seeds) | owner right / wrong |
|---|---|---|
| 3 | 0 / 0 / 0 / 0 / 0 | 610 / 119 |
| 5 | 0 / 0 / 0 / 31 to 36 / 42 | 641 / 126 |
| 7 | 0 / 0 / 42 / 42 / 42 | 650 / 127 |
| 10 (test build) | 0 / 35 to 40 / 42 / 42 / 42 | 650 / 127 |
| 20 | 40 to 42 / 42 / 42 / 42 / 42 | 650 / 127 |

So 7 catches the L = 0.1 lamp that 10 misses at no cost on the owner's recordings; 5 catches more at 9 right seconds.
The pre-registered "worse for keeping 10" line fired. Recommendation for the re-cut: 7, after a check on the [private]
development data shows it costs nothing there either; otherwise keep 10 and say it is a guess. Either way the comment
that a pulse "keeps it near 3" holds for synthetic blood, not for this person's real footage.

## 5. Alternatives considered

| Alternative | What it would take | Why it lost (measured) |
|---|---|---|
| Tell apps to gate on `confidence` | docs only | no threshold separates (section 1) [synthetic]; RQ-37: 0.58 on a photograph; on the owner's recordings every bar from 0.5 to 0.96 makes the wrong share worse, 97.4% to 100% of shown seconds, right seconds 69 down to 0 against the check's 650 [owner, `case/pc/r12.out`] |
| `canPublish` | exists | publishes 73 of 74 no-pulse seconds [synthetic] |
| `signal_quality` / capture confidence | exists | computed from skin, motion and clipping, so a still synthetic face scores 1.0 with no pulse; 0.41 to 1.00 here |
| The fuser's in-band SNR | exists | did not separate pulse from no pulse over five repeats each, at any amplitude up to 20 times physiological [synthetic; Peak's camera fixture, written up in Peak's working notes, not re-run here] |
| Fix the estimators (proposals 1 to 13) | in review | right more often, still a number with no pulse (section 1) |
| Gate the engine's rate with the check, show the engine's number | small | [owner] right 112, wrong 577 of the seconds the check passed, against the check's own 650 and 127 |
| A shorter proof (12 s, 6 windows) | constant | falsely proved 42 of 125 pulse-free surrogates, against 2 of 125 at 16 s / 8 [owner] |
| A looser proof (more numbers) | constants | five pre-registered coverage candidates on held-out inputs: each failed its own safety gate or gained little [private] |
| Face flicker ratio 3, 5, 7 or 20 instead of 10 | constant | 7 dominates 10 on everything measured (section 4a); 3 costs 40 right owner seconds; 20 lets an L = 0.05 lamp through |
| No light and head rules (the older branch) | less code | fails 2 of 6 known-answer scenes: shows the lamp's 72 and the nod's 60 for 43 s each [synthetic]. On the owner's recordings (no head positions recorded, so the head rule could not act) everything the test build added since that branch, light rules, the 8 s support rule, the band-edge rule and the colour switch together, cost 123 right seconds and left the wrong seconds at 127 (85 against 90 under the 10% judge) [owner]; their benefit on real footage is shown only privately [private] |

## 6. What does not move

- Default off: the older branch with the check off gave the same digest of every read as main (no pulse and 72); to
  be re-run on the re-cut branch, and with reads on every frame, which the harness does not do. Public types only gain
  optional fields. The engine, the fuser and the processor are untouched; with the check on, `bpm`, `hrv_rmssd`,
  `respiration_rate` and `respiration_confidence` change and every other field passes through.
- The check never reads the engine's rate, so its `bpm` does not depend on proposals 1 to 13. Text conflicts are
  likely where fixes 1, 3 and 4 edit the same `DemoRunner` options, `onFrame` and session options; not measured until
  the re-cut exists.

## 7. Questions for Elata (theirs to decide)

1. Opt-in (recommended, nothing changes for current apps) or on by default (what our test build ships)?
2. With the check on, keep the engine's other estimates in the same `getMetrics()` object as diagnostics, or drop
   them so no app shows an unchecked rate by accident?
3. HRV and breathing withheld while on: acceptable, until each has a check of its own?
4. The 58 bpm three-region rule: keep, or test on more people first?

## 8. What has to happen before this is opened

See `case/pulsecheck-audit.md`, "Gaps". In short: re-cut the branch from the test build's method on Elata main with
nothing else in it; add the session test of section 3.5a (written and run on the test build's tree, not yet on a
branch); settle the face flicker ratio (section 4a); reproduce section 3 on the re-cut branch; outside review of the
method (Morgan Hough, in progress); the test build in Kyle's, Namkhai's and Alexander's apps; and a decision on
whether the owner's recordings may be shared.
