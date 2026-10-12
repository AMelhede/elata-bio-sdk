# Open gaps: what is not yet evidenced

Each line says what is missing, what would close it, and who can do it. "Testers" means Kyle, Namkhai and Alexander
using the test build in their own apps. Most real-people gaps close at step 3 of the release path (README.md), which
needs the test build published on npm first.

## Across all signal changes

| Gap | What would close it | Who |
|---|---|---|
| No real-people evidence Elata can rerun. Every real-person number is either one person's own recordings (in-sample for the pulse check) or private | a chest-strap study: Polar H10 or equivalent, at least 30 paired readings across at least 10 people, spread of rates, scored per reading against the strap | testers and Andreas, with a strap each |
| One webcam, one person behind the [owner] numbers | the same study on the testers' own cameras and phones | testers |
| Darker skin and other ages not covered anywhere | recruit and record with a skin-tone measure | Andreas, with the testers |
| The test build has not been run on a phone or a slow CPU since test.15 | open a tester app on two phones, log `RPPG_WEB_BUILD_VERSION` and the frame rate | testers |
| test.19 has had no browser run and no swap into a private app | swap it in, run the app's own camera tests | Andreas |
| The test build is not on npm, so testers cannot install it with one line | publish `@amelhede/rppg-web@0.15.0-test.19` with the `test` tag (both release checks print ready) | Andreas (his decision) |

## Per change

| Change | Gap | What would close it | Who |
|---|---|---|---|
| 1. No face, no reading | the 1 s hold is measured on still people only | captures of people moving, turning, leaving | testers |
| 2. Core sign | no shareable real-capture check; [owner] gain modest and not significant (p 0.16) | the chest-strap study with the camera-colour path on and off (`colourProjectionFix`) | testers |
| 2. Core sign | the session-level script needs a built dist plus a wasm-bindgen pkg | package the WASM build as one script | Andreas or an Elata maintainer |
| 3. Real frame rate | "fewer numbers, right more often" was seen after the fact | a pre-registered test on recordings nobody has looked at | testers' new recordings |
| 3. Real frame rate | the quality test lives only on the merged tree | land after fix 4, then add the test | at PR time |
| 4. POS in the fuser | breathing under POS has no known answer | a breathing-modulated synthetic fixture, then a real reference | Andreas |
| 4. POS in the fuser | default against opt-in | Elata's call | Elata |
| 5. No doubling | gains on real captures appear only with fix 13 | the chest-strap study with both switches | testers |
| 6, 7, 8. Tooling | PowerShell or cmd as the outer shell, Intel macOS, pnpm 9 and 11, BWK and BusyBox awk not run | one run on each | anyone with that machine |
| 8. Peer ranges | npm install of the EEG and PPG starters can only be shown fixed after fixed packages are published | publish, then rerun `repro.sh` | Elata |
| 9. Monitor timers | Firefox and Safari not run | open `index.html` in each | anyone |
| 10. Load errors | root-relative default URLs | a follow-up change | later |
| 11. Colour path | the band-pass corner reads 54 to 56 for a true 50 in 3 of 10 seeds; turning it on by default needs a gate (`confidence` 0.7 was a lead, not planned in advance) | a pre-registered test of the gate | Andreas, then review |
| 12. Fallback | none for code (withdrawn); the issue still has to be filed | file it | at step 5 |
| 13. Calibration blend | adds nothing on real captures once 4 and 5 are in | the chest-strap study | testers |
| Issue 1. Picker | removing the picker does not yet help real captures | find what else must change first | open question |
| Pulse check | its 10% bar failed on the owner's recordings (16.3%) | the chest-strap study on new people, with the bar fixed in advance | testers |
| Pulse check | no branch cut onto Elata main; about 2,000 lines with no split plan | re-cut from `release/test-1` onto 49fdb41, split into reviewable parts | Andreas (next session, signal-path work) |
| Pulse check | no real filmed lamp or head nod | film a flickering lamp and a nod with a pulse present and absent | Andreas or testers |
| Pulse check | face flicker constant: 7 measured better than 10 | confirm on private development data, then change it | Andreas |
| Pulse check | with no wall in view, lamps with a colour part of 0.15 or more get through | a rule that does not need the wall, then a fixture | open question |
| Pulse check | HRV and breathing withheld while on; withholding is a product call | Elata's call | Elata |
| Pulse check | needs a face mesh, which Elata's quick start turns off | say so in the README, or make it work without landmarks | at PR time |
| Lamp study | the 3% lamp result has no packaged reproduction here | package the lamp scene as a script in this folder | Andreas |

## Process gaps

- The `pr/*` one-commit refs are local. Until they are pushed, a reviewer can only see the working branches, some of
  whose first commits (fixes 1, 3, 4, 5) name a private collection or quote private numbers. Pushing them is
  Andreas's call.
- The merge plan predates the final verdicts (it still lists fix 12).
- Pre-registration is self-attested: dated files written before each run, in the private working folder.
