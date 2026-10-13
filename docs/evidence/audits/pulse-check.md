# Pulse check: change or leave it alone (skeptical maintainer audit)

Group: the pulse check itself ("no number unless a pulse is proven"). Written 2026-10-12, 09:36 to 10:15 UTC, by a
reviewer playing an Elata maintainer looking for reasons not to merge. No branch was changed. Pre-registrations,
scripts and raw outputs: `S/case/pc/` (S = the scratchpad). The proposal outline: `S/pr-text/pulse-check-case.md`.
Labels: [synthetic] anyone can regenerate; [owner] one person's own recordings; [private] recordings that cannot be
shared; every number from them is removed from this public copy (private appendix: ask Andreas Melhede).

## Bottom line

1. **The problem is real and now reproducible in about 35 lines.** On published 0.14.0 and on Elata main 49fdb41
   (identical, read for read), a face with no pulse gets a heart rate in 44 of 60 seconds (46 to 88) through the
   SDK's own session path [synthetic, R5]; in the longer harness 73 of 74 seconds from 1.3 s (55 to 105) [R2], and the
   same at 15 fps with `confidence` up to 0.96 [R7]. None of 0.14.0's own signals tell: `confidence` 0.30 to 0.82
   with no pulse against 0.44 to 1.00 with one; `signal_quality` up to 1.00 with no pulse; the README's `canPublish`
   gate publishes 73 of 74 no-pulse seconds. HRV (112 to 230 ms) and breathing (6 to 34) are reported every second
   of a video with neither. Elata's own lab logged the same class of failure (elata-perception-lab RQ-37: 78 bpm at
   confidence 0.58 on a still photograph).
2. **The test build's check fixes it on every known answer we have** [synthetic]: no pulse, a lamp, a nod: nothing;
   50, 72, 120 at 30 fps and 50, 72 at 15 fps: right, after 18 to 22 s.
3. **The branch named for this group is not that method.** `feat/pulse-check-on-main` (45c20f0) is the 2026-10-02 port
   of Peak's checker, with no wall, light or head rules: it shows a lamp's 72 and a nod's 60 for 43 of 60 seconds
   each [R3]. It also carries four unrelated speed commits, one of which changes the processor with the check off.
   As it stands: withdraw. The proposal has to be cut fresh from release/test-1's method onto Elata main.
4. **Real-people evidence Elata can check is the weak spot, and one pre-registered rule fired against us.** On the
   owner's 50 recordings (in-sample: the constants were tuned on them), the check was more than 5 bpm from the typed
   reference on 127 of the 777 seconds it showed (16.3%), against 5,030 of 5,878 (85.6%) for 0.14.0 [R4]. The
   pre-registered bar was 10%. Most of the 127 sit in 7 recordings where the reference itself is doubtful (one value
   typed per recording, one taken later), but that cannot be shown without a chest strap. The result on other
   people is [private].

## What was run (each pre-registered, with the time, before it ran)

| Run | Question | Result |
|---|---|---|
| R1 | raw processor, real WASM, colour with no pulse (0.14.0, main) | a number in 7 of 25 s; with a real 72, 6 of 25 s and none right. The pre-registered "worse for the case" line fired (under 13 of 25): this path is broken for another reason (proposal 11), so it is the wrong reproduction for this group. Not used. |
| R2 | session path (drive4 harness, real WASM, 90 s, read once a second, seconds 16 to 89) | table below; no "worse" line fired |
| R3 | the six light and head scenes of the test build's packed check 6 | test build 6 of 6; branch 4 of 6 (lamp 72 and nod 60 shown 43 of 60 s each). "Worse" line not fired. |
| R4 | owner recordings, four arms on the same 6,457 reads | below; "worse" line FIRED (check wrong on 16.3% of shown, bar 10%) |
| R5 | the short reproduction (`repro-session.mjs`, pixel frames, no hook) | 0.14.0 and main: no pulse 44 of 60 s; test build check: 0 of 60; true 72: 42 of 60, all 71 to 72, from 19 s; without a face mesh, 0 of 60 for the true 72 |
| R6 | CPU of the check alone (Node, 120 s at 30 fps) | test build 3.4 ms per second of video (112 us a frame); branch 4.1 ms |
| R7 | R2 at 15 fps | below; no "worse" line fired |
| J | jest | branch: its 3 pulse check suites, 12 of 12 pass; the same files on main: 3 suites fail to compile (module missing, unknown session field), so they are not behaviour tests; test build: 14 suites, 137 of 137 pass |

