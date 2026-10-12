# Open gaps: what is not yet evidenced

Each line says what is missing, what would close it, and who can do it. "Testers" means the Elata team members testing the build
using the test build in their own apps. Most real-people gaps close at step 3 of the release path (README.md), which
needs the test build published on npm first.

## Across all signal changes

| Gap | What would close it | Who |
|---|---|---|
| No real-people evidence Elata can rerun. Every real-person number is either one person's own recordings (in-sample for the pulse check) or private | a chest-strap study: Polar H10 or equivalent, at least 30 paired readings across at least 10 people, spread of rates, scored per reading against the strap. **Status 2026-10-12: pending, not started.** The scorer is ready ([tools/strap-score/](tools/strap-score/), self-checked on synthetic examples); readings are taken with the demo app (its Save readings file, on the demo app's `chore/demo-test-19` branch; its `main` is still 0.14.0 with no button), no npm release needed. One tester has a strap. The bars below ("Strap study, fixed in advance") are written before any real file exists | the testers |
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
| 5. No doubling | gains on real captures appear only with fix 13 | the chest-strap study with both switches | testers |
| 6, 7, 8. Tooling | **Windows, macOS (arm64) and Linux on Node 20 and 22: closed** ([audits/cross-os.md](audits/cross-os.md), nothing passes on main and fails with the fixes). Still not run: PowerShell or cmd as the outer shell, Intel macOS, pnpm 9 and 11, BWK and BusyBox awk | one run on each | anyone with that machine |
| 8. Peer ranges | npm install of the EEG and PPG starters can only be shown fixed after fixed packages are published | publish, then rerun `repro.sh` | Elata |
| 9. Monitor timers | Firefox and Safari not run | open `index.html` in each | anyone |
| 10. Load errors | root-relative default URLs | a follow-up change | later |
| 11. Colour path | the band-pass corner reads 54 to 56 for a true 50 in 3 of 10 seeds; turning it on by default needs a gate (`confidence` 0.7 was a lead, not planned in advance) | a pre-registered test of the gate | Andreas, then review |
| 12. Fallback | none for code (withdrawn); the issue ([proposals/12-no-engine-fallback/issue.md](proposals/12-no-engine-fallback/issue.md)) still has to be filed | file it | at step 5 |
| 13. Calibration blend | adds nothing on real captures once 4 and 5 are in | the chest-strap study | testers |
| Issue 1. Picker | removing the picker does not yet help real captures | find what else must change first | open question |
| Pulse check | its 10% bar failed on the owner's recordings (16.3%). Where the misses sit, found after looking [owner]: none at double or half the rate, none on a wall flicker or a head movement; median 8 bpm off. Recordings the owner named dark or dim: 69 wrong of 217 shown (31.8%); the rest 58 of 560 (10.4%), and 36 of 530 (6.8%) without the two of those whose reference is documented as taken at another time. So it is mainly a dim-light problem, and that split was chosen after looking | the chest-strap study on new people, with a dim-light condition, scored against the bars below | testers |
| Pulse check | no branch cut onto Elata main; about 2,000 lines with no split plan | re-cut from `release/test-1` onto 49fdb41, split into reviewable parts | Andreas (next session, signal-path work) |
| Pulse check | no real filmed lamp or head nod | film a flickering lamp and a nod with a pulse present and absent | Andreas or testers |
| Pulse check | face flicker constant: 7 measured better than 10 | confirm on private development data, then change it | Andreas |
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
- **Candidate rules** from the owner-recording miss analysis (smooth the 8 s follower; ask for a fresh proof when
  the shown rate moves more than 6 bpm from the proven one) may be tested on these files only if they are built as
  switches and their exact settings are written here before the first file is opened.

## Process gaps

- The `pr/*` one-commit refs are local. Until they are pushed, a reviewer can only see the working branches, some of
  whose first commits (fixes 1, 3, 4, 5) name a private collection or quote private numbers. Pushing them is
  Andreas's call.
- The merge plan was refreshed on 2026-10-12 for the final verdicts: eleven PRs in the first round, fix 3 held, fix
  12 as an issue; the eleven were merged as one tree and pass every rppg-web check.
- Pre-registration is self-attested: dated files written before each run, in the private working folder. From the
  strap study on, the bars are committed to this branch before any data is opened (above), so the date is public.
