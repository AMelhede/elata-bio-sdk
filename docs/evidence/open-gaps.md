# Open gaps: what is not yet evidenced

Each line says what is missing, what would close it, and who can do it. "Testers" means the Elata team members testing the build
using the test build in their own apps. Most real-people gaps close at step 3 of the release path (README.md). Testers' own apps
need the test build on npm first; the strap study does not, because the demo page installs test.21 from its tarball.

## Across all signal changes

| Gap | What would close it | Who |
|---|---|---|
| No real-people evidence Elata can rerun. Every real-person number is either one person's own recordings (in-sample for the pulse check) or private | a chest-strap study: Polar H10 or equivalent, at least 30 paired readings across at least 10 people, spread of rates, scored per reading against the strap. **Status 2026-10-13: pending; no real strap file yet.** The scorer is ready ([tools/strap-score/](tools/strap-score/), self-checked on synthetic examples); readings are taken with the demo app (its Save readings file, on the demo app's `chore/demo-test-19` branch; its `main` is still 0.14.0 with no button), no npm release needed. Since 2026-10-13 the page is on test.21 and that file is JSON holding the pulse check's inputs too, so the four dim-light candidates are replayed on the same captures (`strap-score --replay`, the preferred route in "Strap study, fixed in advance"; that section is unchanged). The replay is checked: on generated faces the saved file gave back every number the page showed, and a file that does not is refused and listed. Testers must save within 10 minutes of opening the page, or the start of the recording is let go and that file can be scored only as shown, not replayed. The file holds skin colour over time, which carries the pulse, so it is the tester's own data. One tester has a strap. The bars below ("Strap study, fixed in advance") are written before any real file exists | the testers |
| One webcam, one person behind the [owner] numbers | the same study on the testers' own cameras and phones | testers |
| Darker skin and other ages not covered anywhere | recruit and record with a skin-tone measure | Andreas, with the testers |
| The test build has not been run on a phone or a slow CPU since test.15 | open a tester app on two phones, log `RPPG_WEB_BUILD_VERSION` and the frame rate | testers |
| test.21 has run in browsers only on generated faces: on the demo page (a true 70 read 69 to 72 from 21 s; no pulse gave no number in 75 of 75 s; on the final tarball b5a6bd5e a saved file replays to the number shown in 77 of 77 seconds) and swapped into a private app, whose own camera tests pass as on test.20 (47 pass, 0 fail; its no-pulse test 4 of 4, its pulse test 2 of 2; run on the pre-audit tarball, which differs only on a bad recording length the app does not use) [synthetic]. No real camera, no phone. Its audit is done ([test-build/test21-audit.md](test-build/test21-audit.md)) | a real camera run | Andreas |
| The test build is not on npm, so testers cannot install it with one line (the demo page does not need it: it installs test.21 from its tarball) | publish `@amelhede/rppg-web@0.15.0-test.21` with the `test` tag, then `@amelhede/create-elata-demo@0.12.2-test.4`, whose starters pin it (audited; both release checks print ready on e3e44c3, tarball sha256 b5a6bd5e...) | Andreas (his decision) |

## Per change

