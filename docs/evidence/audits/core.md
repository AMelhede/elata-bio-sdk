# Core audit: fix 2 (Rust colour projection sign) and the harmonic picker issue

Written 2026-10-12 from the chair of an Elata maintainer who did not write either and is looking for reasons not
to merge. No branch was changed. Everything below was run today in this container; preregistrations are in
case/core/prereg-1.md to prereg-5.md, probes in case/core/probes, raw output in case/core/results.

Builds used: published 0.14.0 from a clean `npm install` (scratch/core/npm0140); WASM built from Elata main
49fdb41 and from the branch tip 021a870 (cargo 1.94.0 per rust-toolchain.toml, wasm-bindgen 0.2.129); main's
rppg-web dist built with tsc. The Rust core has not changed since the 0.14.0 release commit (0d6464a..49fdb41
touches nothing under crates/elata-rppg or crates/elata-rppg-wasm), and every input below read the same on the
0.14.0 WASM and on main's.

## Fix 2: fix/rust-colour-projection-sign (021a870)

### Without the change

- The PR's snippet, pasted verbatim into a clean folder with 0.14.0: lamp 60 reads 66.6, lamp 120 reads 120
  (true pulse 90). Exactly the PR's numbers. Main's WASM: the same.
- The `+` has been there since the repository's first commit (a70e8a6); it was never a deliberate change.
- First principles, checked: with the code's axes a pure brightness change gives X = Y, so X + alpha Y doubles
  it; a blood-volume pulse moves X and Y in opposite directions with alpha = sd X / sd Y, so X + alpha Y is
  exactly zero. The SDK's own JS ChromPulseModel (rppgSignalModel.ts:82 to 98) uses the same axes and subtracts.
- New known answers through the public `RppgPipeline` (my probes, not in the PR): a pulse alone in camera colour
  (BVP colour, 0.4% green, sensor noise 0.15 levels, 16 rates 87 to 132, 3 seeds): main right 0 of 48, no
  reading in 33. With a 1% lamp at 21 rates against 4 pulse rates: main right 1 of 61, and 46 of its 60 wrong
  readings are the lamp's rate.

### With the change

- Snippet on the branch's WASM: 90 and 89.4, as claimed.
- `cargo test -p elata-rppg --all-targets` 29 of 29 plus the doctest; elata-rppg-ffi and elata-rppg-wasm pass;
  clippy `-D warnings` and rustdoc `-D warnings` clean; pipeline.rs rustfmt-clean (main too).
- Red/green, each claim reproduced: main's sign with the new tests: 3 red (projection, lamp, switch; the switch
  test reads 89.4 at 66); plain flip: 3 red (fused test reads 72 as 111, metrics_estimate_bpm_on_sine,
  steady_change_is_adopted) and ffi_wrapper_basic red; per-sample bypass: switch test red (66 reads 79.8).
