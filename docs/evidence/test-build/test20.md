# test.20: build and audit, in short

`@amelhede/rppg-web` 0.15.0-test.20, built and audited 2026-10-12 on `release/test-1` (c85bc9b..2a05313). Not
published. Tarball sha256 57219ee28e34f88e6bd58e00037389de73e03c44ddad3c79e01e9a6d1b0dbcda.

## What changed against test.19

1. **Face flicker constant 10 to 7** (585d2dd). With no wall in view, a rate the face carries far more in brightness
   than in colour is withheld. A 2% lamp at 90 bpm, no pulse, three seeds, seconds shown of 60 [synthetic]:

   | lamp colour part | test.19 (10) | test.20 (7) |
   |---|---|---|
   | 0.05, 0.08 | 0, 0, 0 | 0, 0, 0 |
   | 0.10 | 40, 35, 40 | 0, 0, 0 |
   | 0.12 | 42, 42, 42 | 0, 0, 0 |
   | 0.15 | 42, 42, 42 | 42, 42, 42 (only the wall rules see it) |

   Cost check [owner]: on the 50 recordings with a reference, 650 right and 127 wrong seconds at both 7 and 10.
   The test pins a bar below about 9.5, so it cannot tell 7 from 8 or 9; 8 and 9 were never measured.
2. **rgbPulse grey-frame rule** (off by default). One clipped grey frame no longer poisons the processor's colour
   window: after one white frame at 10 s, a true 50, 72 or 120 goes from 0 to 5 right seconds of 24, to 24 of 24
   [synthetic]. Limit: a clipped frame before
   the first colour sample still poisons it (pinned by a test and named in the README).

## Audit

- Each change taken out alone turns its own tests red.
- Every per-second read on the 48 known-answer pairs and 13 rgbPulse pairs is identical to test.19 [synthetic].
- Fixed in the audit (a0f21bb, 2a05313): one wrong figure in a changeset (88.7 to 90.7, not 90.0), two claims
  narrower than written, two costs not named. Docs and one test only.
- Gates: 81 suites, 785 tests; tsc and lint clean; both release checks ready; publint clean; npm dry run ready.
- Not run: a real camera, Vite production builds, the packed starter matrix.