R2 and R7 [synthetic; `S/case/pc/r2.out`, `r7.out`]: 74 seconds, right within 5 bpm.

| Signal | 0.14.0 = main (same digest) | branch, check on | test build check, every other fix off |
|---|---|---|---|
| no pulse | 73 shown, first 1.3 s | 0 | 0 |
| 72 | 74 right, first 1.6 s | 72 right, first 18.1 s | 72 right, first 18.1 s |
| 50, all three regions | 70 shown: 42 right, 28 wrong | 68 right, first 22.1 s | 68 right, first 22.1 s |
| 120 | 54 shown: 46 right, 8 wrong | 72 right, first 18.1 s | 72 right, first 18.1 s |
| 15 fps, no pulse | 73 shown (41 to 106) | not run | 0 |
| 15 fps, 72 / 50 | 68 right, 6 wrong / 44 right, 30 wrong | not run | 72 right / 68 right |
| branch, check off | no pulse and 72: same digest as main | | |

0.14.0's `confidence` as a gate (same runs): at 0.7 no pulse still shows 6 of 74 s; at 0.83 (the first value that
removes every no-pulse second) the clean 72 keeps 41 of 74 and the 50 keeps 5 of 74.

R4 [owner; in-sample; `S/case/pc/r4.out`, `r4-wrong.txt`]: 50 recordings, 15 to 29 fps, one typed reference each,
reads once a second from 20 s. Self-checks: a noiseless 66 read 67.8 / 65.6 / 65.9 by the three arms; 0.14.0 showed a
number on the pulseless fixture (7 of 10); arm A reproduced fix3real's R2 counts exactly on all 50 recordings; each
check broken once and seen to throw (`brk-*.log`).

| Arm | right | wrong | silent | wrong share of shown | recordings with a number |
|---|---|---|---|---|---|
| A, 0.14.0's path | 848 | 5,030 | 579 | 85.6% | 50 |
| B, test build check | 650 | 127 | 5,680 | 16.3% (10.9% within max(5, 10%)) | 40 |
| C, branch check | 773 | 127 | 5,557 | 14.1% | 41 |
| D, A's rate shown only when B passes | 112 | 577 | 5,768 | 83.7% | 40 |

B had fewer wrong seconds than A in all 50 recordings; A had more right seconds in 34, B in 16. First number right
on 34 of 40 (A: 9 of 50). Median first number 48.6 s. 106 of B's 127 wrong seconds are in 7 recordings; in 4 the
file name says Peak's own reading (same method family, not independent) matched the check, not the reference, and
one reference was taken after the capture.

## Changes in this group

### PC1. The test build's pulse check, proposed opt-in on Elata main (no branch yet; method at release/test-1 c85bc9b)

- **Without it.** Numbers above. Reproduction in the outline section 1; I ran it on 0.14.0 and main: identical.
- **With it.** R2, R3, R5, R7 above. Peak's camera suite with test.19 swapped in passed 47 of 47 plus probes 4 of 4
  and 2 of 2 (NIGHT-2026-10-12, 02:53). Fresh apps in Chromium on test.18 (same method, `pulseCheck*.js` hashes
  700ab679 and 1569ebec from test.15 to test.19, rechecked): a true 70 from 23.6 and 24.7 s, nothing with no pulse.
  R4 above. [private] results removed from this copy. No Elata branch exists, so no
  test yet fails on main and passes on it (J).