- Switch sweep (62 rates, 48 to 170): within 5 bpm branch 54, per sample 4, main 5. Exactly the PR.
- Pulse alone: branch 48 of 48. Lamp grid: branch 60 of 61, none read the lamp.
- Package level (RppgProcessor.pushSampleRgb, main's dist): `resolved_bpm` 66.6 to 89.0 and 120.0 to 88.7,
  exactly the PR. `getMetrics().bpm` in the noise-free snippet is identical on both builds (64.6 and 81.0): the JS
  estimators decide it there, as the PR says. With noise 0.15 and the lamp at 60, three seeds: `bpm` at the
  pulse in 15, 3 and 14 of the last 15 seconds on the branch, 0 on main (PR: 14 of 15, one run). Lamp at 72 and
  no pulse: a rate shown in 0, 2 and 0 of 15 seconds on the branch, 15 of 15 on main every seed (PR: 7 of 15).

### Cost, measured

- API, defaults, options: none changed.
- Speed: the projection itself takes 7.2 against 7.3 us (median, 10 s window, same binary, alternated; a second
  run 9.6 against 9.3). get_metrics takes about 5 ms, so the change is under 0.2% of it. Not stated in the PR.
- The default fused path is NOT bit-for-bit unchanged, contrary to the PR and the changeset. Main computes
  X + alpha Y on R = G = B windows, which is 2X only to rounding (2.8e-7 relative, 83 of 300 samples not exactly
  2X); the branch outputs X. Downstream near-ties then flip. Session level (DemoRunner with fusion on, every
  engine sample fused: 0 RGB pushes, 8 rates x 3 seeds x lamp none and 60, 1,920 seconds): shown `bpm` differs
  in 169 seconds (12 of 48 runs) by at most 1.3 bpm, `resolved_bpm` in 85 seconds by up to 5.8 bpm, never shown
  against withheld, shown-right identical (61 and 9). Harmless in size, but a claim a maintainer can falsify.
- Fix for that, measured: keep main's own expression for windows with no colour difference (`x_buf[i] + alpha *
  y_buf[i]` instead of `x_buf[i]`, one line, pipeline.keepmain.rs). Then: 0 of 1,920 session seconds differ
  from main on the fused path; the camera path is identical to the branch in all 48 runs; 29 of 29 tests pass;
  switch 54, pulse alone 48 of 48, lamp grid 60 of 61, fused-only probe identical to main to 7 decimals;
  snippet 90 and 89.4; ffi test and clippy pass.
- Camera-RGB path at the session level (multiRoiFusion off, synthetic face, 8 rates x 3 seeds, last 20 s, 480 s
  per cell). Right / wrong / withheld:

  | lamp | main | branch | branch with the picker off (attribution only) |
  |---|---|---|---|
  | none | 39 / 220 / 221 | 140 / 336 / 4 | 232 / 248 / 0 |
  | 1% at 60 | 95 / 385 / 0 | 197 / 283 / 0 | 255 / 225 / 0 |

  With a lamp the branch is better on both counts. Without one it shows 101 more right seconds and 116 more wrong
  ones, because main had cancelled the pulse and withheld. About 88 of those 116 are the harmonic picker
  (the issue below): the branch now passes the core's 72 to 48 and 81 to 51 misreads through (seen as "48 48 48"
  and "51 51 51" in the runs). The PR names the picker as a separate issue but does not say fix 2 makes it
  visible on these paths.
- Random interleaving (my generator, 5 seeds x 62 rates, 14 s and 30 s, 10%, 30% and 50% camera frames): the
  branch shows fewer wrong numbers than main in all six cells (36 against 62, 31 against 68, 39 against 70, 50
  against 75, 32 against 85, 41 against 80). The PR's "main withholds all 124" did not reproduce: with a
  different generator main shows a number in 79 of 310 at 10%. The direction is better than the PR says; the
  number is not checkable.

### Objections

| objection | status | where |
|---|---|---|
| Is it really a sign bug, or POS on purpose? | answered | PR issue text (axes are CHROM's; X = Y = d gives 2d); JS ChromPulseModel subtracts; sign present since a70e8a6 (add to text) |
| No test that fails on main | answered | 3 new tests red on main, verified |
| Bypass is a hack keyed on float equality | answered in part | grey cameras and clipped white read as on main (both scale X); an explicit mono flag gives identical results; neither is in the PR text |
| "Fused path unchanged" | gap, closable | false at the float level (169 of 1,920 seconds, up to 1.3 bpm); keep-main line makes it true (0 of 1,920) |
| Shows more wrong numbers without a lamp | conceded, attributable | 220 to 336 wrong on the camera path; 88 of the increase is the picker; text must say so and link the issue |
| Synthetic evidence only | gap | real-capture effect exists only in the issue draft: share right 37.5% to 40.7% on 35 captures of one person, better in 20, worse in 15 (two-sided sign test p 0.50). Modest; belongs in the PR as labelled private context |
| Claims nobody can check | gap, closable | 370 sequential mixes, 434 interleavings, the 124-run trade, 14 of 15, 7 of 15 and snr 110 to 5.45 have no harness or seed; my reruns agree in direction, not in count. Ship the probe as an `#[ignore]` test or trim |
| Private data | answered | the mixed-input observation is labelled "not reproducible from the PR"; no dataset names in code or commits (checked) |
| Alternatives not listed | gap | plain flip and per-sample are; missing: keep-main expression (better), explicit flag, a JS reset on source switch, a separate pre-extracted path without per-window normalisation (issue 2), POS axes |
| Mixed windows never happen | answered | PR says so (0 of 8,812 on real videos); per window still wins the switch 54 to 4 at no cost |
| Scope: planning docs edited | answered | two small corrections of a false "POS-style"; the private function keeps its POS name (say why) |
| CI | answered | ci-parity: 0 new failures; workspace fmt and clippy already red on main in other crates |
| Conventions | gap | first commit is not Conventional Commits and carries a corrected false claim; PR asks Elata to squash although it merges with merge commits. The one-commit ref pr/rust-colour-projection-sign (tree cbd4e06 = tip, parent 49fdb41) avoids the ask if used as the PR head |
| Version | answered | rppg-web patch changeset; elata-rppg 0.1.0 is on crates.io (checked), bumped at release per docs/releasing.md |
| Interactions | answered | merges cleanly with all; merged-tree tests pass (merge-plan.md); with issue 2's suggested `1 + fusedValue` the samples stay R = G = B, so the bypass still applies |

### Verdict: strong-after-gaps

The change is right by algebra, by the paper, by the SDK's own JS, and by every known answer I could build; the
reproduction is three lines on the published package and the tests go red on main. What a maintainer can still
hit: one false claim (fused path unchanged) with a measured one-line remedy, the believability cost on the
camera path without a lamp (mostly the picker, unstated), and counts with no harness.

## Issue draft: harmonic picker (issue-rust-harmonic-picker.md, issue 1)

### Without a change

- The issue's Rust test, verbatim, on main: fails with exactly the listed 24 of 46 (16 wrong, 8 none, 138 to 159).
- Through the published 0.14.0 WASM in Node (`push_sample`): all eleven table values, the 0.88 confidence, the two
  other settings, and the same 24 misreads. Identical on main's WASM and the branch's.
- An eight-line npm reproduction works on 0.14.0 (probes/issue1-npm-repro.mjs): 60 reads 66, 72 reads 48
  (confidence 0.88), 90 reads 90, 140 reads none. The issue offers only the Rust test.

### With the suggested direction (no patch proposed)

- Stage switches on main (the recheck's toggles): picker off, the test passes 46 of 46 (72.0, 60.0, 141.0);
  10 s segments, only 45 and 180 fail (the band edges, 0.75 to 3.0 Hz); post-hoc tie-break off, 72 reads 72;
  flat prior, 60 reads 60; no cepstrum boost, 141 reads 135.6 instead of none. Each mechanism as stated.
- User-visible severity, new: on the camera-RGB path with fix 2 in, switching the picker off moves the session's
  shown `bpm` from 140 to 232 right and 336 to 248 wrong seconds of 480 without a lamp, 197 to 255 and 283 to
  225 with one. On the default fused path this fixture could not isolate the picker (the fuser's own errors
  dominate there; main shows the right rate in 61 of 480 seconds).

### Objections

| objection | status | where |
|---|---|---|
| Reproducible in a few lines | answered | Rust test, verbatim, exact; add the npm snippet |
| Clean sines are not physiology | answered | 828-input sweep includes harmonic and noisy kinds; picker off wins 669 to 448 |
| On real captures removing the picker lowers share right (37.5% to 34.4% on main) | conceded in the issue | "real defect on known answers, not the main reason real readings are wrong" |
| Band-edge rates (45, 48, 180) inflate the count | gap, text | excluding them 21 of 43 interior rates still fail |
| Sweep counts not reproducible | gap, closable | sweep code not attached (counts depend on the generator; a second one is disclosed); attach probe_c.rs |
| What a user sees | gap, text | add the session-level numbers above (synthetic, camera path) |
| Mentions the fork's test build and PulseCheck | gap, text | unpublished fork work a maintainer cannot check; move to a footnote or drop |
| Private captures, one person, one webcam, one Oura value per capture | answered | labelled contributor-side; numbers reproduced by an independent run on 2026-10-11 |

### Verdict: strong-after-gaps (as an issue; no patch is proposed and none should be until real captures say so)

## Gaps, in order of what a maintainer hits first

1. Fix 2, "fused path unchanged" is false at the float level. Closable now: the keep-main line plus a test that
   an R = G = B window projects exactly as main did (red on the current tip), then regenerate the pr/ ref and
   re-merge onto a scratch copy of wip/all-fixes. Changes the branch, so not done in this step.
2. Fix 2, the camera path shows more wrong seconds without a lamp, mostly the picker. Closable now: text, with
   the table above, and a link to the picker issue.
3. Fix 2, counts without a harness. Closable now: add audit_mix.rs and the switch sweep as `#[ignore]` tests, or
   cut the 370, 434 and 124 counts and give seeds for the package numbers.
4. Fix 2, alternatives and cost. Closable now: text (keep-main, flag, JS reset, separate path, POS axes; the
   7.2 against 7.3 us projection timing).
5. Fix 2, real-capture effect. Closable now as text from the issue draft's own table (labelled private,
   modest, 20 of 35 better). A shareable real-capture check is not closable here.
6. Fix 2, PR head. Use the squashed pr/ ref as the head or drop the squash request. Owner's call (a push).
7. Issue, npm reproduction, band edges, user-visible severity, sweep code, fork mentions. Closable now: text
   plus attaching probe_c.rs.

Self-checks: the Rust probes assert a clean 90 bpm sine reads within 2 bpm and the sample count; both were broken
once and panicked (probes/audit_selfcheck.rs). No owner recording was used in this audit; real-capture numbers
quoted are the issue draft's, independently reproduced on 2026-10-11.

## Closed (2026-10-12, afternoon)

Preregistrations case/core2/prereg-1.md to prereg-4.md (written before each run; prereg 3 carries a timed addendum
where a self-check failed on the real data before any score was read), harnesses in case/core2/harness, raw output
in case/core2/results.

1. **Fused path not bit-identical: closed, for the change.** Test first: `pre_extracted_window_is_projected_as_before`
   (one 1.6 s window of R = G = B input must project to X + alpha Y bit for bit) was red on 021a870. Then the
   keep-main line; the non-test code equals the audited pipeline.keepmain.rs exactly (comments aside), so the
   audit's session numbers for it apply: 0 of 1,920 fused seconds differ from main, camera path identical to the
   branch in 48 of 48 runs. New seeded harness S2: 210 fused-only runs (70 rates x 14 s, 30 s, noisy) identical
   to main in bpm, confidence and snr bits; on 021a870, 198 of 210 differed (bpm never). Commit 06f93f6, pushed
   fast-forward to the fork (021a870..06f93f6) after elata-rppg 30/30 plus doctest, clippy and rustdoc -D
   warnings, rustfmt, elata-rppg-ffi, elata-rppg-wasm, elata-eeg-ffi and elata-eeg-wasm passed. pr/ ref
   regenerated: b527385 (tree 3373c25 = tip, parent 49fdb41, local). Merged onto a scratch copy of wip/all-fixes
   (scratch/c2/merge, 8fdcb11): clean, 30/30, clippy clean, ffi and wasm pass. merge-plan.md section 8.
2. **Camera path shows more wrong without a lamp: closed, in text.** The session table and the picker
   attribution are in fix2.md under "What gets worse, and why" with the 476/259, 140/39, 336/220 reading and a link
   to the picker issue. Sums re-derived from the audit's raw jsonl: identical.
3. **Counts with no harness: closed.** The 370 mixes, 434 interleavings and the 124-run trade are removed. In
   their place: colour_projection_counts.rs (public API, seeded, self-checks broken once each and seen to panic),
   run on main, 021a870 and 06f93f6; every number in fix2.md's table comes from it. 06f93f6 equals 021a870 in
   S1, S3 to S6 (keep-main touches no mixed window). Package numbers: "snr 110 to 5.45", "14 of 15" and "7 of 15"
   replaced by the seeded three-seed run of pkglamp.mjs on main's dist with main's WASM and with a WASM built from
   06f93f6: bpm at the pulse 15, 3, 14 of 15 against 0; snr 4.56/5.21/4.83 against 39.6/59.1/48.9; lamp 72 with no
   pulse shown 0, 2, 0 of 15 against 15 of 15. Scripts are in the PR text's details blocks. The per-sample "4 of
   62" count is dropped (no harness on any public tree); the red switch test carries that point.
4. **Alternatives and cost: closed.** "Considered" now lists plain flip, per-sample, X alone, explicit flag,
   JS reset on switch, a separate unnormalised path, and POS axes. POS axes was MEASURED as a scratch variant
   (prereg 4): S1 57/3/2, S3 and S4 equal, S6 427/75/56, S5 fewer right in every cell (by 3 to 10); on the 35
   captures 1,863 right of 4,230 shown (44.0%), 2,367 wrong, more right seconds than fix 2 in 24 captures and
   fewer in 9 (sign test p 0.01). The prereg rule (replace only if not worse on any synthetic section by more than
   2 runs) keeps it out of this PR; the text says it is the stronger follow-up candidate. Cost: get_metrics on
   fused windows 5.1 to 5.3 ms on both trees; on camera RGB 11.5 and 12.7 ms against 13.4 ms on main.
5. **Real-capture effect: closed as labelled private context.** Fix 2's exact code (06f93f6) on the 35 owner
   captures with a reference, every-whole-second judging, self-checks first (grey 90 within 2 bpm on both trees,
   chromatic 90 on the branch, row interval asserted; each broken once): main 1,523 right of 3,994 shown (38.1%),
   2,471 wrong; fix 2 1,630 of 4,030 (40.4%), 2,400 wrong; more right in 21, fewer in 12, equal 2 (p 0.16).
   Modest and not significant on its own; the PR says so.
6. **PR head: not closable here (owner's call, needs a push of the pr/ ref or a decision).** fix2.md is written
   for the recommended default, the one-commit head, and no longer asks Elata to squash.
7. **Issue: closed.** npm reproduction run on a clean 0.14.0 install as written (60 reads 66 at 0.99, 72 reads 48
   at 0.88, 90 reads 90, 140 none) and put in the issue; band edges stated (21 of 43 interior rates fail); a "What
   a user sees" section with the session table; the sweep code and a 29-line toggle patch attached, re-run on
   49fdb41 today: 448, 669, 698, 728 and every per-kind count exact; test-build and PulseCheck mentions removed
   or moved to a labelled aside; the real-capture paragraph now quotes fix 2's exact code instead of the test
   build's.

Not closed: a shareable real-capture check for fix 2 (no licensed public data in this container), and the
session-level DemoRunner numbers depend on a script that needs main's built dist and a wasm-bindgen pkg (given in
the PR text, not runnable from the PR alone).
