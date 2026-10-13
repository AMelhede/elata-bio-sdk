# Open gaps: what is not yet evidenced

Each line says what is missing, what would close it, and who can do it. "Testers" means the Elata team members testing the build
using the test build in their own apps. Most real-people gaps close at step 3 of the release path (README.md), which
needs the test build published on npm first.

## Across all signal changes

| Gap | What would close it | Who |
|---|---|---|
| No real-people evidence Elata can rerun. Every real-person number is either one person's own recordings (in-sample for the pulse check) or private | a chest-strap study: Polar H10 or equivalent, at least 30 paired readings across at least 10 people, spread of rates, scored per reading against the strap. **Status 2026-10-12: pending, not started.** The scorer is ready ([tools/strap-score/](tools/strap-score/), self-checked on synthetic examples); readings are taken with the demo app (its Save readings file, on the demo app's `chore/demo-test-19` branch; its `main` is still 0.14.0 with no button), no npm release needed. Since 2026-10-13 the page is on test.21 and that file is JSON holding the pulse check's inputs too, so the four dim-light candidates are replayed on the same captures (`strap-score --replay`, the preferred route in "Strap study, fixed in advance"; that section is unchanged). One tester has a strap. The bars below ("Strap study, fixed in advance") are written before any real file exists | the testers |
| One webcam, one person behind the [owner] numbers | the same study on the testers' own cameras and phones | testers |
| Darker skin and other ages not covered anywhere | recruit and record with a skin-tone measure | Andreas, with the testers |
| The test build has not been run on a phone or a slow CPU since test.15 | open a tester app on two phones, log `RPPG_WEB_BUILD_VERSION` and the frame rate | testers |
| test.19 has had no browser run and no swap into a private app | swap it in, run the app's own camera tests | Andreas |
| The test build is not on npm, so testers cannot install it with one line | publish `@amelhede/rppg-web@0.15.0-test.19` with the `test` tag (both release checks print ready) | Andreas (his decision) |

## Per change