- **Cost.** Fewer numbers ([owner] right seconds 848 to 650, 10 of 50 recordings with none). First number 18 to 22 s [synthetic] and a median 48.6 s [owner], against 1 to 3 s. Below 58 bpm the
  forehead must carry the pulse too. Needs a face mesh: with no landmarks every window counts as no evidence and it
  never shows (R5), while Elata's own README quick start uses `faceMesh: "off"`. HRV and breathing null while on.
  71.6 KB unminified, 22.0 KB gzipped, statically imported by the session whether on or off. CPU 3.4 ms per second of
  video for the check itself (R6). A second heart-rate estimator inside the SDK. Off by default, so no app benefits
  without opting in.
- **Objections.**
  - Evidence Elata can check is synthetic plus in-sample owner data, where a pre-registered bar failed: gap.
  - Constants tuned on one person: conceded.
  - Private data behind the strongest numbers: answered by keeping it labelled context only (outline 3.5).
  - Size: about 2,000 lines of source, 13 test files, 504 KB of fixture scenes; no split plan: gap (2026-10-13: a split plan is written, ../proposals/pulse-check/split-plan.md; not cut).
  - Alternatives: answered in outline section 5 (confidence, `canPublish`, `signal_quality`, estimator fixes,
    gate-only, shorter and looser proofs, no rules); the fused SNR one is Peak's, not re-run here.
  - The rules added since the older branch show no benefit on the owner's recordings (123 right seconds lost, wrong
    seconds unchanged): their benefit rests on synthetic scenes and [private] data: gap.
  - Every constant's source: the code says "chosen by measurement" with no data Elata can see; the face flicker ratio
    of 10 is unverified even internally: gap.
  - Interactions: `bpm` never reads the engine (answered, methods packet A.1); text conflicts with fixes 1, 3 and 4 in
    `demoRunner.ts` and `rppgSession.ts` likely, unmeasured: gap.
  - Default on or off, keeping the engine's other estimates beside `bpm`: Elata's call (outline section 7).
  - CI and conventions (changeset, README, Biome, tsc on the re-cut): gap.
- **Verdict:** strong-after-gaps.

### PC2. `feat/pulse-check-on-main` as it stands (45c20f0, 12 commits on 49fdb41)

- **Without it.** As PC1.
- **With it.** The four plain known answers match the test build (R2); two of six light and head scenes fail (R3);
  its own tests pass on it and only fail to compile on main (J).