| Change | Gap | What would close it | Who |
|---|---|---|---|
| 1. No face, no reading | **1 s against 2 s: decided 2026-10-12, the PR holds 2 s** (`fix/no-face-no-reading` 55de1a7, one-commit ref 8dde554). On a synthetic face (180 runs: turns, nods, fast movement and still faces; true 60, 72, 100; face lost 0.3 to 5 s) wrong / right seconds were 1083 / 2917 on main, 539 / 3177 with 1 s, 388 / 3428 with 2 s, almost all from losses of 1 to 2 s; holding the number back 3 to 12 s after a 1 s restart lost more right seconds than it saved. **Still open: real people moving.** [owner] 1 of 20 real face-loss moments fell between 1 and 2 s | captures of real people moving, turning, leaving: whether 2 s holds up on them, and how often losses fall between 1 and 2 s | testers |
| 1. No face, no reading | the test build (`release/test-1`, test.21) still carries the 1 s hold. **Not changed in test.20 or test.21**: with its pulse check on (the default) the test build showed 0 wrong seconds in the same 180 runs (measured on test.19; test.20 changes only the face flicker ratio and an rgbPulse rule that is off by default, test.21 only adds switches that are off), at the cost of a blank of median 18 s after a restart | move it to 2 s at the next test build, with the 180 runs rerun on that build | Andreas |
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
| 13. Calibration blend | opt-in, so apps gain only if they set it. [owner] on Elata main with fix 4 a clear gain: 1,895 to 2,282 right seconds (37 better, 8 worse, p under 0.001), with fixes 4 and 5 1,964 to 2,265 (38 better, 11 worse). **What takes its value is now known (2026-10-13, pre-registered): fix 3.** Adding fix 3 to Elata main with fixes 1 and 4 leaves the option no gain (1,942 to 2,015, 25 better, 21 worse, p 0.66), and switching fix 3 off in our test build brings the gain back (1,902 to 2,114, 30 better, 15 worse, p 0.04); with fix 3 the blend is right about as often as the resolved rate. That explains the test build's no-gain pair (2,094 with the blend, 2,047 with the option). Fix 3 is held, so the option keeps its value in the first round; if fix 3 returns, fix 13 can be dropped or kept as harmless. One person, in-sample | the chest-strap study; re-measure fix 13 if fix 3 comes back | testers |
| Issue 1. Picker | removing the picker does not yet help real captures | find what else must change first | open question |
| Pulse check | its 10% bar failed on the owner's recordings (16.3%). Where the misses sit, found after looking [owner]: none at double or half the rate, none on a wall flicker or a head movement; median 8 bpm off. Recordings the owner named dark or dim: 69 wrong of 217 shown (31.8%); the rest 58 of 560 (10.4%), and 36 of 530 (6.8%) without the two of those whose reference is documented as taken at another time. So it is mainly a dim-light problem, and that split was chosen after looking. Four candidate rules are built behind switches, all off, with settings fixed below before any strap file; they are in test.21 (b528a8b, the same source as c98cf18); none is shown to work yet (in-sample, the best single rule takes dim wrong seconds from 69 to 61) | the chest-strap study on new people, with a dim-light condition, scored against the bars below | testers |
| Pulse check | **why 10 of 50 recordings get no number, and what the 48.6 s median wait is made of: answered 2026-10-13** [owner, in-sample, described, nothing tuned; pre-registered]. The 10 are right to have none: in them the check's own windows pointed within 5 bpm of the reference only 9 times in 100 (median; 36 in 100 in the 40 that got a number), and 0.14.0 was right in 109 of 1,230 of the same seconds. The cause is light, not rate: 8 of the 10 are named dark or dim, the camera had slowed itself for low light, and no reference in the 50 is under 58 bpm. One near miss: a short recording whose right run missed the strength bar by 0.13 dB. Of the wait, 18.6 s (median) is the method itself (the first 16 s window plus the proving run); the other 29.1 s is windows a rule refused or runs that broke, and those windows were more than 5 bpm off in 550 of 640 and 297 of 485. Pure waiting is small (extra proving windows: 0 s median, 3.1 s at the 90th percentile). Proving earlier is not free: a run was wrong in 41 of 100 at 4 windows against 20 of 100 at 8 | still open: a faster or fuller result in dim light needs a better dim-light signal, not a shorter wait; no candidate is measured. Head rows are not in these recordings, so the head rule is untested on them | signal-path work, later |
| Pulse check | no branch cut onto Elata main; about 2,000 lines. A split plan is written ([proposals/pulse-check/split-plan.md](proposals/pulse-check/split-plan.md): one issue and five code PRs, each with its own test and evidence) but nothing is cut | cut step 2 of the plan from 49fdb41 and rerun the known answers on it | Andreas (signal-path work) |
| Pulse check | no real filmed lamp or head nod | film a flickering lamp and a nod with a pulse present and absent | Andreas or testers |
| Pulse check | face flicker constant: **changed from 10 to 7 in test.20** (585d2dd). Basis: the synthetic lamp sweep, which anyone can rerun (a lamp whose colour part is 0.1 of its brightness swing was shown in 35 to 40 of 60 s at 10, and never at 7, three seeds). The owner recordings served only as a cost check: the same 650 right and 127 wrong seconds at 7 and 10, so 0 right seconds lost. No private data decides it | carry 7 into the re-cut, with its test (`pulseCheckFaceFlicker`) | at re-cut |
| Pulse check | **lamp limit.** With no wall in view, a lamp whose colour change looks like blood (also green, red, or opposite to blood) is shown in about 42 of 60 s at every colour strength tried. Measured 2026-10-12: three pre-registered rules (angle to the blood colour direction, spread in amplitude across face regions, spread in timing across face regions) all failed; a fourth, chosen after looking (timing spread on the dominant colour), caught every synthetic lamp but brings the lamp back once the cheeks are read 8 ms after the forehead (rolling shutter), and it also withholds the repo's own synthetic pulses, which have no timing spread. **Round 3, 2026-10-13 (pre-registered): no timing rule exists, so the hole stays a stated limit.** With realistic delays on both sides, from published numbers (blood: the forehead pulses up to 20 degrees after the cheeks, as little as 1 to 5 degrees in some people; a rolling-shutter camera reads the cheeks 2 to 9 ms after the forehead, up to 12 ms across an upright phone), a lamp already shows 2 to 10 degrees of timing spread and blood can show less. Three bars fixed in advance (4 degrees, 7 degrees, 10 ms) each let lamps through (24 to 93 of 192 lamp settings still shown) and withheld real pulses (25 to 34 of 66 blood settings lost more than 1%); no bar in between does better [synthetic] | timing spread alone is a dead end: it would need the camera's real readout time (a web page cannot read it) or a lower limit on blood's spread across many people (no published source). Still open: sample non-skin pixels inside the face (hair, brows), which a lamp lights and blood does not, with its cost measured first; and film a real flickering coloured lamp with no wall in view, to see whether the hole matters in practice | Andreas (footage), then signal-path work |
| Pulse check | HRV and breathing withheld while on; withholding is a product call | Elata's call | Elata |
| Pulse check | **owner decision for our second private app (the recovery app, still on 0.12.0).** Its recovery score runs on the SDK's HRV, which test.21 withholds while the pulse check is on, and which read several times too high against an ECG. Options: (a) keep the check on and withhold HRV, as the first private app already does; (b) turn the check off to keep HRV, which also drops what test.21 is for; (c) read HRV from `getExperimentalVitals()`, which the SDK labels research only. **Recommended: (a) withhold**, because an HRV that failed its known answer should not be shown. The app's port list records the owner choosing withhold on 2026-10-13; the port itself is not started and waits for his go. Before any swap it needs the colour-pulse test fixture and the no-pulse and pulse tests ported, so a before number exists | the owner's go, then the same swap lane the first app ran | Andreas |
| Pulse check | needs a face mesh, which Elata's quick start turns off | closed 2026-10-14: packages/rppg-web/README.md says so ("The pulse check needs face tracking", with `diagnostics.faceTrackingMode` and `pulseCheck: false` as the way out) | done |
| Lamp study | the 3% lamp result had no packaged reproduction | closed 2026-10-14: proposals/pulse-check/wall-lamp.mjs. A 3% lamp on a grey wall reads 26.4 to 27.0 dB at 0.1 DN frame noise and 24.0 to 25.0 dB at 0.3 DN (3 seeds, test.21), against the 12 dB bar. Limit it shows: a 0.5% lamp reads 12.0 to 12.6 dB, on the bar, and at 3 DN frame noise even a 3% lamp reads 7 to 8 dB, under it. The bar holds for a wall patch averaged over many pixels; a small or noisy patch is not covered | done |

