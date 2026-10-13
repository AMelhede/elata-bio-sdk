# The test build: @amelhede/rppg-web 0.15.0-test.17 to test.21

The build testers install. Every fix in it is behind its own switch (`fixes: { name: false }` turns one off;
`fixes: false` gives the published 0.14.0 behaviour). Its built files are committed on this branch under
`packages/rppg-web` (at test.21, 84ff8b2), so the scripts in `../proposals/` can run against it without a build.
test.20 and test.21 read the same as test.19 on the 48 known-answer runs at the defaults (see their notes).

- [test21-build.md](test21-build.md): test.21, the current candidate. The four dim-light rules (all off) and the
  pulse-check input recording with replay. Built on 6084d8d.
- [test21-audit.md](test21-audit.md): its audit. Ready to publish from `release/test-1` 84ff8b2; tarball sha256
  b5a6bd5e... (replaces 1ba55105...). create-elata-demo 0.12.2-test.4 (e3e44c3) pins its starters to test.21. Not
  published.
- [test20.md](test20.md): test.20, built and audited (face flicker constant 10 to 7, rgbPulse grey-frame rule).
- [test19-audit.md](test19-audit.md), [test18-audit.md](test18-audit.md), [test17-audit.md](test17-audit.md): the
  three before it.
- [behaviour-diff.md](behaviour-diff.md): what changes for an app moving from 0.14.0 to the test build (written for
  test.17).
- [pkg-tools.md](pkg-tools.md): publint, attw and npm audit on the package.
- [generator-build.md](generator-build.md): the starter generator built against the test build.

Paths named `scratch/` were temporary work folders, deleted after each audit.
