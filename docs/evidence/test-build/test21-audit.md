# test21-audit: publish readiness of @amelhede/rppg-web 0.15.0-test.21 and @amelhede/create-elata-demo 0.12.2-test.4

Date 2026-10-13. Audited `release/test-1` at 6084d8d (the build, [test21-build.md](test21-build.md)). Five commits
added on top (303c269, 610c429, 6e7a5ca, 8d74cc2, 84ff8b2), pushed fast-forward 6084d8d..84ff8b2 after the release
scrub printed ready. Then create-elata-demo test.4 (e3e44c3), pushed fast-forward from 84ff8b2. Nothing published, no
PR, nothing sent to Elata. Checks were written down before they ran. Work folders under `scratch/`, deleted after.

## Verdict

Ready to publish: yes, both, from e3e44c3. rppg-web first, then create-elata-demo (its `--publish` check refuses today
only because rppg-web 0.15.0-test.21 is not on npm yet).

**The tarball changed.** `amelhede-rppg-web-0.15.0-test.21.tgz`, sha256
b5a6bd5efb363dfca4f76e828de7354a7863e99e97d5561f052d201d413242b5 (165 files), replaces 1ba55105... at the same
version. Against the old one only README.md, `dist/rppgSession.js` (and its map) and `dist/source-stamp.json` differ.
Behaviour differs only when an app passes a bad `recordPulseCheckInputs` length.

## What the audit found and fixed

1. **A bad recording length left things running.** `recordPulseCheckInputs: { seconds: 0 }` (or negative, or NaN)
   threw only after the session had loaded the face finder and started the engine, and the app got no session back
   to shut them down. Now checked first (610c429). Test first: red, then green.
2. **anchorDrift's "evidence starts over" had no test.** Keeping the old windows after an end left every test green.
   New test (303c269): after an end, no rate for at least 4 s. Red with that break.
3. **The session's `{ seconds }` had no test.** New test: 42 reaches the recording, `{}` and `true` give 300, off gives
   a plain check. Red with that break.
4. **Docs.** tooDark also withholds while any of the newest 4 windows found no line (README and changeset said only
   "mean SNR below -4 dB"). Its cost on real captures is now given as a ratio (about three right seconds removed per
   wrong one), not counts, since the release scrub refuses measured counts in the package. A re-proof takes 8 windows,
   4 when the line is strong, 16 in the dark path.

## Checks

- **Each change taken out alone:** 28 breaks; 26 red at first, the other 2 red with the new tests above.
- **Everything new off equals test.20.** Known answers [synthetic]: all 48 runs and all 13 rgbPulse runs, every
  per-second field the same. A recording replayed gave back all 6,340 reads, 0 different, 0 dropped. Owner files
  [owner]: the check's state equal at every evaluation, with the recording on or off.
- **Recording cost:** memory levels off (about 7 MB held at 30 frames a second); time per push within noise.
- **Gates on 84ff8b2:** 83 suites, 830 tests (also on a CRLF clone); tsc and lint clean; release scrub ready;
  verify-test-release passes and fails on each of its breaks; npm 10 and 11 `publish --dry-run --tag test` ready;
  publint clean; attw the same single CJS warning; a consumer install has 0 vulnerabilities and loads the WASM.

## In apps, on generated faces [synthetic]

- **Demo page, final tarball.** A saved file from the page on b5a6bd5e replays to the number shown in 77 of 77 seconds.
  Earlier runs on 1ba55105: a true 70 read 69 to 72 from 21 s; no pulse gave no number in 75 of 75 s.
- **A private app's own camera tests** pass as on test.20: 47 pass, 0 fail; its no-pulse test 4 of 4, its pulse test
  2 of 2. That lane ran on 1ba55105; the only change since is the bad-length path, which the app does not use.

## create-elata-demo 0.12.2-test.4 (e3e44c3)

Only package.json changes: the version, and the starters' `rppgWeb` pin moves from test.19 to
`npm:@amelhede/rppg-web@0.15.0-test.21`. Release check ready (5 templates); node:test 32 of 32; tarball sha256
1d086a79edecea8be8d5d1076fc046a8f6db0a004e460da1b3428ce9a0c1ca0c (72 files), against test.3 only the version and the pin
differ; publint clean. The three starters that use rppg-web, scaffolded from the packed CLI and built with npm 10,
pnpm 9 and pnpm 12: 9 of 9 pass every step, 0 vulnerabilities, and each installed the exact test.21 tarball.

## Left, and why

- `getBuildSwitches()` does not say whether recording is on. It changes no output.
- A replay given `{ rules: { tooDark: true } }` resets every other rule to its default, not to the recording's own.
  Documented. The strap scorer names all four candidates in every arm and refuses a file whose page ran other rules
  than the default, so it is not affected.
- A bad clock keeps up to the event cap rather than 5 minutes. Memory stays bounded.
- Not run: a real camera, a phone, a Windows machine (a CRLF clone instead).