| Change | Gap | What would close it | Who |
|---|---|---|---|
| 1. No face, no reading | **1 s against 2 s: decided 2026-10-12, the PR holds 2 s** (`fix/no-face-no-reading` 0b60181). On a synthetic face (180 runs: turns, nods, fast movement and still faces; true 60, 72, 100; face lost 0.3 to 5 s) wrong / right seconds were 1083 / 2917 on main, 539 / 3177 with 1 s, 388 / 3428 with 2 s, almost all from losses of 1 to 2 s; holding the number back 3 to 12 s after a 1 s restart lost more right seconds than it saved. **Still open: real people moving.** [owner] 1 of 20 real face-loss moments fell between 1 and 2 s | captures of real people moving, turning, leaving: whether 2 s holds up on them, and how often losses fall between 1 and 2 s | testers |
| 1. No face, no reading | the test build (`release/test-1`, test.20) still carries the 1 s hold. **Not changed now**: with its pulse check on (the default) the test build showed 0 wrong seconds in the same 180 runs (measured on test.19; test.20 changes only the face flicker ratio and an rgbPulse rule that is off by default), at the cost of a blank of median 18 s after a restart | move it to 2 s at the next test build, with the 180 runs rerun on that build | Andreas |
| 2. Core sign | no shareable real-capture check; [owner] gain modest and not significant (p 0.16) | the chest-strap study with the camera-colour path on and off (`colourProjectionFix`) | testers |
| 2. Core sign | the session-level script needs a built dist plus a wasm-bindgen pkg | package the WASM build as one script | Andreas or an Elata maintainer |
| 3. Real frame rate | **held from the first round.** "Fewer numbers, right more often" was seen after the fact | a pre-registered test on recordings nobody has looked at | testers' new recordings |
| 3. Real frame rate | the quality test lives only on the merged tree | land after fix 4, then add the test | at PR time |
| 4. POS in the fuser | breathing under POS has no known answer | a breathing-modulated synthetic fixture, then a real reference | Andreas |
| 4. POS in the fuser | default against opt-in | Elata's call | Elata |
| 5. No doubling | **no measured gain on real captures** [owner]: on Elata main with fix 4, 1,895 against 1,964 right seconds of 6,679 at the defaults (23 recordings better, 18 worse, sign test p 0.53), and 2,282 against 2,265 with fix 13's option (17 better, 20 worse); its claim is synthetic and HRV only | the chest-strap study with the switch on and off | testers |
| 6, 7, 8. Tooling | **Windows, macOS (arm64) and Linux on Node 20 and 22: closed** ([audits/cross-os.md](audits/cross-os.md), nothing passes on main and fails with the fixes). Still not run: PowerShell or cmd as the outer shell, Intel macOS, pnpm 9 and 11, BWK and BusyBox awk | one run on each | anyone with that machine |
| 8. Peer ranges | npm install of the EEG and PPG starters can only be shown fixed after fixed packages are published | publish, then rerun `repro.sh` | Elata |
| 9. Monitor timers | Firefox and Safari not run | open `index.html` in each | anyone |
| 10. Load errors | root-relative default URLs | a follow-up change | later |
| 11. Colour path | the band-pass corner reads 54 to 56 for a true 50 in 3 of 10 seeds; turning it on by default needs a gate (`confidence` 0.7 was a lead, not planned in advance) | a pre-registered test of the gate | Andreas, then review |
| 12. Fallback | none for code (withdrawn); the issue ([proposals/12-no-engine-fallback/issue.md](proposals/12-no-engine-fallback/issue.md)) still has to be filed | file it | at step 5 |
| 13. Calibration blend | opt-in, so apps gain only if they set it. [owner] on Elata main with fix 4 a clear gain: 1,895 to 2,282 right seconds (37 better, 8 worse, p under 0.001), with fixes 4 and 5 1,964 to 2,265 (38 better, 11 worse). The earlier "adds nothing once 4 and 5 are in" (2,094 against 2,047) was measured on our test build (test.19), not on Elata main; which test.19 change absorbs the option's value is not known. One person, in-sample | the chest-strap study | testers |
| Issue 1. Picker | removing the picker does not yet help real captures | find what else must change first | open question |
| Pulse check | its 10% bar failed on the owner's recordings (16.3%). Where the misses sit, found after looking [owner]: none at double or half the rate, none on a wall flicker or a head movement; median 8 bpm off. Recordings the owner named dark or dim: 69 wrong of 217 shown (31.8%); the rest 58 of 560 (10.4%), and 36 of 530 (6.8%) without the two of those whose reference is documented as taken at another time. So it is mainly a dim-light problem, and that split was chosen after looking. Four candidate rules are built behind switches, all off, with settings fixed below before any strap file; none is shown to work yet (in-sample, the best single rule takes dim wrong seconds from 69 to 61) | the chest-strap study on new people, with a dim-light condition, scored against the bars below | testers |
| Pulse check | no branch cut onto Elata main; about 2,000 lines. A split plan is written ([proposals/pulse-check/split-plan.md](proposals/pulse-check/split-plan.md): one issue and five code PRs, each with its own test and evidence) but nothing is cut | cut step 2 of the plan from 49fdb41 and rerun the known answers on it | Andreas (signal-path work) |
| Pulse check | no real filmed lamp or head nod | film a flickering lamp and a nod with a pulse present and absent | Andreas or testers |
| Pulse check | face flicker constant: **changed from 10 to 7 in test.20** (585d2dd). Basis: the synthetic lamp sweep, which anyone can rerun (a lamp whose colour part is 0.1 of its brightness swing was shown in 35 to 40 of 60 s at 10, and never at 7, three seeds). The owner recordings served only as a cost check: the same 650 right and 127 wrong seconds at 7 and 10, so 0 right seconds lost. No private data decides it | carry 7 into the re-cut, with its test (`pulseCheckFaceFlicker`) | at re-cut |
| Pulse check | **lamp limit.** With no wall in view, a lamp whose colour change looks like blood (also green, red, or opposite to blood) is shown in about 42 of 60 s at every colour strength tried. Measured 2026-10-12: three pre-registered rules (angle to the blood colour direction, spread in amplitude across face regions, spread in timing across face regions) all failed; a fourth, chosen after looking (timing spread on the dominant colour), caught every synthetic lamp but brings the lamp back once the cheeks are read 8 ms after the forehead (rolling shutter), and it also withholds the repo's own synthetic pulses, which have no timing spread | film a real flickering lamp with no wall in view; give the synthetic pulse a realistic delay between regions and the synthetic lamp a row-time delay; then pre-register the timing rule with a bar fixed in advance | Andreas (footage), then signal-path work |
| Pulse check | HRV and breathing withheld while on; withholding is a product call | Elata's call | Elata |
| Pulse check | needs a face mesh, which Elata's quick start turns off | say so in the README, or make it work without landmarks | at PR time |
| Lamp study | the 3% lamp result has no packaged reproduction here | package the lamp scene as a script in this folder | Andreas |

