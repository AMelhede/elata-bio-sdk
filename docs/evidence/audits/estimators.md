# Estimators audit: fix 5 (no-rate-doubling) and fix 13 (no-calibration-blend)

Reviewer stance: an Elata maintainer who did not write these and looks for reasons not to merge.
Written 2026-10-12. acf-octave.md already existed when this step started (09:36), so no wait was needed.
No branch was changed. Pre-registration: case/est/prereg.md (times inside). Scripts and raw outputs: case/est/.
Builds: main 49fdb41, fix 5 ea12c6b, fix 13 608e797, and a scratch merge of 5 and 13 (detached worktree, no ref
touched, removed afterwards), each with the published 0.14.0 WASM core. Published 0.14.0 from peak-app node_modules.

## Fix 5: stop the spectral estimator doubling the strongest rate

### Without the change (reproduced, every number matched)

| check | PR says | 0.14.0 | main | branch |
|---|---|---|---|---|
| estimateDominantBpm, 65 bpm, harmonic 0.6 | 132 / 66 | 132 | 132 | 66 |
| processor 60 bpm, harmonic 0.5 | withheld, 0.30 / 60.0, 0.94 | null, 0.30 | null, 0.30 | 60, 0.94 |
| processor 72 bpm, harmonic 0.4 | 98.3, 0.83 / 72.0, 0.94 | 98.3, 0.83 | 98.3, 0.83 | 72, 0.94 |
| 105 clean pulses (50 to 84, h2 0.4/0.5/0.6) | 69 right, 12 wrong, 24 withheld / 105 | 69 / 12 / 24 | same | 105 right |
| analyzePulseWindow: spectrum double, beats double | 105, 70 | 105, 70 | 105, 70 | 0, 5 |
| HRV miss (mean), within 30% | 66 ms, 19 / 10 ms, 105 | 66.3, 19 | same | 10.4, 105 |
| acf and respiration unchanged over the 105 | yes | n/a | hash equal to branch | equal |

"Right" in the sweep is within 5 bpm; the PR does not say so.

### With the change

spectralNoDoubling.test.ts copied onto main: 8 of 9 red by assertion, the 55 to 110 pin passes (as stated). On the
branch: 9 of 9 green. On the merged tree wip/all-fixes: both fixes' files plus the lifecycle file, 32 of 32 green.

### Cost, measured here (new; none of this is in the PR)

- Noise (prereg N1): estimateDominantBpm, 27 rates 50 to 180, white noise sd 1/2/3 and drift, 20 seeds, 3,240
  windows. The branch loses 0 right reads in every class and gains 69 to 133 per class, all under 90 bpm. The old
  rule's half-rate rescue did no work in noise. Processor (N2, 140 runs): 0 lost, 3 gained.
- Raw processor end to end (E1, the acf harness's grey suite, 2,592 scored seconds): main 1,813, branch 2,237, 0
  lost, 424 gained (50 and 72 bpm only). With no pulse, a number is shown in 230 of 432 seconds against 220 on main
  (+10). The PR does not mention this.
- Session path with main's CHROM fuser and tracker (E2, synthetic face with a pure sine pulse, so the doubling case
  never arises there): main 590, branch 586 of 1,320, 10 lost (all at 120 bpm, 20 fps, one seed) and 6 gained. In
  those 10 seconds the spectral, acf and resolved rates all read 120 on both builds; the branch shows 134.8 from the
  calibration blend, whose trained state remembers earlier reads. So the loss arrives through the blend fix 13
  targets, not through a half-rate rescue. With fix 13's `calibrationBlend: false` on both (E4b): 856 against 851, 5
  lost (2 at 50, 3 at 140), 0 gained.
- The stated tradeoff (a true 140 with a stronger 70 line reads 69) is real and conceded in the PR.
- Peaks residual: on the branch the peak estimate still reads double in 6 of the 105 (h2 0.6 at 50 to 54 bpm, and
  55 reads 73). The PR's peak claim is the 60 bpm case only; the processor still reads all 105 right.

### Objections

