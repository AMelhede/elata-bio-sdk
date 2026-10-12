# Fix 6: create-elata-demo crashes on start when run from npm

Branch: `AMelhede/elata-bio-sdk` `fix/create-elata-demo-starts`, tip fef0a51, eight commits on Elata
`main` 49fdb41 (60237d3, 2e3038f, 567a10e, 1da927f, 36caa88, b3e6d6f, 7deb183, fef0a51). Meant to be
squash-merged; suggested squash message at the end.

---

## Issue

**Title:** create-elata-demo 0.3.1 to 0.12.1 crash on start when run from npm

Every published version from 0.3.1 to 0.12.1 (the current `latest`) exits 1 before it parses any
argument:

```
$ npx --yes @elata-biosciences/create-elata-demo@0.12.1 --list-templates
Error: Missing packaged SDK version metadata for @elata-biosciences/app-metrics.
    at readVersion (.../create-elata-demo/index.mjs:115:9)
```

That covers every template, `--list-templates`, the default run and the interactive picker, through
`npx`, `npm create @elata-biosciences/elata-demo` and `pnpm dlx`. The 11 affected versions are 0.3.1,
0.5.1, 0.5.3, 0.7.1, 0.8.1, 0.9.1, 0.9.3, 0.9.4, 0.10.1, 0.11.1 and 0.12.1. 0.1.24 and earlier work.

**Cause.** `index.mjs` resolves five SDK versions as soon as it loads. For each it reads a sibling
`../<package>/package.json` if one exists, and otherwise the packaged `elataSdkVersions` in its own
`package.json`. An npm install has no siblings, so the packaged map is the only source.
670f038 (the pulse-game template) added the `appMetrics` read but not the packaged key, so:

```
$ npm view @elata-biosciences/create-elata-demo@0.12.1 elataSdkVersions
{
  eegWeb: '0.12.0',
  ppgWeb: '0.12.0',
  rppgWeb: '0.14.0',
  eegWebBle: '0.12.0'
}
```

Inside the monorepo a sibling `packages/app-metrics` always exists, and so does a project that happens
to have `@elata-biosciences/app-metrics` installed next to the CLI, which is why it never showed up in
development.

**Why it shipped, and kept shipping.**
- The package's own test `scaffolds correctly from packaged contents without monorepo siblings` has
  failed with exactly this error since 670f038, including at the 0.3.1 and 0.12.1 release commits
  (e1180a1, 0d6464a). `./run.sh release` builds, publishes and tags; it runs no tests.
- `verify:publish` (run by release-check and prepack) only checks that `index.mjs` and three template
  files exist; nothing in the publish path runs the packed CLI.
- The release-time sync in `scripts/run-lib.sh` knew only four keys, so it could not have added or
  updated `appMetrics`.
- The release order published `app-metrics` after `create-elata-demo`, so even a synced pin could
  fall behind (see the PR).

