# Runner and fusion group: change vs leave it alone (fixes 1, 3, 4)

Audit written 2026-10-12 as a hostile Elata maintainer would read the three PRs. No branch was changed.
Scripts, logs and the pre-registration (written before each run, with times) are in `case/ra/`
(`prereg.md`). Worktrees under scratch/ra: main 49fdb41, fix/no-face-no-reading 7053302,
fix/real-frame-rate 9f481ed, fix/pos-in-fuser 3ac75aa, wip/all-fixes 32ce8b1, each built with the
package's own tsc build. "0.14.0" means the published package installed in peak-app/node_modules;
every real-engine run uses its WASM core.

## Bottom line

- Fix 4 (POS in the fuser): strongest of the three. Every number in its PR text reproduced exactly on
  main and on 0.14.0, and a new known answer adds to it (heart-rate variability on a steady pulse:
  113 to 179 ms of error on main, 14 to 20 ms on the branch). Gaps are text: two alternatives we know
  tie it are not mentioned, one claim has no committed test, and the PR still points at a branch whose
  first commit names a dataset.
- Fix 1 (no face, no reading): strong, and stronger than its own text says. On 0.14.0 and main a wall
  gets a number every second, and a brief face-finder miss with the face still in view throws the rate
  off for about 15 s (main right in 28 to 36 of the 45 s after; branch 45 of 45). One real code defect
  found: with `requireFace: true` and a processor that has no `resetSignal`, every face frame after a
  1 s gap throws, forever.
- Fix 3 (real frame rate): once fix 4 is in, it does not change the heart rate anyone reads (synthetic
  15 to 60 fps, owner recordings, real engine at 15 fps: no difference). What it does change is the
  fused quality figure at cameras away from 30 fps (its longer warm-up does not delay what an app
  shows). Its PR text still sells it on rate
  tables and on private numbers computed with the test build's estimator, not main's. Reframe or it
  will be refused.

## What was run (all pre-registered in case/ra/prereg.md)

| id | what | where |
|---|---|---|
| R1 | fix4.md repro.mjs, verbatim, on main, 0.14.0, branch | repro-*.mjs |
| R2 | fix4.md e2e.mjs, verbatim, real 0.14.0 WASM, main and branch | e2e-*.txt |
| R3 | fix 3 amplitude and warm-up, test fixture, main, 0.14.0, branch | grid-amp.mjs |
| R4 | rate read above 30 fps, CHROM/POS x grid/no grid, 45 and 60 fps | rate-above.mjs, r4.log |
| R5 | each PR's new tests on main (red?) and on its branch (green?) | scratch/ra/*.log |
| R6 | fix 1 end to end: face, 10 or 30 s of wall, face again; session.getMetrics() once a second | fix1-e2e.mjs, r6.jsonl |
| R7 | fix 3 given fix 4 on the 50 owner recordings (fix 4 alone vs fix 4 + fix 3), main's analyzePulseWindow | r7.mjs, r7-result.txt |
| R8 | fused quality at 15, 45, 60 fps, POS with and without grid | snr15.mjs, r8.log, r8b.log |
| R9 | real engine at 15 fps, POS with and without grid (and R9b, more no-pulse seeds) | e2e15.mjs, r9-summary.txt, r9b.jsonl |
| R10 | R7's full-engine readout for fix 4 alone vs fix 4 + fix 3 | r10-result.txt |
| R11 | fix 1, brief face-finder miss (367, 733 ms) with the face still in view | fix1-miss.mjs, r11.jsonl |
| R12 | fix 4, HRV on a steady 72 bpm pulse (true RMSSD about 0) | hrv-*.mjs, r12.log |
| R13 | fix 3, time to first reading at 15 fps | e2e15b.mjs, r13-summary.txt |
| R14 | fix 1 return on the merged tree, with and without fix 12's opt-in | fix1-e2e-ef.mjs, r14-summary.txt |
| extra | "chrom" bit-identical check, POS/CHROM cost, fix 3 at exactly 30 fps, fix 3 CPU cost, fix 1 duck-typed processor | chromident.mjs, bench.mjs, same30.mjs, cost15.mjs, cost30.mjs, ducktype.mjs |