| objection | status | where |
|---|---|---|
| Problem not real | answered | reproduced on 0.14.0 and main, numbers exact |
| Test not red on main | answered | 8 of 9 red, the 9th pins unchanged behaviour by design |
| Removes a half-rate guard | conceded, now measured | PR "tradeoff"; N1 shows 0 loss in noise; E2 and E4b show small session-path losses (0.4 to 0.8%) |
| Evidence is synthetic; harmonic 0.4 to 0.6 asserted, no source | gap | needs a citation for camera PPG second-harmonic ratio |
| Real-recording evidence is private and alone shows no measurable change | conceded | PR's own "observation" paragraph says so |
| More numbers with no pulse (230 vs 220 of 432) | gap | not in PR text |
| Session-path cost (590 to 586) | gap | not in PR text |
| Peaks still double in 6 of 105 | gap | not in PR text |
| Public fork commit 206bec2 names two datasets and quotes dataset numbers | gap | cannot be removed without a rewrite (forbidden); the PR is to be opened from the one-commit ref, which is clean |
| PR text says pr/no-rate-doubling is stale (cut from 99198e7) | gap | it is not: its tree equals ea12c6b, parent 49fdb41; text is out of date |
| ppg-web behaviour moves (rmssd 164 to 1, spectral 120 to 60), bpm checked in two cases only | gap (minor) | PR "what does not change" |
| Patch changeset for a behaviour change of an exported function | answered | it is a bug fix; changeset names what moves |
| Rust picker untouched | answered | separate issue text |
| Committed demo bundle still has the rule | answered | regenerated in demo builds |
| Interactions | answered | merges cleanly with all; with 13 the losses shrink to 5 |
| CI, lint, tsc | answered (claimed) | PR lists full suites; not rerun here beyond the new tests |

Verdict: strong-after-gaps. The defect, the test and the reproduction all hold exactly, and the cheap alternative
cost (noise) came back zero. What a maintainer would catch is text: three measured side effects the PR does not
mention (no-pulse +10 of 432, session path -4 of 1,320, peaks 6 of 105), a stale note about the one-commit ref, and an
uncited harmonic-strength premise.

## Fix 13: add calibrationBlend: false so bpm shows the resolved rate

### Without the change (reproduced, exact)

The PR's script printed the PR's lines exactly on 0.14.0, main, and the branch with the option left out or `true`
(95.7 100.3 ... 115.5; last read 116.4, resolved 120, spectral 120, acf 60). With `false`: 120.0 every second,
calibrated_bpm 118.7. The reproduction needs no data.

### With the change

New tests on main, type-checked: both files stop at TS2345 and TS2353 (as stated). Type-checking off: 6 red by
assertion (the 4 `false` single-read cases, the once-a-second case, the session pass-through). On the branch: 16 of
16 green. The PR says "6 of the 17 tests fail; the 11 that pass are the 6 existing lifecycle tests and the 5 that pin
unchanged behaviour". The real counts are 16 and 10 (4 pins); the text predates 608e797, which dropped the 72 pin.

Default unchanged: grey suite, branch with the option left out against main, 3,024 reads, 0 differ in any field.

Session suite (E3) reproduced exactly: 590 to 856, 23 lost and 289 gained, no pulse 284 to 288 of 327. With fix 5
merged as well (E4): 851, 25 lost, 286 gained, no pulse 286.

### Cost

No change at the default. With `false`: the losses stated in the PR (23 of 1,320 session seconds, 4 more no-pulse
seconds), which is why it is opt-in. One more public option on two constructors, kept forever.

### Objections

