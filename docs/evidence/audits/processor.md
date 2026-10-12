# Processor audit: fix 11 (processor-colour-pulse) and fix 12 (no-engine-fallback)

Written 2026-10-12 from the chair of an Elata maintainer who did not write either and is looking for reasons not
to merge. No branch was changed. Preregistrations: case/pa/prereg.md (P1 to P11, each timed before its run).
Probes and raw output: case/pa/. Builds: published 0.14.0 from a clean npm install (scratch/pa/clean), main
49fdb41, fix 11 tip 7aa4325, fix 12 tip 6894d3a (worktrees under scratch/pa). Remote fix/ branches match the
local tips; each pr/ ref has the same tree as its tip and parent 49fdb41, author Andreas Melhede.

## Fix 11: rgbPulse "pos" (opt-in)

Without the change (checked)
- The PR's reproduce snippet, verbatim, on 0.14.0: spectral 84.0 for true 50, 72, 120 at 30 fps and 72 at 20 fps;
  bpm none, none, none, 100.0. Main and the branch with the option left out: identical. Exactly the PR.
- The window snippet on 0.14.0 and main: 120.20 ... 119.97 -1.07 -0.88 -0.97, exactly the PR (raw green for nine
  samples beside values under 1.1).
- End to end through DemoRunner with the real 0.14.0 WASM (the PR's e2e.mjs), 3 seeds, last 30 s: main right
  0 / 9 / 0 of 90 at 30 fps and 0 / 4 / 3 at 20 fps; no pulse shown 50 and 48 of 90. Exactly the PR's table.

With the change (checked)
- Snippet with { rgbPulse: "pos" }: spectral 51.0, 72.0, 120.0, 72.0; bpm 50.9, 72.1, 119.9, 71.8. Exactly the PR.
- e2e: right 90 / 90 / 87 at 30 fps, 90 / 90 / 78 at 20 fps; no pulse shown 30 and 40 (main 50 and 48).
- New tests: on main both files stop at TS2305 / TS2353; with type checking off 17 of 25 fail by assertion, the
  8 that pass are the 6 old lifecycle tests and the 2 declared pass-on-main. On the tip 25 of 25. Full rppg-web
  jest at the tip 44 suites, 369 tests, all pass. All as the PR says.
- Default unchanged: 1,248 reads per arm (pushSampleRgb and pushSampleRgbMeta, left out and "chrom"), every field
  identical to main; the e2e default equals main in 24 of 24 runs. My break check ("pos" on) differs in 77 of 78.
- Not claimed by the PR, measured here (P9): at 6 to 12 fps "pos" is right 90 of 90 seconds for 50 and 72 in every
  cell; main 0 to 39 of 90. No blow-up where the band top meets Nyquist (max window value under 0.007).

Cost (measured)
- CPU: push per colour sample 2.25 us against main's 2.27 us (warm, idle engine); getMetrics about 143 to 160 ms
  on all arms. No measurable cost.
- CI: the new test file takes 51 s under jest --runInBand; the whole rppg-web suite took 79 s with it, so it
  roughly doubles the suite.
- API: one optional field on two option types; no new package export. A second pulse model to maintain.
- New defect found here (P8, P11): the R = G = B pass-through. One clipped frame (255, 255, 255, or 1, 1, 1 in
  DemoRunner units) at 10 s writes the raw level into a window of values near 0.01, and "pos" then reads nothing
  right for seconds 16 to 40: bpm right 0 of 72 (72 of 72 without the frame), in every engine and scale tried.
  Returning 0 on R = G = B instead (a scratch copy of the dist, one line) gives 72 of 72 in all eight clipped
  cells. Main is already wrong on these feeds, so this is not a regression against main, but it is a fragility the
  PR adds to its own path and its test pins the behaviour that causes it. A plain 0 would break a grey-only stream
  (a monochrome camera pushed as g, g, g), which the PR's own test keeps reading 72, so the fix needs a rule
  (for example: pass through only while the stream has been grey; one grey sample in a colour stream gives 0).

Objections
1. Ships a fix for a broken path as opt-in, so nobody gets it. Answered in the PR (rule 2 fails: direct processor
   at 30 fps shows a number with no pulse in 67% of seconds against 22%), and the session table shows the reverse.
   A maintainer may still prefer one path. Conceded as a judgement for them.
2. Two pulse paths to maintain. Conceded.
3. Clipped-frame fragility (above). Gap.
4. The direct processor matrix, which decides the default, has no script in the PR; only the e2e table does. Gap.
5. Evidence is synthetic plus private recordings. Answered: the synthetic cases run the real WASM and a maintainer
   can reproduce them; the recordings are labelled context and decide nothing.
6. Test runtime (51 s, about doubling the suite). Gap: no mention in the PR, and the reads could be fewer.
7. Interactions: fix 4 shares PosPulseModel byte for byte, fix 1 needs one resetSignal line (test given), fix 5
   moves 84 to 42 (changeset avoids the number). Answered in the PR; not re-run here.
8. Band-pass 0.7 Hz corner reads 54 to 56 for a true 50 in 3 of 10 seeds at 0.5 grey levels. Conceded in the PR.
9. Naming: "chrom" names a path that also carries the raw-green fallback. Minor, open.

Verdict: strong-after-gaps. The defect reproduces exactly on 0.14.0 in a few lines, the tests are honest red and
green, the default is unchanged read for read and costs nothing. The R = G = B pass-through must be fixed before it
goes in, and the direct matrix needs its script.

## Fix 12: engineFallback: false (opt-in)

Without the change (checked)
- The PR's snippet, verbatim, on 0.14.0: 88 in all 20 seconds; last read fused_bpm null, fused_source none,
  confidence 0.20. Main and the branch default: identical. Exactly the PR.
- Early reads (P7b, real 0.14.0 core, under 24 samples): 106 pulse reads shown, 4 right; the most common value 180
  (114 of 189 shown values), the band edge.

With the change (checked)
- Snippet with { engineFallback: false }: none in every second, bpm null. As claimed.
- New tests: compile errors on main (TS2353); with type checking off 8 of 16 fail (7 of the 9 new plus the
  lifecycle test), the 8 that pass are the 2 declared pass-on-main and the 6 old lifecycle tests. Tip 16 of 16.
  Full suite at the tip 44 suites, 360 tests, all pass. As claimed.
- Default unchanged: 1,248 reads per arm identical to main; my break check (false) differs in 5 of 78.

Cost (measured)
- Behaviour, by the PR's own numbers: on main's colour path the option removes nearly every right second (58 to 0
  synthetic, 1,038 to 128 on recordings). Only useful after fix 11, where it costs 30 of 1,698 synthetic right
  seconds.
- CI: new test file 64 s under jest --runInBand; suite 91 s with it.

Objections
1. The field already exists. P7 (6,528 reads, real 0.14.0 core, no Muse): main's fused_bpm equals the branch's
   bpm with false in every one of the 5,440 reads with 24 or more samples (0 differences); all 192 differences are
   early reads, where main's fused_bpm is the core's rate. So an app can get this today with `m.fused_bpm`, and a
   gating user with `{ ...m, bpm: m.fused_bpm }`. What the option adds: blank early reads, a Muse rate kept in
   refused reads, and one switch on createRppgSession. The PR does not mention fused_bpm as an alternative. Gap,
   and the main reason to doubt the change.
2. Better-scoped alternative not tried: blank only the early reads (under 24 samples, no check at all) by
   default. On P7b they are right 4 of 106 times and mostly the 180 band edge. Gap.
3. Useless on main's colour path by the PR's own table; depends on fix 11. Conceded in the PR.
4. The real-core harness tables have no script in the PR. Gap.
5. Default kept partly on private recordings. Answered: the direction is conservative and labelled context.
6. Test runtime 64 s. Gap.
7. Merge interactions (layout moved to merge cleanly; resetSignal needs nothing). Answered in the PR; not re-run.

Verdict: weak. Correct and well tested, but most of what it offers is already in `fused_bpm`, and the part that is
not (early reads) would be a better, smaller change. Either rewrite it as "early reads show no number" plus a README
line pointing at fused_bpm, or withdraw it in favour of that.

## Gaps

| change | gap | plan | closable now |
|---|---|---|---|
| fix 11 | R = G = B pass-through puts a clipped frame's raw level in the window (0 of 72 right after one frame) | Pass through only while the stream is grey, else 0; test with one clipped frame red now, green after; keep the grey-stream test | yes |
| fix 11 | Direct processor matrix (decides the default) has no script | Add the harness as a details block like e2e.mjs | yes |
| fix 11 | New test file 51 s, about doubles the suite | Fewer reads or shorter feeds; state the time in the PR | yes |
| fix 11 | PR does not state CPU cost or low-fps behaviour | Add P10 (no measurable cost) and P9 (6 to 12 fps) lines | yes |
| fix 12 | fused_bpm already gives the same value after 24 samples (0 differences in 5,440 reads) | Say so in the PR, or reduce the change to early reads plus a README line | yes |
| fix 12 | Early-reads-only default not tried | Measure right and shown early reads with only the early returns blanked, against the 1% bar | yes |
| fix 12 | Real-core tables have no script | Add the harness | yes |
| fix 12 | New test file 64 s | Trim reads; state the time | yes |

## Closed

Done 2026-10-12, 13:31 to 15:50 UTC, after the audit above. Preregistration with times: case/pa/closed-prereg.md
(Q1 to Q9, each written before its run). Probes and raw output: case/pa/closed/. Copies of both PR texts and the
merge plan as they were before: case/pa/closed/*.before.

### Fix 11

1. R = G = B pass-through (gap, closed for the change). Test first on the branch: "one clipped frame in a colour
   stream puts no raw level in the window and still reads" and an extractor test "passes an R = G = B sample through
   only while the stream has been grey"; both red on 7aa4325 (the sample read 255, expected 0), green after commit
   7f5fa1c (a grey sample passes its level only until the first colour sample since the last reset, then gives 0
   and stays out of POS and the rate clock). The grey-stream test still passes. Q1 (P8 harness, 3 seeds, seconds 16
   to 40): one or five clipped grey frames, both scales, both engines, 8 cells: first version 0 to 2 of 72 right,
   new tip 72 of 72 in all 8; the 4 cells with no clipped frame unchanged at 72. Q2: a clipped frame that is not
   exactly grey ((255,255,250), (255,250,240)) costs "pos" nothing in either version (72 of 72). Q3 / Q3b, the cost:
   a stream that turns grey for good reads 72 for the 25 s its window still holds colour, then nothing with the idle
   engine and the core's wrong rate with the real one (0 of 72 right in seconds 66 to 90), where the first version
   read 72. Q3c: the alternative "pass through again after 45 grey samples in a row" keeps Q1 at 72 everywhere but
   shows 127 wrong numbers over the switch feeds against 72 for the rule taken (rule set before the run: no more
   wrong numbers), so the simpler rule stays. Q9, recordings (context): 411 of 160,155 frames in 6 recordings are
   exactly grey and not zero; re-scored at the new tip, main 1,044 of 6,679 (unchanged), "pos" 1,692 against the first
   version's 1,694: the prereg called fewer "worse", and it is 2 seconds over 3 recordings, so the rule is reported
   as neither helping nor hurting on recordings; the synthetic failure did not show there. All in fix11.md ("A
   clipped frame", "Considered", "Our own observation").
2. Direct processor matrix had no script (gap, closed). matrix.mjs, self-contained, now a details block in fix11.md.
   Q4: run against main and the branch with both engines, all 128 cell counts equal the counts the table was made
   from (f11/out/v2.jsonl); the new tip gives the same 64 counts as the first version.
3. Test runtime (gap, closed). Reads every 5 s instead of 2 (commit b748546). Q5: every asserted answer is the same
   read every 1, 2 or 5 s on the branch and on main (only the true 120 at 30 fps withholds bpm at 5 s, which its test
   allows). File 57 s to about 27 s; rppg-web suite 56 s against main's 34 s. Red/green redone: on main the files stop
   at TS2305/TS2353; type-checking off, 19 of 27 fail, the 8 passes are the 6 old lifecycle tests and the 2 declared
   pass-on-main. 14 break-on-purpose mutations rerun on the new tip, every one red (closed/mutations-new.jsonl),
   including the three new grey ones. Full suite at b748546: 44 suites, 371 tests; tsc both configs, lint clean.
4. CPU and low-fps lines (gap, closed). P10 re-run on the new tip: push 2.06 against 1.95 us (earlier 2.25 against
   2.27), reads 143 to 164 ms on every arm; P9 (6 to 12 fps) added. Both in fix11.md "What it costs".
5. Naming of "chrom" (gap, answered in text): fix11.md "Considered" says what it covers and offers "legacy".
6. Branch: pushed fast-forward 7aa4325..b748546 to the fork's fix/processor-colour-pulse; local pr/processor-colour-pulse
   regenerated as 9828923 (same tree as b748546, parent 49fdb41, author Andreas Melhede, not pushed). Merged onto a
   scratch copy of wip/all-fixes (32ce8b1, not moved): clean, 55 suites and 463 tests pass, tsc and lint clean, the
   first version's grey line put back there turns the two grey tests red. merge-plan.md updated.

Verdict after closing: strong. Every closable gap is closed; the remaining open items are judgements for the
maintainer (opt-in versus default, two pulse models).

### Fix 12

1. fused_bpm already carries the value (gap, closed against the change). Q7: fusedeq.mjs on the branch, real 0.14.0
   core, reads every 100 ms: default fused_bpm equals bpm with engineFallback false in 1,572 of 1,572 reads with 24
   or more samples (P7's wider run: 5,440 of 5,440). Now stated at the top of fix12.md with the script, and the PR is
   recommended NOT to be opened; the issue is kept, now naming fused_bpm and its doc comment (rppgProcessor.ts line
   116: "Same as bpm when no external source is active", false in every refused read).
2. Early-reads-only default (gap, measured, closed against). Q6 with a rule set before running ((a) at most 1% of
   right seconds lost and (b) blanked wrong numbers at least 10 to 1 over right ones, synthetic and recordings
   separately, read once a second from the first second; scorer self-checks broken one by one and each threw):
   synthetic 13 early reads, 10 with a pulse all wrong, 0 of 20 right seconds lost: holds. Recordings 13 early reads,
   11 wrong and 2 right, 2 of 1,144 right seconds lost: (a) holds, (b) fails. Every 100 ms in the first 3 s
   (descriptive): 96 pulse numbers, 4 right. Nothing else changed in any read. Reported under "Considered"; not
   proposed.
3. Real-core tables had no script (gap, closed). realcore.mjs (feeds copied from chain.mjs, refusal read from public
   fields) is a details block in fix12.md. Q8: on main and the branch default it prints 432 / 249 / 33, 144 / 141 / 70,
   288 / 288 / 142 and right 18 / 40 / 0, and with false right 0 / 0 / 0, all as the PR states. The pulseless capture
   row is ours and is labelled as not reproducible.
4. Test runtime (gap, stated, not trimmed): 64 s, suite 91 s, now in fix12.md; not trimmed because the PR is
   recommended withdrawn.
5. No branch change for fix 12 (fix/no-engine-fallback stays at 6894d3a, pr/no-engine-fallback at 13793e5).

Verdict after closing: withdraw the PR, file the issue. The evidence is against the change: what it offers after 24
samples is already in fused_bpm, read for read, and the part that is not did not meet its bar on recordings.