Offline scorers (rate-above.mjs, r7.mjs) ran their self-checks first: known answer through the scorer,
pulseless fixture gives a rate, window length; each check broken once and seen to throw (brk*.log,
r7-brk-*.log).

## Fix 1: with face tracking on, no face means no reading

**Without the change (0.14.0 and main give identical numbers, read for read).**
- 60 wall frames with no face region: 60 of 60 read from the centre square (wall60.mjs), as claimed.
- End to end with the real engine (R6, true 66 bpm, 3 seeds): a number in 10 of 10 s of a 10 s wall gap
  and 30 of 30 s of a 30 s gap (71 drifting to 80). After the face returns, the first right reading
  comes 35 s (10 s gap) and 45 s (30 s gap) later; wrong numbers in 34 and 44 of the 65 s after.
- Brief miss with the face still in view (R11): the centre square goes through a different push method
  than the fused stream, and the rate jumps (94, 87, 82, then 53 to 63): right in 33 to 36 of the 45 s
  after a 367 ms miss and 28 to 30 after a 733 ms miss. No miss: 45 of 45.
- The PR text gives no script a maintainer can run on 0.14.0. Its test list says "all red on 49fdb41";
  true, but two of the three named files fail there by compile error (TS2339, TS2353), not by the
  quoted numbers (60 of 60, 51). Only sessionNoFace fails by assertion (84, the stub's value).

**With the change (branch 7053302).** 0 of 60 wall frames read (drop reason no_face). R6: a number only
in the first second of the gap (69, the held reading), none after; after the face returns a number in
2 s, right from 2 to 6 s, right in 60 to 61 of 65 s, 3 or 4 wrong numbers just after the return (87,
80, 73). R11: 45 of 45 after both misses (reads 63 to 68). Touched tests on the branch: 6 suites, 118
pass. On wip/all-fixes the group's tests pass (39 of 39).

**Cost.** Default behaviour changes for every face_mesh session without a roi (null after 1 s without a
face). New exported union member `no_face` (exhaustive switches need a case), `requireFace`,
`faceAbsentMs()`, `resetSignal()`. A miss under 1 s leaves a hole in the window instead of a sample
(measured: better than main's behaviour, R11). After a gap of 1 s or more the window restarts, and the
real engine shows a number within 2 s, and with fix 1 alone (CHROM fuser) the first 3 or 4 are wrong
(R6), not the "returns once the window has refilled, within 35 s" that the PR text and the README give
from the stub-engine fixture. On wip/all-fixes (POS in the fuser) the same return reads right from the
first second, 65 of 65 s, no wrong number (R14).

**Objections.**
1. Code defect: `this.processor.resetSignal()` is called unguarded and outside the try, while every other
   processor call in DemoRunner is duck-typed. With `requireFace: true` and a processor without it,
   the first face frame after a 1 s gap throws TypeError out of onFrame, `noFaceSinceMs` is never
   cleared, so every later face frame throws too (60 of 60), nothing is pushed, and onError never
   hears of it (ducktype.mjs; same on wip/all-fixes). Only reachable by passing requireFace yourself
   with a custom processor, since the type says RppgProcessor. GAP, closable (typeof guard plus test).
2. "The reading comes back once the window has refilled" (PR text, README, changeset wording) does not
   hold with the real engine: a number in 2 s, the first 3 or 4 wrong with CHROM in the fuser, right
   from the first second once fix 4 is in (R14). Fix 12's opt-in is not the cause or the cure here
   (R14: 0 wrong numbers with and without it on the merged tree). GAP, text and README.
3. Test evidence wording: say which files fail to compile on main and where the 60 of 60 and 51 come
   from (a script on main; the restart removed on the branch). GAP, text.
4. No runnable reproduction on 0.14.0. GAP, closable: fix1-e2e.mjs and fix1-miss.mjs (trim to a
   fix4-style block) with R6 and R11 numbers.
5. The 1 s hold rests on private captures of still people. CONCEDED as context; R11 shows the
   realistic short miss is handled better by the branch than by main, on synthetic input.
6. Root cause vs workaround: holes scale rates because the window estimates its rate as samples over
   time spanned. Why restart instead of making the estimate gap-proof? Not discussed and not measured.
   GAP, text (a candidate answer, not yet evidence: the engine's own window lives inside WASM, so a
   JS-side estimate fix would not reach it).
7. The PR names `fix/no-face-no-reading` (six commits; the first is not conventional and quotes private
   wall-footage numbers). `pr/no-face-no-reading` (one commit, same tree, parent 49fdb41, right author)
   exists locally, not pushed. GAP, text plus owner decision.
8. Interaction with fix 3 (250 ms grid stall vs 1 s hold): ANSWERED (merge-plan.md; demoRunnerFaceGapGrid
   passes on wip/all-fixes).
9. CI: no step adds a failure main lacks (ci-parity-2026-10-11.md). ANSWERED.

**Verdict: strong after gaps.** The case is better than the text: add R6 and R11.

## Fix 3: resample multi-region fusion input onto the sampleRate grid

**Without the change.** With the test's own fixture (grid-amp.mjs), main and 0.14.0 give the PR's three
numbers exactly: 160 bpm at 15 fps keeps 0.48 of its 30 fps fused amplitude, 72 bpm at 60 fps 0.63,
first fused quality at 6.93 s at 15 fps against 3.47 s at 30 fps. The PR says these reproduce "with the
new test file"; the test asserts only the 15 fps pair, and there is no script for 0.14.0.

**With the change (9f481ed).** 0.94, 1.04, 3.47 s. New test file: 7 of 16 red on main (as claimed), 16
green on the branch (38 with the related suites). At exactly 30 fps the output equals main's to float
rounding (grid times 3.7e-10 ms apart, values 1e-13; same30.mjs), so "nothing else moved" holds there.

**What it changes once fix 4 is in (the only fair comparison, since the PR asks for fix 4 first).**
- Rate read, synthetic: POS with or without the grid reads 60 of 60 windows at 15, 20, 24, 30 fps (PR,
  merged tree) and at 45 and 60 fps (R4, mine, 50 to 150 bpm, 2 noise levels). No difference anywhere.
- Rate read, owner recordings (R7, main's own analyzePulseWindow): fix 4 alone 30.0% of windows right,
  fix 4 + fix 3 29.9% (23 recordings better, 20 worse, p 0.76); under 22 fps 26.0% vs 26.3%.
- Rate shown, real engine at 15 fps (R9): 66 bpm 150 vs 150 of 150 s, 120 bpm 150 vs 149, 150 bpm 140
  vs 145. No pulse: R9 suggested fewer invented numbers with the grid (103 vs 69 of 150 s); five more
  seeds reversed it (93 vs 110). Not a finding.
- R10 (the 0.14.0 engine fed each fused signal, owner recordings, pre-registered bar on right of all
  seconds): fix 4 alone 23.8%, fix 4 + fix 3 25.5% (26 recordings better, 24 worse, p 0.89): no
  measurable difference. Observed, not pre-registered: with the grid the engine shows a number in
  fewer seconds (80.7% vs 86.5%; 38 of 50 recordings less often, p < 0.001; under 22 fps 77.9% vs
  87.4%, 26 of 30) and is right in more of the seconds it shows (31.6% vs 27.5%, p 0.2). Worth a
  pre-registered look; consistent with the quality figure below.
- R13 (time to first reading at 15 fps, real engine): median first right reading 2 s with and
  without the grid at 66 and 120 bpm. The longer fused warm-up does not delay what an app shows.
- Quality figure: at 15 fps a 120 or 150 bpm pulse gets fused quality 3.1 to 4.3 without the grid,
  the same as no pulse (3.0 to 4.2), against 15.1 with it (R8). The `signal_quality` an app reads is
  0.50 to 0.63 without the grid (no pulse 0.48 to 0.66) and 1.00 with it (R9). At 60 fps a 66 bpm pulse
  reads 47 without the grid against 15.1 (my pre-registered guess that it would read as no pulse was
  wrong; it reads three times high). With the grid the same pulse reads 15.1 at 15, 30, 45 and 60 fps.

**Cost.** At 15 fps, `getMetrics()` 57 ms per call without the grid, 142 ms with it; runner 4.0 vs 6.25 ms
per camera second; the same as a 30 fps camera without the grid (6.1 ms, 132 ms), as the PR says (Node
in this container under load; ratios only). +237 lines in demoRunner.ts. On its own, with CHROM, it reads
resting rates worse on 15 to 24 fps synthetic cameras (the PR's own table).

**Objections.**
1. Once fix 4 is in, the PR's rate tables show no gain and the PR never compares against fix 4 alone.
   A maintainer will read the rate tables as the benefit and find none. GAP, text: lead with the quality
   numbers (R8, R9) and the filter response (R3); state plainly that the rate and the time to first
   reading are unchanged once fix 4 is in (R4, R7, R9, R10, R13).
2. The private R1 numbers are labelled "the SDK's own analyzePulseWindow" but were computed with the
   test build's (fix3real/window.mjs imports it from the fork checkout). With main's own (R7):
   main 11.0%, fix 3 alone 12.8%, fix 4 alone 30.0%, both 29.9%; fix 3 alone vs main is +1.7 points,
   26 better, 15 worse, p 0.12 (no measurable difference), not +3.1, p 0.011. GAP, text.
3. First commit f4247d0 on the public fork names a dataset and quotes its numbers; the PR asks for a
   squash of the four-commit branch, but GitHub lists every commit. `pr/real-frame-rate` (one commit,
   same tree) exists locally. GAP, text plus owner decision; the already-public commit stays (CONCEDED:
   no force push).
4. Is a quality figure at slow cameras with fast heart rates worth 237 lines and 2.5 times the
   getMetrics cost on a 15 fps device? GAP: the narrowness is real and should be stated with the
   numbers above; the principled answer (the fuser is a fixed-rate block fed at the wrong rate) stands.
5. Build the fuser at the measured rate instead: ANSWERED in the PR (assumes even spacing at a known rate).
6. Resample inside the fuser: ANSWERED (public contract change), offered as an alternative.
7. Above sampleRate frames are not averaged (up to 3 dB white-noise loss): ANSWERED, and R4 shows no
   rate loss at 45 and 60 fps with POS.
8. demoRunnerFaceGapGrid.test.ts exists only on local wip/all-fixes; the PR asks to add it at update
   time. ANSWERED in merge-plan.md, but a reviewer cannot see it on the branch. Minor GAP.
9. Depends on fix 4: ANSWERED (stated as status).
10. CI: no new failure. ANSWERED.

**Verdict: strong after gaps, as a correctness fix of the fuser's input; weak as a rate fix.** If the
text is not reframed, withdraw it rather than defend rate tables that show nothing once fix 4 lands.

## Fix 4: project fused regions with POS by default

**Without the change.** repro.mjs, verbatim: main and 0.14.0 both print 99, 50, 67, 109, 63 for a true
72, and 72 x5 with the window means removed (exact match). e2e.mjs, verbatim, real engine: 120 bpm right
in 0 of 150 s (no number 39); 72 bpm right in 100 of 300 (no number 59); no pulse, a number in 105 of
150 (42 within 5 of 72). All exactly as the PR. New (R12): on a steady 72 bpm pulse, whose true
beat-to-beat variation is about 0, main reports hrv_rmssd with median 113 to 179 ms per seed.

**With the change (3ac75aa).** repro row 1: 72 x5. e2e: 120 bpm 150 of 150, 72 bpm 300 of 300, no
number 0; no pulse, a number in 78 of 150. R12: median RMSSD 14 to 20 ms. The session test fails all 3
on main by assertion (off by 19.2, 33.6, 12.6 bpm) and the 6 touched suites pass on the branch (64
tests). "chrom" output is bit-identical to main's fuser in 4500 of 4500 frames over 5 seeds with
regions dropping out, a low-skin region and a reset (chromident.mjs; the same check with "pos" differs
in 4410, so it can fail).

**Cost.** The default output of every face_mesh session changes: rate, signal_quality, HRV. Minor bump.
Per-sample cost unchanged (POS 1.06 to 1.24 us, CHROM 1.11 to 1.51 us here). New public surface:
`PosPulseModel`, `FusionProjection`, `fusionProjection` option.

**Objections.**
1. The published CHROM (band-pass before alpha, overlap-add) ties POS on our private sets (numbers in
   the private appendix), and beats it on one of them. The PR's "Considered" lists only the minimal repair (means removed). A maintainer who
   knows CHROM will ask. GAP, text: add it and say why POS (drop-in for the streaming structure, no filter
   state ahead of the projection, Elata's own docs name POS the baseline, ChromPulseModel untouched).
2. This POS is the streaming newest-sample form, not the paper's overlap-add. The private comparison
   says they read the same. GAP, text.
3. The "chrom" bit-identical promise has no committed test. GAP, closable (golden-value test, or the
   script in the PR text).
4. Real-recording evidence is private. CONCEDED as context; the public evidence (synthetic known answers
   and a real-engine script) is enough on its own.
5. First commit a752502 on the public fork names a dataset and quotes its numbers; the PR still says
   "four commits, please squash". `pr/pos-in-fuser` (one commit, same tree) exists locally. GAP, text
   plus owner decision.
6. HRV and breathing are not mentioned though the waveform changes. HRV now measured (better). Breathing
   not measured. GAP.
6b. The brightness claims (bright.mjs, bright2.mjs): 3% at 0.3 Hz reads 84 and 2% at 1.5 Hz reads 156 on
   main, 66 on the branch, as stated. "A 5% swing with sensor noise: a true 50 reads 65, a true 100 reads
   76 or 77" reproduces only with parameters the text leaves out (0.25 Hz and noise 0.1 for 50; 0.4 Hz
   and noise 0.2 for 100, from review-pos-in-fuser/t4.mjs). At 0.3 Hz main reads 68 to 69 and 82 to
   118 instead; the branch reads 50 and 100 in every case. GAP, text: give the parameters.
7. Still a number in 52% of no-pulse seconds: ANSWERED (estimator's job, stated).
8. Default change vs opt-in: ANSWERED in part ("chrom" kept for rollback; Elata's docs plan POS); it
   remains the maintainers' call.
9. Interactions (fix 3 needs it first, fix 11 carries the same PosPulseModel): ANSWERED.
10. CI: no new failure; the real-engine check is a script because CI has no WASM: ANSWERED.

**Verdict: strong after gaps** (all text, plus one small test).

## Gaps

| fix | gap | plan | closable now |
|---|---|---|---|
| 1 | resetSignal called unguarded: a duck-typed processor without it breaks the runner for good after a 1 s gap | `typeof proc.resetSignal === "function"` guard inside the try, test that goes red without it | yes |
| 1 | no runnable reproduction on 0.14.0 | add trimmed fix1-e2e.mjs and fix1-miss.mjs with R6 and R11 numbers | yes |
| 1 | "returns once refilled, within 35 s" (PR text and README) is from a stub engine | replace with R6 and R14 (number in 2 s; 3 to 4 wrong with CHROM, none with fix 4) | yes |
| 1 | test list says red on main but 2 of 3 files only fail to compile | say so, give the script numbers | yes |
| 1 | why restart rather than a gap-proof rate estimate | one paragraph in "considered" | yes |
| 1 | 1 s hold rests on private captures of still people | moving-people captures or a public set | no |
| 1, 3, 4 | PR texts name fix/* branches whose commits are unconventional or name a dataset | open from the pr/* one-commit refs (owner pushes them), rewrite the "Merging" paragraphs | yes (text); push is the owner's |
| 3 | benefit after fix 4 is the quality figure, not rate or time to first reading; no fix-4-alone comparison | reframe with R4, R7, R8, R9, R10, R13 | yes |
| 3 | R10's "shows fewer numbers, right more often when shown" is post hoc | pre-register and re-score on the owner recordings with a held-out split | yes |
| 3 | private R1 numbers labelled as main's estimator but from the test build | relabel, add main-estimator numbers (+1.7, p 0.12) | yes |
| 3 | amplitude and warm-up numbers not runnable on 0.14.0; 60 fps not in the test | add grid-amp.mjs as a block | yes |
| 3 | cost not quantified | add 57 vs 142 ms getMetrics at 15 fps, equal to 30 fps without grid | yes |
| 3 | no test pins quality across frame rates | test: same pulse, fused quality at 15 fps within 10% of 30 fps (red on main) | yes |
| 3 | demoRunnerFaceGapGrid only on local wip | name it in the PR body with its red/green | yes |
| 4 | published CHROM and overlap-add POS not discussed | add both with labelled private numbers | yes |
| 4 | "chrom" bit-identical has no committed test | golden-value test or chromident.mjs block | yes |
| 4 | HRV effect unstated; breathing unmeasured | add R12; build a breathing-modulated known answer | HRV yes, breathing no |
| 4 | 5% brightness claim omits its swing frequencies and noise | state 0.25 Hz / 0.1 and 0.4 Hz / 0.2, or quote the 0.3 Hz numbers | yes |

## Closed

Work of 2026-10-12, 11:46 to about 14:30 UTC. Pre-registrations with times, every result and every script are in
`case/rc/` (`prereg.md` first). Branch changes are new commits on top, pushed fast-forward to the fork after each
branch's full rppg-web jest run passed; `pr/*` one-commit refs regenerated (same tree, parent 49fdb41, author Andreas
Melhede, local only); all three re-merged into a scratch copy of `wip/all-fixes` (detached at scratch/rc/merge, tip
9bc8d38): no conflicts, rppg-web jest 57 suites / 467 tests, `tsc` (both configs) and Biome lint clean.
`wip/all-fixes` itself, `release/test-1` and Elata were not touched; nothing opened or published.

| fix | gap | what was done | result | outcome |
|---|---|---|---|---|
| 1 | `resetSignal()` unguarded | test first (red on 7053302: TypeError), then a `typeof` check like every other processor call; a199fc0 | ducktype.mjs: face frames that throw after the return 60 of 60 before, 0 of 60 after; 46 suites / 370 tests | closed for |
| 1 | no runnable reproduction on 0.14.0 | `face-gap.mjs` (about 45 lines, `npm pack` 0.14.0 for the WASM), run exactly as the PR text says from the branch's repo root | 0.14.0: a number in 10 of 10 and 30 of 30 s of the gap, after it right 31 / 21 to 22 of 65 (first right 35 / 44 to 45 s); misses 367 / 733 ms right 34 to 37 / 29 to 31 of 45. Branch: 1 s hold only, 61 of 65 (3 wrong), misses 45 of 45. main dist prints the same as 0.14.0. In fix1.md | closed for |
| 1 | "returns once refilled, within 35 s" from a stub engine | replaced in fix1.md and in the README (docs commit 21b7326) with the real-engine behaviour | a number within 2 s; 3 wrong with CHROM (87, 80, 73), none with POS on the merged tree (65 of 65) | closed for |
| 1 | test list said red on main, 2 of 3 files only fail to compile | fix1.md now names the compile errors per file and says where main's 60 of 60 and the 51 come from | text | closed for |
| 1 | restart vs a gap-proof rate estimate | measured (C4, C4b, C4c): the engine's Rust core already resamples by timestamp; only `analyzePulseWindow` scales. Variant: timestamp-resampled `analyzePulseWindow`, restart off; self-checked on a known answer first | same rate across the gap: gap-proof 65 of 65 vs restart 61 (it wins). Rate changed (80 then 66): restart 62 to 63, gap-proof 49 (10 s) and 59 (30 s), both together 62. Restart kept; table in fix1.md "Considered" | closed for (restart) |
| 1 | 1 s hold rests on still-people captures | not closable here (needs captures of people moving) | | not closable |
| 1, 3, 4 | PR texts name fix/* branches with an unconventional, dataset-quoting first commit | texts now ask for review from `pr/no-face-no-reading` (6950c68), `pr/real-frame-rate` (ff1cc00), `pr/pos-in-fuser` (deca8d7); the public first commits stay (no force push). Pushing the pr/* refs is the owner's call | text | partly (push is the owner's) |
| 3 | benefit after fix 4 is quality, not rate | fix3.md now leads with "what this buys once fix 4 is in, and what it does not": rate and time to first reading unchanged (R4, R7, R9, R10, R13), quality table (C2) | stated plainly; says it can be dropped without losing measured rate accuracy | closed for |
| 3 | no test pins quality across frame rates | pre-registered (C1, C2). On fix 3's own branch (CHROM) the quality ratio overlaps between main and branch over 5 seeds (branch 0.64 to 0.92, main 0.49 to 1.11 at 15 fps / 160 bpm), so no such test is committed there. With POS it separates cleanly: `demoRunnerFrameGridQuality.test.ts` on the merged tree, red with fix 4 alone (0.19, 2.77), green on top (1.00, 1.00); goes red with bridging removed. Proposed for fix 3's update; file in case/rc | closed against for the branch alone; closed for on the merged tree |
| 3 | 60 fps not in the test, amplitude numbers not runnable on 0.14.0 | test added (bd72c7e): 72 bpm at 60 fps keeps its amplitude; 8 of 17 red on main; seeds 1 to 5 main 0.59 to 0.77, branch 0.87 to 1.05. `grid-amp.mjs` block in fix3.md, run as written: 0.14.0 0.48, 0.63, 6.93 s; branch 0.94, 1.04, 3.47 s; main = 0.14.0 | closed for |
| 3 | private R1 numbers from the test build's estimator | replaced in fix3.md with R7/R10 (main's own `analyzePulseWindow`), the old numbers withdrawn by name | fix 3 alone vs main +1.7 points, p 0.12; with fix 4, -0.1, p 0.76 | closed for |
| 3 | cost not quantified | added to fix3.md: `getMetrics()` 142 vs 57 ms at 15 fps, runner 6.25 vs 4.0 ms per camera second, equal to a 30 fps camera without the grid | text | closed for |
| 3 | R10's "fewer numbers shown, right more often" is post hoc | labelled in fix3.md as a lead, not a result. A held-out re-score needs recordings nobody has seen; the only ones are sealed | | not closable |
| 3 | demoRunnerFaceGapGrid only on local wip | fix3.md already names it with red/green; the new quality test is named the same way. Still not on any pushed branch, by design (needs fix 1 and fix 4) | | partly |
| 4 | published CHROM and overlap-add POS not discussed | both in fix4.md "Considered", private numbers labelled; overlap-add POS measured (C5) on the owner's 50 recordings through the whole fuser, scorer self-checked (known answer, pulseless no-gate, window length, each broken once). Run 1 was void (scorer divided by a zero window mean on dark recordings); fixed, a sample-count check added and broken once, rerun | streaming 29.9% vs overlap-add 28.3% (overlap-add worse in 32, better in 13). The streaming form costs nothing measurable. | closed for |
| 4 | "chrom" bit-identical has no committed test | `fusionChromGolden.test.ts` (564d589): summary of every output field equals what 49fdb41's built fuser and 0.14.0 print for a fixed input with dropouts, low skin and a reset; red when CHROM's window changes by one sample or "chrom" is wired to POS | 46 suites / 365 tests | closed for |
| 4 | HRV and breathing | HRV (R12) added to fix4.md: median RMSSD on a steady pulse 113 to 179 ms on main, 14 to 20 ms here. Breathing stated as not measured | | partly (breathing open) |
| 4 | 5% brightness claim omits parameters | rerun (bright2-rerun.log) and the parameters written in: 0.25 Hz / 0.1 grey for the true 50, 0.4 Hz / 0.2 for the true 100 | reproduces: 65; 76 to 77; POS 50 and 100 | closed for |

New tips: `fix/no-face-no-reading` 21b7326, `fix/real-frame-rate` bd72c7e, `fix/pos-in-fuser` 564d589 (all on the fork).
merge-plan.md updated (table tips and a section 7).