| objection | status | where |
|---|---|---|
| Problem not real | answered | reproduced exactly, no data needed |
| Tests not red on main | answered | compile errors, 6 red with type-checking off |
| An option instead of a fix: API surface for a behaviour you say is better | gap (maintainer's call) | PR asks the maintainer to choose the default; acceptable, but some maintainers refuse new switches |
| Root cause is the acf halving; the option papers over it | answered in text | "Considered and not done" (C loses at 15 and 20 fps, D loses 103 noisy reads) |
| The C and D numbers and both suite tables come from a harness the maintainer cannot run | gap | criterion 6; the raw grey suite could ship as one standalone script |
| Test count wrong (17 and 11 vs 16 and 10) | gap | text fix |
| With fixes 4 and 5 in place the value on real recordings is nil (2,094 vs 2,047) | conceded | PR says so |
| Real-recording gain (19.4% to 24.3%) private | conceded | labelled context |
| Default rule fails by small margins | answered | table in PR |
| Name exposes internals | gap (taste) | maintainer may prefer another name |
| Merge interactions | answered | merge-tree clean; 32 of 32 on merged tree; E4 measured |
| Convention: minor changeset, README, doc comments | answered | diff |

Verdict: strong-after-gaps. Every number I could rerun matched to the second. The weak points are that it is an
opt-in switch whose real-data value disappears once fix 5 and fix 4 land, the alternative analysis cannot be rerun
by the maintainer, and one stale test count.

## Gaps

1. Fix 5 text: add the three measured side effects (no-pulse 230 vs 220 of 432 on the raw grey suite; session path
   590 to 586 with the 10 losses explained by the calibration blend, and 5 lost with fix 13's option; peaks double
   in 6 of 105 at h2 0.6, 50 to 55 bpm, processor still right). Closable now (text).
2. Fix 5 text: say "right" means within 5 bpm in the sweep; correct the stale note on pr/no-rate-doubling. Closable now.
3. Fix 5: a source for second-harmonic strength in camera PPG. Closable now only if a citation is found in under an
   hour; otherwise soften to "synthetic, harmonic chosen to span 0.4 to 0.6" (closable as text either way).
4. Fix 5: commit 206bec2 on the public fork carries dataset names and numbers. Not closable under the no-rewrite
   rule; mitigated by opening from the clean one-commit ref; flag to the owner.
5. Fix 5: ppg-web checked in two cases only. Closable now (a small sweep of ppg-web bpm on main vs branch).
6. Fix 13 text: 17 and 11 should be 16 and 10 (4 pins). Closable now.
7. Fix 13: ship the raw grey suite as one standalone script a maintainer can run against 0.14.0 and the branch.
   Closable now (the harness exists; the session suite needs a shim and is not closable within an hour).
8. Fix 13: whether a maintainer will accept a new option at all is a judgement for them; not closable by measurement.

## Closed (gap-closing round, 2026-10-12, 13:30 to 15:40 UTC)

acf-octave.md existed when this round started (09:36), so no wait. No fix branch changed: no gap needed code, so
nothing was pushed and no pr/ ref or merge needed regenerating (pr/no-rate-doubling 1a73b09 and
pr/no-calibration-blend c4f98c2 checked: trees equal ea12c6b and 608e797, parent 49fdb41, clean messages).
Pre-registration with times: case/est2/prereg.md (P1 to P5, plus one correction). Scripts and raw outputs:
case/est2/ (ppgsweep.mjs, ppgagg.mjs, grey-suite.mjs, e2eh2.mjs, h2agg.mjs, pairagg.mjs, *.txt, out/*.jsonl).
Builds under scratch/est (main 49fdb41, fix 5 ea12c6b, fix 13 608e797, a scratch 5+13 merge, a measurement copy of
main that records the doubling rule's inputs), each with the published 0.14.0 WASM core; removed at the end.
Every self-check was broken once and seen to throw.

| gap | what was done | result | outcome |
|---|---|---|---|
| 1. fix 5 text omits three side effects | added "What it costs, measured" to fix5.md | no pulse 220 -> 230 of 432; session path 590 -> 586 (10 lost, all through the calibration blend; 5 lost with fix 13's option); peaks still wrong in 6 of 105 (re-run here: double at 50 to 54 with h2 0.6, 55 reads 73) | closed (text) |
| 2. "right" undefined; stale pr/ note | fix5.md defines right (within 5 bpm); pr/ note replaced with the ref's real state | | closed (text) |
| 3. no source for harmonic strength | literature: Park et al. 2023 (PMC10476820), contact finger PPG, 173 adults, AH2/AH1 0.12 +/- 0.05, max 0.35, so the premise does NOT hold for contact PPG. Measured on camera signals (P3: main's session path, 50 owner recordings, every estimateDominantBpm call recorded): ratio at a right slow rate passed 0.35 in 41 of 568 windows (7.2%; median 0.18, p90 0.34, p99 0.51). fix5.md now cites both and says the 0.4 to 0.6 synthetic range is chosen to make the rule fire, not drawn from a population | closed, premise narrowed: holds on camera signals, not on contact PPG |
| 4. 206bec2 on the public fork names datasets | not closable without a history rewrite (forbidden); PR text already says to open from the one-commit ref, which is clean | | not closable; owner to note |
| 5. ppg-web checked in two cases | P1: PpgProcessor bundled against each build, 608 cases (45 to 180 bpm, h2 0/0.4/0.5/0.6, clean and noisy) + 105 HRV cases | bpm right 423 of 608 on both, 0 lost, 0 gained; HRV within 30% 23 -> 105, mean miss 67.9 -> 8.9 ms. Prereg predicted no bpm change at >= 85: 4 cases at exactly 85 moved 85.33 -> 85.01 (grid point 84.9999 sits inside the old rule), all right on both. Side finding: ppg-web halves every rate from 111 up on main and fix 5 alike (acf halving), added to fix13.md | closed for fix 5 |
| 6. fix 13 test counts | counted: 9 + 7 = 16 tests, 10 pass on main (6 lifecycle + 4 pins) | fix13.md corrected | closed (text) |
| 7. fix 13 grey suite not runnable by a maintainer | grey-suite.mjs: public API only, no data, self-checks (known 72, 45 s window, no-gate spectral on noise; each broken once). Reproduces the harness exactly: 0.14.0 = main = fix 13 default 1,813 / 220; fix 5 2,237 / 230, 0 lost 424 gained; fix 13 false 2,053 / 218, 7 lost 247 gained. Inlined in fix5.md and fix13.md | closed. The session suite still needs a shim and is not packaged (said in fix13.md) |
| 8. maintainer may refuse a new option | judgement for the maintainer | | not closable |

New evidence that goes partly against fix 5 (P3 to P5, owner recordings, private, labelled context in fix5.md):

- The removed rule's doubling is never a real rescue on these recordings. It fired 1,682 times: 41 broke a right
  rate; all 183 "right after doubling" were band-edge reads (strongest line 42 or 45 bpm) doubled to 84 or 90 for
  people whose rate was 79 to 89; 865 of 1,048 edge doublings were wrong. A higher threshold (0.5: 6 broken, 56
  lucky; 0.7: 0 broken, 18 lucky) keeps that edge guess, so it was not proposed; written under "Considered".
- End to end, fix 5 ALONE through main's session path: 1,296 -> 1,289 right seconds of 6,679 (155 lost, 148 gained;
  18 recordings better, 20 worse, p 0.87); seconds reading double 33 -> 15. By the pre-registered rule this is a
  small loss, statistically nothing. 99 of the 155 losses are reads where main's gate refused and showed the
  engine's right rate, and fix 5's gate passed and showed the calibration blend (fix 13's mechanism).
- With fix 13's calibrationBlend:false on both: 1,625 -> 1,653 (60 lost, 88 gained; 19 better, 8 worse, p 0.05).
- Note on counts: an earlier pass of mine used rounded rates and got 1,300 / 1,292; the harness's own flag (used
  above and in fix 13's PR) gives 1,296. Recorded in prereg.md.

Verdict after this round. Fix 5: keep, with its claim narrowed. The defect, the reproduction, the test and the
synthetic costs all hold; its real-camera value alone is nil (slightly negative by our own rule, not significant)
and appears only together with fix 13's option. fix5.md now says that plainly, and merge-plan.md says the two buy
their value together. If the maintainer will not take fix 13's option, fix 5 rests on synthetic evidence and the
HRV result, and we should say so rather than claim a real-world gain. Fix 13: unchanged; text corrected and its raw
suite made runnable.