- **Cost.** Four speed commits: 5f2998b makes the processor analyse at most once per 250 ms of sample time, with the
  check off, not behind an option, plus unrelated formatting churn; 1d83090 and 119143a change the face finder's
  defaults (640 px, at most every 60 ms); de9ce8d adds a Web Worker API. No changeset, no README. R2 reads every
  267 ms so it cannot see 5f2998b (digests equal main's); an app reading every frame would.
- **Objections.** Scope, stale method, defaults moved, speed commits unmeasured here: all conceded.
- **Verdict:** withdraw (replace with PC1).

### PC3. HRV and breathing withheld while the check is on (part of PC1's session change)

- **Without it.** 0.14.0, no pulse and no breathing in the video: `hrv_rmssd` 112 to 230 ms and `respiration_rate`
  6 to 34 in all 74 seconds; with a clean 72, 104 to 143 ms and 15 to 25 [synthetic, R2]. Elata's lab RQ-36: the
  SDK's 193 ms RMSSD is implausible for a still adult.
- **With it.** Both null while on (session tests, green on the branch and the test build).
- **Cost.** An app that opts in loses both, also when they happen to be right.
- **Objections.** Withholding is a product call (Elata's); HRV against a reference is [private] only (gap); a known
  HRV answer through 0.14.0 has not been run (gap).
- **Verdict:** strong-after-gaps.

### PC4. The four speed commits on the branch

- **Without it.** The commit messages report 7 analysed frames a second on a 1280x960 feed and 6 on a laptop
  (2026-10-02); no reproduction in any PR text.
- **With it.** Not measured here.
- **Objections.** Not part of the pulse check; change defaults; unmeasured here; in the test build they are separate
  switches with their own evidence.
- **Verdict:** withdraw from this group (each may become its own proposal).

## Gaps

| Change | Gap | Plan | Closable now |
|---|---|---|---|
| PC1 | No branch carries the evaluated method on Elata main | cut a new branch from 49fdb41 with pulseCheck.ts and pulseCheckCore.ts from c85bc9b, `averageRgbInROINonSkin`, the runner and session wiring, opt-in, no agreement path, no other fix; 13 test files; changeset; README with the face mesh rule; Biome, tsc, jest; re-run R2, R3, R5, R7 and the check-off digest on it | no |
| PC1 | No behaviour test fails on main and passes on a branch (J: main fails only to compile) | turn `repro-session.mjs` into a jest test: pixel frames and a mesh through DemoRunner and RppgSession, `bpm` present without the check and null with it, and 72 shown with it; run it against main's and the test build's dists in scratch now (script level already: 44 of 60 against 0 of 60) | yes |
| PC1 | Real-people evidence Elata can check: in-sample, one person, and the pre-registered 10% bar failed (16.3%) | chest-strap study (VALIDATION.md); the testers on test.19; owner decides whether his 50 recordings may be shared; a second judge limited to seconds near each reference's moment, pre-registered before it is run | no |
| PC1 | The rules added since the older branch lose 123 right seconds on the owner's recordings with no fewer wrong ones; their benefit is synthetic or private | say so in the PR; film a real lamp and a real nod (owner) for real-footage evidence | no |
| PC1 | Needs a face mesh, and Elata's quick start turns it off | document in README and PR; consider a diagnostics issue when `pulseCheck` meets `faceMesh: "off"`; whether no mesh should mean "head not checked" is a behaviour change needing its own evidence | yes (text) |
| PC1 | Constants without a source Elata can see; face flicker ratio 10 unverified | a constants table in the PR text with [synthetic], [owner], [private] labels (methods packet 3.8); a synthetic sweep placing 10 between a blood pulse (ratio near 3) and a brightness flicker | yes |
| PC1 | Synthetic answers are one face, one seed per cell | add a seed to drive4 and re-run R2 and R7 with 3 seeds | yes |
| PC1 | Text conflicts with fixes 1, 3, 4 unmeasured | merge the re-cut onto a scratch copy of wip/all-fixes | no |
| PC1 | PR size, no split plan (2026-10-13: written, ../proposals/pulse-check/split-plan.md: reviewed as five stacked PRs, released together, because of R3); `pulseCheckRules` test knobs in the public API | decide with the owner: one PR (rules cannot be split from the check without reopening R3), knobs kept internal or documented as test-only; fixture scenes generated by a script instead of 504 KB of JSON | no |
| PC1 | Outside review and other testers pending (release path steps 3 and 4) | The outside reviewer has the methods packet; publish test.19 for testers on the owner's word | no |
| PC3 | No known-answer HRV run through 0.14.0; reference-based HRV evidence is private | one synthetic pulse with known beat-to-beat variation through 0.14.0's session path, RMSSD against the known value; cite RQ-36 | yes |
| PC2, PC4 | The branch carries unrelated default changes | withdraw from this group; each speed change needs its own reproduction and evidence | no |

## Closed

Written 2026-10-12, 12:15 to 13:30 UTC. No fix branch exists for this group (the re-cut is not closable now), so nothing
was committed or pushed; release/test-1 was not changed (its tree was used for a test run and restored, `git status`
clean at c85bc9b). Pre-registration: `S/case/pc/prereg-R8-R11.md` (12:17:01Z, R9d and R12 appended before their runs).
The outline `S/pr-text/pulse-check-case.md` was updated (copy of the earlier text: `S/case/pc/pulse-check-case.before-gaps.md`).

| Gap | What was done | Result | Outcome |
|---|---|---|---|
| PC1: no behaviour test red on main, green on a branch | `S/case/pc/r11/pulseCheckNoPulse.test.ts`: pixel frames and a mesh through DemoRunner and RppgSession, engine stubbed at 82 | test build tree 4 of 4 pass (41 s); session `bpm` line broken on purpose: 3 of 4 fail; Elata main: does not compile (TS2307 no `../pulseCheck`, TS2345 unknown session field). Red on main can only be "the module is missing" for a new module; the behavioural red is the revert-red plus the real-WASM reproduction (44 of 60) | partly: test written and proven, lands on the re-cut |
| PC1: one seed per synthetic cell | `bin/drive5.mjs` (drive4 plus `SEED`; default reproduces drive4's digest exactly), R2 and R7 cells at seeds 2 and 3, `out8/` | check identical in every cell and seed (no pulse 0; 72, 120: 72 right from 18.1 s; 50: 68 right from 22.1 s; 15 fps same). 0.14.0: no pulse 61 to 73 of 74 shown; 50 at 30 fps right 42, 35, 0. No "worse" line fired | closed-for |
| PC1: face flicker ratio 10 unverified | R9 (ratio on synthetic mixes and owner recordings), R9b and R9c (which rule withholds what), R9d (ratio 3, 5, 7, 10, 20 in dist copies); self-checks broken and seen to throw (`brk9-*.log`) | blood pulse 2.8 to 3.2 synthetic, but owner real pulses median 1.3, p99 8.5, max 14.4; pure brightness never shown even with the rule off (POS removes it); a lamp whose colour part is 0.1 of its brightness is shown at 10 (35 to 40 of 60 s at 89 to 91) and caught at 7, with owner right/wrong 650/127 unchanged at 7. Pre-registered "worse for keeping 10" FIRED. Lamps with colour part 0.15 or more are shown at 10 and 7 with or without the rule when no wall is visible | closed-against: 10 is not the measured best; 7 (in test.20 since 585d2dd, set on the synthetic sweep, owner recordings as a cost check only, 0 right seconds lost; no private-data check is needed); face-only light defence stated as a limit |
| PC1: constants without a source Elata can see | constants table in outline section 4a, labels [owner], [synthetic], [private], literature, from methods packet 3.8 with dataset names removed | written | closed (text) |
| PC1: face mesh requirement vs README quick start | already measured (no mesh: 0 of 60 for a true 72); now also a jest case; outline section 4 and the test build README (line 92) say it | | closed (text) |
| PC1: alternative "gate on confidence" only synthetic | R12, owner recordings, R4 arm A reads, thresholds 0.5 to 0.96; self-check reproduces R4 arm A exactly (848/5,030) and was broken once (`brk12.log`) | wrong share rises with the bar: 85.6% none, 97.4% at 0.5, 98.2% at 0.8, 98.8% at 0.9, 3 of 3 wrong at 0.96; right 69 to 0 against the check's 650. Synthetic over three seeds: no-pulse confidence reaches 0.96, at which the clean 50 at 30 fps keeps 0 of 74 | closed-for (the check) |
| PC3: no known-answer HRV run through 0.14.0 | R10, drive5 beat by beat: RMSSD 0, 50, 51.6, 21.7 ms; breathing none, none, 15, 6 | `hrv_rmssd` medians 120, 120, 139, 133 ms, within 25% in 0 of 60 s in every case; breathing within 2 of truth in 22 and 17 of 60 s when present, 15 to 25 reported when absent. "Worse" line not fired | closed-for (HRV and breathing do not pass a known answer) |

Not closable here, unchanged: the re-cut branch and everything that runs on it (R2, R3, R5, R7, check-off digest, per-frame
reads, merge onto wip/all-fixes, changeset, Biome, tsc); real-people evidence Elata can check; real-footage evidence for
the light and head rules; PR size and the test-only rule switches; outside review; PC2 and PC4 stay withdraw.
