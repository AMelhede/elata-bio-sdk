# Methods: the pulse check in the test build

This is the public version of the methods packet written for outside review (step 4 of the release path in
[README.md](README.md)). It describes what the pulse check does, every constant and where it came from, and what has
been measured that anyone can check.

**What was removed, and why.** The full packet also evaluates the check on recordings of many people whose licence
does not allow us to publish them or any number derived from them. Every such number, and the name of the
collection, is removed here. A private appendix holds the full evaluation (design, held-out selection, judge,
results, clustering, wrong readings and the recompute script). Ask Andreas Melhede for it.

Labels on every measured number:

- **[synthetic]**: a generated signal or video with a known answer. Anyone can regenerate it with the named script.
- **[owner]**: private, owner recordings. One person's own webcam captures (50 with a reference rate: one value per
  recording, typed into its file name, 14 from an optical ring and 36 marked "ref"), 15 to 29 frames a second.
  Colour time series only, no video. The constants were tuned on these, so every [owner] number is in-sample.
- **[literature]** or **[physics]**: a published value or a derivation, with its source.

Source of the method: `packages/rppg-web/src/pulseCheckCore.ts` (estimator and verdict) and `src/pulseCheck.ts`
(class, light and head rules, shown rate) on `release/test-1` (0.15.0-test.19). The built `dist/pulseCheck.js` and
`dist/pulseCheckCore.js` are byte-identical from test.15 to test.19 (sha256 prefixes 700ab679 and 1569ebec).

---

## 0. The check in one paragraph

Published `@elata-biosciences/rppg-web` 0.14.0 reports a heart rate whether or not a pulse is in the signal, and
none of its own outputs (`confidence`, `signal_quality`, the README's `canPublish` gate) can tell the two apart. The
pulse check reports a heart rate only while the forehead and both cheeks agree on one spectral line, above a noise
bar, across consecutive one-second evaluations of a 16 s window, and while light and head-movement rules do not
attribute that line to something other than blood. Otherwise it reports nothing. It trades right seconds for far
fewer wrong ones; it does not add right ones.

## 1. Questions for the reviewer

1. **Judging.** Our judge compares the first number shown with the reference over the 16 s before it; right means
   within max(5 bpm, 10% of truth). Stricter judges (8 s before, centred) were also computed. Is the 16 s judge
   defensible for a live display, or should a stricter one lead?
2. **Independence.** The constants were tuned on one person's recordings ([owner]), and checked on private
   development data. The held-out evaluation (private appendix) used people disjoint from every tuning list, from
   the same collection. Is held-out-person validation from one collection enough, or is external validation needed
   before any claim?
3. **Intervals.** Recordings cluster by person (two per person in the private evaluation). What would you use: a
   GEE or random-intercept model, an exact cluster method, or reporting at the person level only?
4. **Coverage.** Accuracy is conditional on the check choosing to show a number, and it shows one less often at high
   heart rates. Is "right when shown" plus overall coverage honest, or should this be a risk-coverage curve,
   stratified by rate?
5. **Trust.** What would you need before trusting it? Our own list is in section 7.
6. With the check on, the engine's own estimates still sit beside `bpm` in the same `getMetrics()` object, called
   diagnostics in the README. Safe enough, or should the session drop them while the check is on?
7. The 58 bpm three-region rule costs every low resting rate whose forehead cannot be read, on evidence from one
   person. Keep it, loosen it, or test it on more people first?

## 2. The problem in 0.14.0, measured

- **A number with no pulse.** A face with no pulse through the SDK's own session path (DemoRunner, the fuser,
  RppgProcessor, RppgSession) with the real WASM core gets a heart rate in 44 of 60 seconds
  [synthetic; `proposals/pulse-check/no-pulse-session.mjs`]. A longer harness: 73 of 74 seconds from 1.3 s.
- **Its own signals do not tell.** `confidence` 0.30 to 0.82 with no pulse against 0.44 to 1.00 with one;
  `signal_quality` up to 1.00 with no pulse; `canPublish` publishes 73 of 74 no-pulse seconds [synthetic].
- **HRV and breathing with neither present.** RMSSD medians of 120 to 139 ms for true values of 0 to 51.6 ms
  (within 25% in 0 of 60 s); breathing of 15 to 25 a minute when there is none [synthetic].
- **On one person's recordings** [owner]: read once a second from 20 s, 0.14.0 was more than 5 bpm off the typed
  reference on 5,030 of 5,878 seconds it showed (85.6% of shown seconds wrong; good is close to 0).