## Strap study, fixed in advance

Written 2026-10-12, before any real strap file exists; the git date of this section is its timestamp. Change it only
before the first real file is opened, and say so in the commit.

- **What is scored.** The pulse-checked rate the demo app shows (its Save readings file), once per second, against
  the strap's 5 s mean rate, with `strap-score` as it is on this branch. Results are split by `library_version`.
- **Conditions.** Calm and seated in normal room light; seated in dim light (one lamp or less, no window light);
  after climbing stairs. At least 2 minutes each.
- **Primary bar.** Wrong (outside both 5 bpm and 10 percent) on at most 10 of every 100 shown seconds, pooled over
  everyone, and judged separately for normal light and for dim light. This is the same 10% the owner recordings
  failed; it is not loosened.
- **Reported, not judged.** Share of seconds with a number, time to first number, Bland-Altman bias and limits, and
  results per person (one person must not carry the pooled number).
- **Refused files** (no time overlap, lag not found) are counted and listed, never dropped silently. `--lag 0` is
  allowed only if stated per file.
- **Candidate rules for dim light, fixed 2026-10-12 before any strap file exists.** Built on branch
  `night/dim-candidates` (commit c98cf18, from test.20), each a `pulseCheckRules` switch, OFF by default, each with a
  test that goes red without its code. Settings, not to be changed once a strap file is opened:
  - `followerMedian`: the rate shown is the median of the last 3 follower values (`FOLLOWER_MEDIAN_K = 3`).
  - `reproveOnDrift`: a hold more than 6 bpm from its last fresh proof ends (`REPROVE_DRIFT_BPM = 6`).
  - `tooDark`: no rate while the newest 4 windows' mean SNR is below -4 dB (`TOO_DARK_SNR_DB = -4`).
  - `anchorDrift`: a run of shown rates ends, and the evidence starts over, once it moves more than 6 bpm from where
    it was first proven (`ANCHOR_DRIFT_BPM = 6`).

  How they were set: 3 and -4 dB on generated dim and lit faces by rules written before the run; 6 is the check's
  own agreement band. The generated faces did not reproduce the dim failure (the check stayed silent rather than
  wrong on them), so they could only choose the least costly setting, not show a gain. `reproveOnDrift` never acted
  on the owner's recordings [owner]; `anchorDrift` was designed after looking at one of them, so only this study can
  test it.
- **Each candidate is scored on the same seconds as the default.** The Save readings file holds only the number
  shown, so it cannot say what a switched-off rule would have shown. Either the page also saves the check's inputs
  (per-frame region colours, wall and head rows) and every arm is replayed offline on the same captures (preferred),
  or testers run the dim condition once per arm, alternating, and arms are compared per person. Without one of the
  two, no candidate can be judged and all stay off.
- **A candidate goes on by default only if**, alone, against the default on the same strap captures:
  1. at least 5 people have a dim-light capture and at least 600 dim seconds are shown by either arm (else: not
     decided, it stays off);
  2. in dim light its wrong seconds per 100 shown are lower than the default's, and the 95% interval of that
     difference (bootstrap over people, 2,000 resamples, seed 1) lies wholly above zero;
  3. in dim light it removes more wrong seconds than right ones;
  4. in normal light and after stairs, separately, its wrong per 100 shown is at most 1 point above the default's and
     its right seconds are at least 95 percent of the default's;
  5. rules 2 (the direction) and 3 still hold with any one person's files removed.

  Meeting the 10 per 100 bar in dim light is reported, not required. If more than one passes, the passers together
  go on only if the combination also passes 1 to 5 and its dim wrong share is within 1 point of the best single
  passer's; otherwise only the passer with the lowest dim wrong share goes on. Four candidates on one data set:
  rules 2 and 5 are the guard against a lucky pass. A pass turns the switch on in the test build only.

## Process gaps

- The `pr/*` one-commit refs are local. Until they are pushed, a reviewer can only see the working branches, some of
  whose first commits (fixes 1, 3, 4, 5) name a private collection or quote private numbers. Pushing them is
  Andreas's call.
- The merge plan was refreshed on 2026-10-12 for the final verdicts: eleven PRs in the first round, fix 3 held, fix
  12 as an issue; the eleven were merged as one tree and pass every rppg-web check.
- Pre-registration is self-attested: dated files written before each run, in the private working folder. From the
  strap study on, the bars are committed to this branch before any data is opened (above), so the date is public.
