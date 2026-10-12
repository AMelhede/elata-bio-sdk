# The test build: @amelhede/rppg-web 0.15.0-test.17 to test.19

The build testers install. Every fix in it is behind its own switch (`fixes: { name: false }` turns one off;
`fixes: false` gives the published 0.14.0 behaviour). Its built files are committed on this branch under
`packages/rppg-web`, so the scripts in `../proposals/` can run against it without a build.

- [test19-audit.md](test19-audit.md): test.19, the current candidate. Verdict: ready to publish. Each change read
  against its source and proven red when taken out alone; 48 paired runs identical to test.18 at the defaults.
- [test18-audit.md](test18-audit.md), [test17-audit.md](test17-audit.md): the two before it.
- [behaviour-diff.md](behaviour-diff.md): what changes for an app moving from 0.14.0 to the test build.
- [pkg-tools.md](pkg-tools.md): publint, attw and npm audit on the package.
- [generator-build.md](generator-build.md): the starter generator built against the test build.

Paths named `scratch/` were temporary work folders, deleted after each audit.