- **Known mechanisms**, each with its own proposal in this folder: with no face it reads a square in the middle of
  the frame (fix 1); the core's colour projection adds where CHROM subtracts (fix 2); the fuser assumes 30 fps
  (fix 3); the fuser's CHROM carries an offset that turns into noise (fix 4); a rule doubles resting rates (fix 5);
  the core's harmonic picker reads a clean 72 as 48 (issue 1). The pulse check does not depend on any of these: the
  rate it shows is its own.

## 3. The method

### 3.1 Inputs, per camera frame

- Mean R, G, B of three skin regions (forehead, left cheek, right cheek) placed from MediaPipe's face mesh by the
  SDK's own region sampler, skin-masked.
- Mean R, G, B of a wall patch beside the face: cheek height, a quarter of the face's width, at 0.15, 0.4, 0.7 or
  1.0 face widths from the face edge (the first patch that is mostly non-skin), only pixels that do not look like
  skin; rescaled at a patch change so the signal does not step (`WallTracker`, `WALL_GAPS`).
- The head: centre of nine bone landmarks, and the cheekbone distance as face width (`headCentre`).

### 3.2 The per-window estimate (every 1 s, over the last 16 s)

1. Resample each channel to 20 Hz (linear). The window is refused if it starts or ends more than 1 s from its edges,
   or the delivered rate is under 6 fps.
2. Per region, POS (Wang et al. 2017; 1.6 s sliding windows, overlap-added).
3. Colour damage = median over regions of (first-difference noise of POS) / (first-difference noise of normalised
   green). If damage is at least 20 **and** the wall was seen through the whole window **and** the wall's level over
   the face's level is at least 0.10 at the window's 10th percentile, the pulse is read instead as green minus the
   share of green explained by the wall (least squares on detrended normalised signals).
4. Detrend: subtract a 1.5 s moving mean, applied twice. Hann-windowed DFT up to 4 Hz.
5. Each region's spectrum is normalised to unit power in 0.7 to 3.0 Hz (42 to 180 bpm) and summed. The line is
   chosen on a partly whitened copy (each bin divided by the 0.4th power of the median of the bins within plus or
   minus 0.65 Hz, the 2 nearest bins on each side excluded) with half the second harmonic's power added; the line
   must be a local maximum.
6. SNR (de Haan and Jeanne 2013 form) on the unwhitened combined spectrum: power within 0.1 Hz of the line and of
   twice the line, over the rest of the band.
7. Regions agreeing: those whose own peak is within 6 bpm of the combined line. The reported rate is a
   log-parabolic interpolation around the line's bin (bins are 3.75 bpm wide); every decision uses the bin.

### 3.3 When a window counts as evidence

A window counts only if it has a line and an SNR, and:

- at least 2 regions agree (outside the slowed-camera case);
- if the line is under 58 bpm, all 3 regions agree;
- if the line is under 52 bpm, SNR is at least 0 dB;
- if the delivered rate is 15 to 18 fps (a camera slowed for low light), SNR is at least -2 dB;
- the wall's brightness does not carry the window's rate (rule `lightTaint`);
- if a head has been handed over, the head's movement does not carry the rate and the head was seen across the
  window (rule `headMotion`).

A window that fails the light or head test is entered as a gap, which breaks a streak.

### 3.4 When a pulse is proven

Counting back from the newest window, consecutive counting windows whose bins stay within 6 bpm of the newest:

- **ordinary:** 8 or more windows with mean SNR at least -3 dB; or
- **strong (early stop):** 4 or more windows whose SNR excess over -3 dB sums to at least 12 dB, mean rate at least
  58 bpm; or
- **dark path** (only windows at 15 to 18 fps): 16 or more windows, each at least -7 dB, with at least one region
  agreeing and the 58 bpm rule met, mean SNR at least -4.5 dB, mean regions agreeing at least 1.5;
- **hold:** once proven, the rate stays proven while at least 6 of the last 8 windows still agree with it (mean SNR
  at least -3 dB, or -5.5 dB when every held window came from a slowed camera).

The proven rate is the mean of the windows' interpolated rates.

### 3.5 Withholding rules (judged over the last 4 one-second windows at once)

- **Wall** (`wallBandEdge`, `lightFamily`): the wall's brightness line stands at least 12 dB above its noise and the
  proven rate sits within 6 bpm of 0.5, 1, 1.5, ..., 4 times that wall line, in each of the 4 windows.