## Strap study, fixed in advance

Written 2026-10-12, before any real strap file exists; the git date of this section is its timestamp. Change it only
before the first real file is opened, and say so in the commit.

- **What is scored.** The pulse-checked rate the demo app shows (its Save readings file), once per second, against
  the strap's 5 s mean rate computed from its RR beat times, with `strap-score` as it is on this branch. Results are
  split by `library_version`.
- **The strap records beat times (RR intervals), not only heart rate.** Added 2026-10-13, before any real strap
  file exists. Use Polar Sensor Logger's RR file, HRV Logger, or any app that exports RR; a Polar Flow session export
  holds only a per-second heart rate and is not enough. Why: Elata's perception lab (2026-10-07 report) found a
  Polar H10's own per-second heart rate within 5 bpm of the same strap's ECG only about 302 of 419 times (median gap
  2.72 bpm), while its RR beat times matched the ECG to about 1 ms; a right answer that is itself off by half the
  5 bpm bar cannot judge the page. `strap-score` refuses a heart-rate-only file; scored anyway with
  `--allow-strap-hr`, every line says "weaker reference (strap HR, not beat times)", and such a file is reported,
  never counted toward the bars or the candidate rule below. If beats are ever taken from a raw ECG instead, check
  the beat finder first: a simple one can count the T wave (the heart's recovery bump after each beat) as a second
  beat, which shows as intervals that alternate short and long or halve the neighbouring ones. `strap-score`'s
  artefact rule (an interval more than 20 percent from its neighbours is dropped and counted) catches that pattern;
  a file with more than 5 in 100 beats dropped is checked by eye before it is scored.
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