**After a fixed version is published** (maintainer action, per `docs/releasing.md`, "If a Bad Version
Is Published"):

```
npm deprecate @elata-biosciences/create-elata-demo@">=0.3.1 <=0.12.1" "Crashes on start; use >=0.12.2"
npm view @elata-biosciences/create-elata-demo dist-tags   # confirm latest is the fixed version
```

---

## Pull request

**Title:** fix(create-elata-demo): ship the appMetrics fallback version and refuse a release that cannot start

Closes #<issue>.

### What changes

1. **The fix.** `packages/create-elata-demo/package.json` gains `elataSdkVersions.appMetrics: "0.5.0"`,
   the repo's `packages/app-metrics` version and npm's `latest`. No CLI code changes. All five
   templates generated from the packed CLI are byte-identical to what `main`'s CLI generates inside the
   monorepo, and apps generated earlier are untouched (the CLI is a one-time copy).
2. **The release sync follows every pinned package.** `sync_create_elata_demo_versions_if_needed`
   updates every key in `elataSdkVersions` from the package it names (`eegWebBle` is
   `packages/eeg-web-ble`) instead of a fixed list of four, and fails on a key that names no package.
   `verify_release_contract_for_target` (release-check) runs that same validation, read-only, so a bad
   key stops the release before anything is published.
3. **create-elata-demo is published last.** `release_targets_for all` moves it after `app-metrics` and
   `biosignal-session`; `docs/releasing.md` says why. The publish loop patch-bumps an unchanged package
   at its own turn, so with the old order the scaffolder pinned `app-metrics` 0.5.0 and then 0.5.1 was
   published; and when `app-metrics` did have changes, the scaffolder went out pinning a version npm did
   not have yet.
4. **The publish check runs the packed CLI.** `verify:publish` now also runs
   `scripts/verify-packed-cli.mjs`: it copies `package.json` plus the `files` entries (what npm installs)
   to an empty temp folder, scaffolds every template directory from there, and refuses a non-zero exit
   or any `__PLACEHOLDER__` left in a generated `package.json`, HTML, Markdown or other non-code file.
   Module code (`.js`, `.ts`, `.jsx`, `.tsx` and their `.c`/`.m` forms) is not scanned: a template may
   use a global that Vite's `define` replaces at build time, written `__NAME__` by convention
   (`console.log(__APP_VERSION__)`), and the first version of this check refused that. The cost of
   the narrowing: a placeholder the CLI does not know about, written into module code, would not be
   caught. Every placeholder the templates use today sits in `package.json`, `index.html`,
   `game.html` or `README.md` (`git grep '__[A-Z]' packages/create-elata-demo/templates`). A stray
   file under `templates/`, such as the `.DS_Store` macOS Finder leaves (git ignores it and npm does
   not pack it), is not treated as a template. It runs in release-check and in prepack (so also in
   `pnpm pack`, CI's dry-run pack step and the consumer smoke test). One run takes 0.41 to 0.59 s
   here; prepack runs `verify:publish` twice (`prepare:publish` runs it, then prepack runs it again,
   as on `main`), so `pnpm pack` of this package goes from 3.1 to 3.2 s on `main` to 3.9 to 4.4 s
   here (pnpm 10.33.2 through npx, three runs each). It is not shipped (it is outside `files`).
5. **Tests** (in the package suite that CI's `pnpm test` runs):
   - `scaffolds every template from packaged contents without monorepo siblings` replaces the
     one-template version: every template, no placeholder left, and every `@elata-biosciences/*`
     dependency equal to that package's repo version. Before, no test generated `pulse-game`, the only
     template that uses `app-metrics`.
   - `the publish check refuses a package that cannot scaffold from its packed files`: passes on this
     package, on one with a stray `templates/.DS_Store` and on one whose template code uses a Vite
     define global (`__APP_VERSION__`), refuses the 0.12.1 shape (no `appMetrics`) and a template
     `package.json` with an unfilled version placeholder.
   - `verify:publish refuses a package that cannot start from npm`: runs the package's own
     `verify:publish` line in a shell, as npm and pnpm do, in a copy laid out like the repo. It passes
     on this package and refuses the 0.12.1 shape, so it fails if the check is ever dropped from
     `verify:publish`.
   - `the release sync keeps every packaged SDK version current`, `the release publishes
     create-elata-demo after every package it pins`, `release-check refuses a packaged SDK version that
     names no package`: they run the real `scripts/run-lib.sh` functions under `set -Eeuo pipefail`, as
     `./run.sh` does, with `pnpm` and `npm` stubbed so nothing is installed or published. They need
     bash and are skipped where it is missing.
   - `ships fallback SDK versions that match the repo package versions` also checks `appMetrics`.
6. Changeset (patch, user-facing fix only), `llms.txt` (it listed three of the five pinned packages),
   and `docs/releasing.md` (release order, and what the preflight now refuses for create-elata-demo).

### How to check it

All on this branch unless stated; Node 22.22.2 and 20.20.2.

- `pnpm --dir packages/create-elata-demo test`
  - `main`: 17 tests, 15 pass, 2 fail: the packaged-contents test (the error above) and the smoke test.
  - this branch: 22 tests, 21 pass, 1 fail: the smoke test, with the same error as on `main`
    (`ERR_PNPM_IGNORED_BUILDS` when the pnpm that corepack picks installs a generated starter;
    re-run 2026-10-12). That is older than this PR and is fixed by the starters PR
    (`fix/starters-build-and-install`).
  - **So CI's `pnpm test` is not green after this PR alone.** It goes green with the starters PR too
    (that PR alone: 19 tests, 18 pass, the one failing is this PR's packaged-contents test; with both,
    on the merged tree of all proposed fixes: 25 of 25, smoke included, re-run 2026-10-12). CI's consumer-smoke job stays red even
    then, on a cause already on `main` and outside these PRs: `rppg-models-web` depends on `rppg-web`
    as `workspace:*`, which packs as the exact version 0.14.0, so the smoke app installs 0.14.0 from
    npm and its build fails with `"PREFIX_WAVEFORM_CHANNELS" is not exported`. Running `main`'s smoke
    script with only its first (crashing) step cut out fails with the identical error.
  - Without network: `node --test --test-skip-pattern=smoke index.test.mjs` (Node 22; Node 20 has no
    `--test-skip-pattern`) gives 21 of 21.
- Each test fails without its part of the change: drop `appMetrics` from `package.json` (4 fail: the
  versions-match test, the packaged-contents test with the error above, the publish-check test,
  whose check of this package now fails, and the `verify:publish` test); scan module code for
  placeholders again (the publish-check test: `pulse-game: __APP_VERSION__ left in
  src/game/main.tsx`); restore `main`'s `run-lib.sh` (`elataSdkVersions.appMetrics
  was not synced`, plus the order and release-check tests); restore the old order (`app-metrics is not
  released before create-elata-demo`); remove the release-check call (a bad key passes); drop
  `node scripts/verify-packed-cli.mjs` from `verify:publish` (`verify:publish passed a package that
  crashes on start`); delete the script (the publish-check test fails too); list every entry of
  `templates/` as a template again (`unknown template ".DS_Store"`).
- From real tarballs: `pnpm --dir packages/create-elata-demo pack`, then
  `npx --yes --package=./<tgz> create-elata-demo consumer-create-elata-demo --template rppg-web-demo`
  (the consumer-smoke scaffold step). `main`'s tarball exits 1 with the error above; this branch's prints
  `Created consumer-create-elata-demo using rppg-demo!`. `--template pulse-game` writes
  `"@elata-biosciences/app-metrics": "0.5.0"`. Both `pnpm pack` tarballs hold the same 67 files.
- `./run.sh release-check create-elata-demo` passes. With `appMetrics` removed from `package.json` it
  is refused with the crash message; with an `elataSdkVersions` entry that names no package it is
  refused with `elataSdkVersions.<key> names no package at packages/<dir>`.
- Platforms: the three release tests need bash and skip without it; the `verify:publish` test runs
  the script line through Node's `shell: true`, which is `cmd.exe` on Windows. Only Linux was run
  here (CI runs `pnpm test` on `ubuntu-latest` only), so Windows and macOS are untested.
- Lint: Biome 1.9.4 `lint` reports nothing on the touched files, on `main` and here. `biome format .`
  flags the same 123 files on `main` and on this branch; the new script is formatted. `audit:repo` and
  `scripts/run-sh-tests.sh` pass.

Our own check, not part of the PR: we ran `publish_packages all` against a copy of the repo with npm
and pnpm stubbed. With the old order and nothing changed since the last release, create-elata-demo
was published pinning app-metrics 0.5.0 and app-metrics 0.5.1 was published after it (on `main`,
which has no `appMetrics` key, the scaffolder went out without one, the original crash). With
app-metrics at 0.6.0, create-elata-demo was published pinning 0.6.0 one step before 0.6.0 was. With
this branch, both cases publish app-metrics first and the pin matches what was published.

### Choices a reviewer may ask about

- **Why a separate publish check, not the unit test in prepack?** The unit test compares pinned
  versions with the repo's, and those legitimately differ between `./run.sh bump` and the release-time
  sync, so it would fail release-check in the documented flow. The publish check only asks whether the
  packed CLI can start and fill every template, which must hold at every step.
- **Why skip module code instead of scanning only the CLI's own keys?** `copyDir` replaces every key
  it knows in every file, and `readVersion` throws before a key could be filled with nothing, so a
  scan for the CLI's own keys can never find one: it would pass on every package, the 0.12.1 shape
  included. The placeholder that slips through is one the CLI does not know, such as a template
  that adds `__BIOSIGNAL_SESSION_VERSION__` to its `package.json` without the CLI learning it,
  which is the case the test covers. Skipping module code keeps that case and drops the Vite
  `define` false positive.
- **Why copy the `files` entries instead of packing a real tarball?** Packing from inside prepack
  would need `npm pack --ignore-scripts` (or it recurses into itself) and a spawned npm, which needs a
  shell on Windows. The copy holds exactly the 66 files `npm pack` lists for this package (pnpm's
  tarball adds the repo `LICENSE`), and the check stays plain Node.
- **Why not `workspace:*` versions?** The interactive publish path is `npm publish --auth-type=web`,
  and npm would ship a literal `workspace:*`.
- **Why not make the CLI resolve versions lazily per template?** `pulse-game` would still crash. Keeping
  the CLI unchanged keeps this a data fix plus release guards.

### Not in this PR (separate issues)

- The smoke test's `ERR_PNPM_IGNORED_BUILDS` with current pnpm.
- The sibling lookup also matches `node_modules/@elata-biosciences/*`, so in a project that already has,
  say, app-metrics 0.4.0 installed, the generated pulse-game pins 0.4.0 instead of the packaged version.
- `./run.sh release create-elata-demo` on its own still pins each SDK package's repo version whether or
  not npm has it: with `rppg-web` bumped to an unreleased 0.15.0, the scaffolder is published pinning
  0.15.0. `main` behaves the same; `release all` is safe now that the scaffolder goes last.
- The READMEs, `docs/create-elata-demo.md` and `llms.txt` do not mention the `pulse-game` template.

### Squash merge

The first commit predates the Conventional Commits subject, so please squash-merge as:

`fix(create-elata-demo): ship the appMetrics fallback version and refuse a release that cannot start`

### Merging with the other fixes

All ten proposed fixes were merged together locally and tested as one tree. Recommended order: this PR before the starters fix (`fix/starters-build-and-install`) and the peer-range fix (`fix/eeg-web-ble-peer-range`). It merges cleanly there. The peer-range PR then conflicts on one line of `packages/create-elata-demo/index.test.mjs` (both add `readdirSync` to the `node:fs` import, this PR also adds `statSync`) and resolves it on its side.

On the merged tree:

- `node --test index.test.mjs`: 25 of 25, the five-template smoke included (main: 17 tests, 2 failing; re-run 2026-10-12 on all ten fixes plus the current tips of this PR, the starters PR and the peer-range PR). Each part of this PR removed turns its test red: `appMetrics` dropped (4 red), the scaffolder published before app-metrics (1), the sync knowing only the four old keys (2), release-check skipping the `elataSdkVersions` check (1), `verify:publish` without the packed check (1), a stray file under `templates/` counted as a template (1).
- The release with the peer-range fix, run for real with npm and `git push` stubbed (`bump_publish_packages minor`, `publish_packages all latest`, then the release commit): create-elata-demo is published last, and its `elataSdkVersions` are exactly the versions published just before it (eeg-web 0.13.0, eeg-web-ble 0.13.0, rppg-web 0.15.0, ppg-web 0.13.0, app-metrics 0.6.0). Every workspace peer range takes its sibling's new version, `scripts/audit-repo.mjs` passes, and nothing is left uncommitted.