- **Face flicker** (`faceFlicker`): at the proven rate, the face's brightness to colour amplitude ratio exceeds 10 in
  each of the 4 windows (a blood-volume pulse sits near 3; de Haan and van Leest 2014). See section 6: 7 measured
  better than 10.
- **Head** (`headMotion`): on either axis the head's movement at the rate stands at least 3.9 dB above its other
  movement and is at least 0.3% of the face's width, in each of the 4 windows. A window needs at least 40 head rows,
  2.5 rows per cycle of the rate, and no gap over 1 s.
- **Face lost:** no face for 1 s, or a frame gap over 1 s, resets everything.

### 3.6 What is shown

While proven and not withheld: the line of the newest 8 s window if it is within 4 bpm of the proven rate, else the
proven rate; after 3 consecutive evaluations in which the 8 s window does not carry it, nothing. HRV and breathing
are always withheld while the check is on.

### 3.7 Which number an app sees

With the check on, `getMetrics().bpm` is the check's own rate while its verdict is "measured", otherwise null, and
HRV and breathing are null (`rppgSession.ts`). The engine's rate becomes `bpm` in exactly two cases:
`pulseCheck: false`, or the opt-in `pulseCheckAgreement: true` (the engine's rate is shown only while the check has
not proven its own, after 8 s in which they agree within 3 bpm at -4 dB or better and 58 bpm or more; the light and
head vetoes still apply). The engine's other estimates (`spectral_bpm`, `fused_bpm`, `confidence`) still travel in
the same object, labelled diagnostics; an app that displays them displays the engine.

### 3.8 Every threshold and where it came from

Source codes: **O** = [owner] sweeps (the comments in the private app's own checker, dated 2026-09-22 to 09-27, from
which the SDK constants were ported); **S** = [synthetic]; **L** = literature or physics; **P** = private
development data (no numbers in this copy; private appendix).

| Threshold | Value | Set on | Evidence |
|---|---|---|---|
| Resample rate | 20 Hz | L | above twice the 3 Hz band edge |
| Band | 0.7 to 3.0 Hz | L | the SDK's own limits |
| Window, streak, SNR bar | 16 s, 8 windows, mean -3 dB | O, S, then P checks | median first verdict 34 s on 25 owner captures; 2 of 125 pulse-free surrogates (pulse band replaced by matched noise) falsely proved, against 42 at 12 s / 6 windows and 18 at 14 s / 6 |
| Regions agree within | 6 bpm | design, P | one bin and a half; 8 bpm refused on P |
| Detrend | 1.5 s | O | 2.0 s: 656 reads, 19 wrong; 1.5 s: 680 reads, 5 wrong; 1.3 s: 599, 4 |
| Harmonic weight | 0.5 | O | 0: 605 of 1,297 captures read; 0.5: 623; 1: 607; 2: 565; 0 wrong at every weight on six truth captures |
| Whitening | plus or minus 0.65 Hz, power 0.4 | O | 971 reads 0 wrong against 937 reads 1 wrong unwhitened; plus or minus 0.4 Hz: 16 wrong; 1.0 Hz: 17 wrong |
| POS window | 1.6 s | L | Wang et al., IEEE TBME 2017 |
| Strong stop | 4 windows, 12 dB excess, rate at least 58 | O, P check | 586 locks 0 wrong; 8 dB: 648, 0 wrong; 4 dB: 724, 13 wrong; 10 dB refused on P |
| Low band | under 58 bpm needs 3 regions | O | no rule: 43 of 171 wrong; under 55: 4 wrong; under 58 or 60: 0 wrong |
| Regions needed | 2 | O | wrong readings 9 to 3, reads 776 to 703; the owner chose this side of the reads-for-wrong curve |
| Band edge | under 52 bpm needs 0 dB | P | found on one held-out batch, decided on a second |
| Slowed camera | 15 to 18 fps needs -2 dB | O | no bar: 43 wrong on 18 truth recordings; -2, -1, 0 dB: 23 each |
| Dark path | 16 windows, -4.5 dB mean, -7 dB floor | O | no recording gained a wrong reading at streaks 12 or 16 |
| Hold | 6 of 8 | O | 4 of 8 drifted the held rate; 6 is the loosest that did not |
| Shown rate support | 8 s window, 4 bpm, 3 misses | P | a 1 to 3 misses sweep refused |
| Colour switch | damage at least 20 | P, O | 25, 30, 40 and off swept; 20 kept. **This path has no on/off switch.** |
| darkWall | wall/face at least 0.10 at the 10th percentile | S, P, O | synthetic screen-light failure at ratio 0.036; owner minimum 0.158 |
| Wall brightness bar | 12 dB | P, S | a 3% synthetic lamp reached +26 to +32 dB; the real-wall margin is P |
| Light family | 0.5 to 4 times, 0.5 steps | S | 120 Hz mains at 11 fps in the browser: wall at 60, face at 180 and 90 |
| Face flicker ratio | 10 | L, S | blood-volume pulse near 3 (de Haan and van Leest 2014); 10 itself had no measurement; see section 6 |
| Head bar, size | 3.9 dB, 0.3% of face width | S | a test pins the bar in the middle of a measured 2.4 to 5.4 dB gap between generated nods and still heads with a pulse |
| Head coverage | 40 rows, 2.5 rows per cycle, 1 s gap | S | thinned no-pulse nods read as pulses at 2.4 to 4 rows a second without the floor |
| Face lost | 1 s | design | one evaluation interval |

