# test.21: build notes

`@amelhede/rppg-web` 0.15.0-test.21, built 2026-10-13 on `release/test-1` (2a05313..6084d8d, pushed fast-forward).
Not published. Tarball sha256 1ba551055c2fd611d1208a98ac8c3d3bc1d8bc01098c3baccdfdd6a18a2e116f (165 files, 3 more
than test.20: `dist/pulseCheckRecording.*`). **The audit of test.21 is pending**; until it is written, these are the
builder's own notes.

## Bottom line

1. **Four dim-light rules are in, all off.** With them off, test.21 behaves exactly like test.20.
2. **New: an app can save exactly what the pulse check saw**, and replay it later with any rule switched on. So the
   strap study can judge all four rules on the same seconds, from one capture per person.
3. One thing was broken and is fixed: the release checker still expected every rule on, so it failed. Fixed in
   6084d8d.

## What is in it

| commit | what |
|---|---|
| b528a8b, c086417 | the four dim-light candidates (`followerMedian`, `reproveOnDrift`, `tooDark`, `anchorDrift`), each a `pulseCheckRules` switch, off by default. Source byte-identical to `night/dim-candidates` c98cf18. Settings: [../open-gaps.md](../open-gaps.md), "Strap study, fixed in advance" |
| a8f3e77, 8be730d | `recordPulseCheckInputs: true \| { seconds }` (off by default): records every input the pulse check gets, in order. `serializePulseCheckRecording` writes it as JSON; `replayPulseCheck(recording, { rules })` runs the same check code on it |
| 3612948, 6084d8d | version, and the release checker fixed to expect the candidates off |

## Evidence

- **Off equals test.20** [synthetic]. 48 known-answer pairs and 13 rgbPulse pairs: every field of every
  per-second read identical.
- **Off equals test.20** [owner]. 51 owner files (the 50 with a reference, plus one without): at every one of
  7,555 evaluations the check's state is equal, field for field. The state gains six diagnostic keys and nothing
  else. With `followerMedian` on, 31 of the 51 change, so the comparison does reach the rules.
- **The recording gives back what was shown** [synthetic]. Every pulse-check run of the suite (21 runs), recorded,
  saved, read back and replayed: all 6,340 reads given back (3,062 with a rate), none different, none dropped.
  Recording on or off gives identical reads.
- **Tests first.** The new test file was red (module missing), then green: 20 tests. Each recorded field removed in
  turn turned at least one test red.

## Cost

- Recording off: none of the new code runs.
- Recording on, 30 frames a second: 5 minutes is 18,000 events, about 7 MB held and 3.6 MB of JSON. It keeps the
  newest 300 s; older events are dropped. A recording that lost its start replays as a check that began at its
  first kept event, so its first numbers can differ.
- A saved file holds skin colour over time, which carries the pulse. It is the person's own data.

## Gates on 6084d8d

83 suites, 827 tests pass (test.20: 785). tsc and lint clean. The build reproduces the committed dist. Both release
checks ready. verify-test-release passes, with a new check: replays give back 43 seconds at 72, and a head nod
replayed with `headMotion` off shows the same 43 seconds at 60 as a live check. npm dry run ready; publint clean;
attw the same single CJS warning as before.

## Not run yet

npm 11 dry run, a CRLF clone, the packed starter matrix, a Vite consumer build, a real camera, a swap into a private
app. The test.21 audit is expected to run them. None of the four dim rules is shown to help; only the strap study can
say.