The SDK's source comments say only "chosen by measurement on recorded captures against a reference pulse". The
re-cut for Elata should carry this table and a one-line source next to each constant.

## 4. Known-answer and adversarial tests anyone can run

| Test | What it shows | Where |
|---|---|---|
| Packed-package known answers | in the packed tarball: a clean colour pulse at 60, 72, 120 reads within 2 bpm; the check shows 72 for a pulse at 72; nothing for no pulse, a light on face and wall, or a nod at 60 (which shows 60 with `headMotion` off, proving the scene tests the rule); 70 under a nod at 90 and under a light at 96. Each check has a deliberate-break mode | `packages/rppg-web/scripts/verify-test-release.mjs`, checks 4 and 6 |
| Unit tests | 137 cases in `pulseCheck*.test.ts`: proves a real pulse and never proves none; wall at the band edge; light family; face flicker without a wall; nods with sway, mesh dropouts and late mesh; darkWall on both colour scales; under 52 bpm needs 0 dB; 8 s support withdraws | `packages/rppg-web/src/__tests__/pulseCheck*.test.ts` |
| Session reproduction | 0.14.0 a number in 44 of 60 s with no pulse; the check 0 of 60 | `proposals/pulse-check/no-pulse-session.mjs` |
| Known answers through the session [synthetic] | no pulse, a lamp, a nod: nothing. A true 50, 72 or 120 at 30 fps, and 50 or 72 at 15 fps: right, from 18.1 to 22.1 s, the same in every seed | `audits/pulse-check.md` |
| Fresh apps in Chromium [synthetic], test.18 | the README quick start and the generated starter, fake camera playing generated face videos: a true 70 first shown at 23.6 and 24.7 s, every number 68 to 72; no pulse, nothing in 120 s. 0.14.0: a number within 3 s on every video, the no-pulse one included, numbers from 43 to 174 | `test-build/` and `audits/pulse-check.md` |
| Lamp study [synthetic] | a 3% lamp at 72: 27 of 45 s shown without the wall rule, 0 with it | private bench notes; reproduction not yet packaged (open-gaps.md) |

What these cannot show: the synthetic scenes are rendered faces with modelled light. No real flickering lamp and no
real head nod has been filmed for a test (open-gaps.md).

## 5. One person's recordings [owner, in-sample]

50 recordings, read once a second from 20 s, 6,457 reads, the same reads for every arm. Right within 5 bpm of the
typed reference.

| Arm | right | wrong | wrong share of shown (good is near 0) |
|---|---|---|---|
| 0.14.0 | 848 | 5,030 | 85.6% |
| test build with the check | 650 | 127 | 16.3% |

- The bar written down before this run was 10% wrong of shown. **It failed** (16.3%). Most of the 127 sit in 7
  recordings where the typed reference itself is doubtful (one value per recording, one typed later); that cannot be
  shown without a chest strap.
- 10 of the 50 recordings got no number from the check. First number at a median of 48.6 s.
- Gating 0.14.0's own `confidence` instead makes it worse: the wrong share of shown seconds rises with the bar, to
  97.4% at 0.5 and 98.8% at 0.9.
- Showing the engine's rate whenever the check passes: right 112, wrong 577, against the check's own 650 and 127.

## 6. The face flicker ratio, measured

The ratio is the brightness part over the colour part of the face's rhythm at the proven rate. A synthetic blood
pulse reads 2.8 to 3.2, as the code comment says (sqrt(0.885 / 0.098) = 3.0). A pure brightness flicker is never
shown even with the rule off (POS removes it), so the rule matters only for a light that also changes colour
slightly. On the owner's real pulses the ratio was not near 3: median 1.3, 99th percentile 8.5, above 10 in 4 of 777
shown seconds.

| Ratio | lamp with colour part L = 0.05 / 0.1 / 0.15 / 0.2 / 0.3: seconds shown of 60, 3 seeds [synthetic] | owner right / wrong [owner] |
|---|---|---|
| 3 | 0 / 0 / 0 / 0 / 0 | 610 / 119 |
| 5 | 0 / 0 / 0 / 31 to 36 / 42 | 641 / 126 |
| 7 | 0 / 0 / 42 / 42 / 42 | 650 / 127 |
| 10 (test build) | 0 / 35 to 40 / 42 / 42 / 42 | 650 / 127 |
| 20 | 40 to 42 / 42 / 42 / 42 / 42 | 650 / 127 |

So 7 catches the L = 0.1 lamp that 10 misses, at no cost on the owner's recordings. The rule written before the
measurement ("worse for keeping 10") fired. Recommendation: 7, after a check on private development data.
With no wall in view, lamps with a colour part of 0.15 or more still get through at 7.

## 7. Limitations, and what would change our mind

Limitations:

1. Every real-person number Elata can check comes from one person, one webcam, one typed reference per recording,
   and those recordings are the ones the constants were tuned on.
2. The evaluation on other people is private (licence), from one collection, one front camera, a narrow age range,
   no skin-tone labels. No claim about darker skin can be made.
3. The truth in the private evaluation is a finger sensor through our own beat detector, not an ECG or chest strap.
4. Coverage is lower at high heart rates and after exercise.
5. The constants have no shareable real-footage test for lamps and nods.
6. Pre-registration is self-attested (dated files written before each run), with no fixed total sample size.

We would treat the check as not supported if any of these happened:

- Against a chest strap in real use: mean absolute percentage error over 10%, or absolute bias over 5 bpm, or first
  readings right under 90%.
- On a stricter judge chosen by the reviewer, first-reading accuracy below what a constant guess gets on the same
  readings.
- Coverage collapsing on another camera or population.

Next steps, by the release path: testers use the test build in live apps; the chest-strap study (Polar H10 or
equivalent, at least 30 paired readings across at least 10 people, people matter more than readings per person);
more people including darker skin, recorded with a skin-tone measure; then the re-cut proposal to Elata.

## 8. Discrepancies found while preparing this

- The README says every rule has its own switch; the colour swap to green minus the wall has none (only `darkWall`
  restricts it).
- `OWN_PULSE_COLOUR_DAMAGE = 50` and `OWN_PULSE_TRACK_S = 12` are exported but used by no decision.
- `detrend()` defaults to 2 s while every decision path passes 1.5 s; the one caller relying on the default
  (`peakAndSnr`) is called by nothing outside tests.
- The `wallCarries` docstring reads as "the wall line near a multiple of the rate"; the code tests the rate near a
  multiple of the wall line. Section 3.5 follows the code.

## 9. Related findings outside the check

- **CHROM against POS in the fuser.** The 0.14.0 fuser's CHROM divides each channel by its mean without subtracting
  1, so X and Y each sit near 1 and alpha's sample-to-sample wobble lands in the output as broadband noise.
  [synthetic] With noise of 0.05 grey levels on each region's mean colour, CHROM at the true frame rate read 66, 54,
  69 for a true 66 at 15, 24 and 30 fps; POS read 66, 66, 66. [owner] Share of 8 s windows within 5 bpm, main's own
  window analysis: main 11.0%, fix 3 alone 12.8%, fix 4 alone 30.0%, fixes 3 and 4 29.9%. See proposals 03 and 04.
- **The raw processor's colour path.** Colour goes through `ChromPulseModel` with the offset above, and while that
  model returns about 0 (its first nine samples) the processor stores raw green (about 120) beside pulse values of
  about 0.01. [synthetic] Share of seconds within 5 bpm at 30 fps, true 50 / 72 / 120: as shipped 13 / 10 / 29%,
  with POS and no raw-green step 100 / 100 / 100%. [owner] as shipped 1,414 of 6,679 seconds (21.2%), with the
  `rgbPulse` fix 2,002 (30.0%), 33 recordings better and 13 worse. The switch is off by default in the test build:
  with no pulse it shows a number in 72% of seconds against 19% shipped [synthetic]. See proposal 11.
- **test.19 against test.18.** The method is byte-identical. 48 paired runs through the session path gave identical
  per-second reads; the only difference is a runner diagnostic away from 30 fps. See `test-build/test19-audit.md`.
