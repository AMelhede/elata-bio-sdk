# Fix 8: eeg-web-ble and ppg-web peer ranges

Branch: `fix/eeg-web-ble-peer-range` on github.com/AMelhede/elata-bio-sdk, 8 commits on Elata's main (49fdb41), tip 1c4d1fe. Not opened yet.

---

## Issue

**Title:** eeg-web-ble and ppg-web name peer versions that were never published, so `npm install` fails (every release from 0.3.0 to 0.12.0)

**Who is affected.** Anyone who installs `@elata-biosciences/eeg-web-ble` or `@elata-biosciences/ppg-web` from npm with npm 7 or later, which treats peer dependencies as requirements. That includes the `eeg-ble`, `eeg-demo` and `ppg-demo` starters from create-elata-demo, which fail at the `npm install` step the generator prints.

**What is published.** All 22 published versions of the two packages (eeg-web-ble 0.3.0 to 0.12.0 and ppg-web 0.3.0 to 0.12.0, 11 each, none deprecated) carry these peer ranges:

- eeg-web-ble: `@elata-biosciences/eeg-web` `^0.2.1`
- ppg-web: `@elata-biosciences/eeg-web` `^0.2.1`, `@elata-biosciences/eeg-web-ble` `^0.2.1`, `@elata-biosciences/rppg-web` `^0.3.0`

Below 1.0 a caret range covers a single minor version (`^0.2.1` means `>=0.2.1 <0.3.0`, per node-semver's "Caret Ranges"). No eeg-web 0.2.x and no rppg-web 0.3.x was ever published (eeg-web goes 0.1.23 to 0.3.0, rppg-web 0.1.23 to 0.4.0), so no published version satisfies any of these ranges.

**Reproduce** in an empty folder with `{"name":"repro","version":"1.0.0","private":true}` as package.json (npm 10.9.7, Node 22; also seen with npm 10.8.2 on Node 20):

```
npm install @elata-biosciences/eeg-web @elata-biosciences/eeg-web-ble
  npm error code ERESOLVE
  npm error peer @elata-biosciences/eeg-web@"^0.2.1" from @elata-biosciences/eeg-web-ble@0.12.0

npm install @elata-biosciences/eeg-web-ble        # or @elata-biosciences/ppg-web
  npm error code ETARGET
  npm error notarget No matching version found for @elata-biosciences/eeg-web@^0.2.1.

npm view @elata-biosciences/eeg-web-ble@0.12.0 peerDependencies
npm view @elata-biosciences/eeg-web versions
```

Our own observations, from the same kind of clean folders:

- The `eeg-ble`, `eeg-demo` and `ppg-demo` templates from the create-elata-demo 0.12.1 tarball, with its own `elataSdkVersions` filled in, fail `npm install` with the ERESOLVE above. `rppg-demo` (no peers) installs. Re-checked on 2026-10-10.
- pnpm 9.15.9, 10.33 and 11.28 only warn for the pair (`unmet peer @elata-biosciences/eeg-web@^0.2.1: found 0.12.0`) and exit 0, which is why a pnpm-based smoke test passes. With either package alone, pnpm 10.33 and 11.28 fail with `ERR_PNPM_NO_MATCHING_VERSION`, and with `strict-peer-dependencies=true` the pair fails with `ERR_PNPM_PEER_DEP_ISSUES`. yarn 1.22.22 and 4.18.1 print peer warnings.
- `npm install --legacy-peer-deps` installs, but a later plain `npm install` or `npm ci` on that lockfile fails with the same ETARGET. Only `legacy-peer-deps=true` in the app's `.npmrc` keeps `npm ci` working, and then npm no longer installs peers for you. That is the only workaround we found until fixed versions are published.

**Root cause.** Commit 57a08be applied pending changesets (`changeset version`), which moved the sources to eeg-web 0.2.1 and rppg-web 0.3.0 and wrote those versions into the peer ranges. Neither version was published. Every version change since then is a `chore(release latest)` commit from `./run.sh release`, and no CHANGELOG entry was added after 0.2.1, so the bumps came from its semver path: `bump_publish_packages` in `scripts/run-lib.sh` runs `pnpm version <level> --no-git-tag-version` in each package. `pnpm version` rewrites only the package's own version, so no peer range moved, and nothing between the bump and the publish checks them. Under 0.x every minor bump breaks every caret peer range; the ranges stayed correct through 0.1.x only because those releases were all patches.

---

## Pull request

**Title:** fix(eeg-web-ble,ppg-web): peer ranges take the published siblings, and a semver release moves them

### What changes

1. **The ranges.** eeg-web-ble: eeg-web `^0.12.0`. ppg-web: eeg-web `^0.12.0`, eeg-web-ble `^0.12.0`, rppg-web `^0.14.0`. These are the current published versions, the ones the templates install. A patch changeset for each package.
2. **The release moves peer ranges with the bump** (`scripts/run-lib.sh`). After `pnpm version`, `bump_publish_packages` calls a new `sync_workspace_peer_ranges`, which sets every peer range that names a bumped package to `^<new version>`, in every package under `packages/`. That includes biosignal-analytics, which peers on rppg-web but is not in the `all` set. Each range is edited in place, so the rest of the manifest keeps its formatting; a range it cannot find stops the release before anything is built or published. `release_commit_and_push_version_changes` now also commits a range moved outside the release set, instead of leaving it in the working tree, where it would make the next `./run.sh release` refuse to start. It stages exactly that edit and nothing else: for each committed manifest outside the release set, the staged file is the committed one with only the moved peer ranges rewritten (the sync and the staging share one rewrite function), and only when the working copy carries that rewrite. So with `ALLOW_DIRTY=1` an unrelated uncommitted edit to a manifest (say `app-state`'s description, or `biosignal-analytics`' own edit next to its moved peer) stays in the working tree, as on main, and a package that is not committed yet stays out. `./run.sh publish major|minor|patch` runs the same bump and sync and, as before, commits nothing.
3. **The repo audit checks the invariant** (`scripts/audit-repo.mjs`, run by `pnpm lint`, `./run.sh doctor` and `verify:all`). Every workspace peer range must take its sibling's current version, using npm's caret rules for `x.y.z` versions. It fails on main's four ranges and passes here. A range it cannot check (`workspace:^`, `~`, `>=`) or a prerelease sibling version gets its own message. This is the check for a version or range changed by hand; the release itself does not run it. One consequence for maintainers to weigh: while any workspace package is on a prerelease version (Changesets pre mode, `0.13.0-next.0`), the audit fails and so does `pnpm lint`. Elata has never published a prerelease (every version on npm is `x.y.z`; the `next` dist-tags point at 0.1.x releases), so the audit refuses rather than carrying prerelease comparison code nobody uses.
4. **docs/releasing.md** gets a short "Peer ranges" section: how ranges move on `./run.sh release major|minor|patch` and on `./run.sh bump`, the Changesets major-bump caveat below, and where the audit runs.
5. **A test** in `packages/create-elata-demo/index.test.mjs` (CI runs it through `pnpm test`) that runs the repo's own `bump_publish_packages minor` and `release_commit_and_push_version_changes` on a temporary git repo holding a copy of every workspace manifest, one minor release on, with `pnpm version` stubbed to the same manifest change and `git push` stubbed out. It checks that every peer range naming a bumped package takes the new version, that the release commit takes every manifest the release edited, that an uncommitted package which peers on eeg-web stays out of it, and that uncommitted edits to two committed manifests (`app-state`, which no bump touches, and `biosignal-analytics`, whose rppg-web peer the release moves) stay in the working tree while the moved peer is committed. It sits in create-elata-demo's suite because that is the node:test suite CI runs; `scripts/run-sh-tests.sh` (`./run.sh test run-sh`) is not run by CI.

### Considered

- **Refuse in the release preflight** instead of moving ranges: see the next section.
- **`workspace:^` peer ranges**, which pnpm rewrites at publish. The interactive publish path in `publish_packages` and docs/releasing.md's "Safe Publish Flow" use `npm publish`, and npm ships the specifier literally: with eeg-web-ble's peer set to `workspace:^`, `npm pack --ignore-scripts` of eeg-web-ble (npm 10.9.7, 2026-10-12) ships `"peerDependencies": {"@elata-biosciences/eeg-web": "workspace:^"}`, which no npm install can resolve. The audit refuses `workspace:` peers for that reason.
- **Wider ranges** (`>=0.12.0 <1.0.0`), so a 0.x minor bump does not break them. They do not stop Changesets' major bump and they lose their upper bound: with the pending changesets on main plus this branch's two, `changeset version` (2.30.0, 2026-10-12) still makes ppg-web 1.0.0, rewrites its eeg-web-ble peer to `>=0.12.1` and its rppg-web peer to `>=0.15.0` (no upper bound, so a future rppg-web 1.0 would be accepted), and leaves eeg-web-ble's peer as written. The audit refuses non-caret workspace peers, and these give four findings.

### Why move the ranges instead of making the release refuse

Refusing in the release preflight alone would make every `./run.sh release minor` stop under 0.x, after it had already bumped the versions in the working tree, every time, until someone hand-edits each range. Moving them is what `changeset version` already does on the `./run.sh bump` path under this repo's config: with a patch changeset for eeg-web alone, `@changesets/cli` 2.30.0 (the locked version) sets eeg-web-ble's peer to `^0.12.1`. So both release paths now write the same caret ranges, and the audit catches anything changed another way. (For a `~` or `>=` range Changesets keeps the operator, `~0.14.0` becoming `~0.14.1`, while the sync writes `^`; the audit allows only caret ranges for workspace peers, so the two never meet in practice.)

### What does not change

- No package source, build output or published file list changes; only `peerDependencies` in two manifests.
- `pnpm-lock.yaml` is unchanged (`pnpm install --frozen-lockfile` passes).
- The Changesets path (`./run.sh bump`) is untouched.
- A patch is the right bump for the two packages: the old ranges accepted no published version, so no install that worked before can break.

### How it was tested

Red before, green after:

- **New test, release one minor on:** red with c5b34da's `run-lib.sh` and with main's (49fdb41), listing 9 stale ranges (`@elata-biosciences/eeg-web-ble: peer @elata-biosciences/eeg-web ^0.12.0 does not take the new 0.13.0`, and the same for ppg-web, biosignal-session and biosignal-analytics). Red with the range sync but without the commit change (`M packages/biosignal-analytics/package.json` left behind). Red with 368a6ae's commit change, which staged every `packages/*/package.json` and so committed the uncommitted package's manifest too. Red with d23b266's commit change, which staged every tracked manifest whole, so `app-state`'s and `biosignal-analytics`' unrelated local edits went into the release commit. Red with the staging step removed (biosignal-analytics' committed peer stays `^0.14.0`). Green at the tip.
- **Release commit contents, by hand** (copy of the repo's manifests, `pnpm version` stubbed, an uncommitted edit to `app-state`'s description, then `bump_publish_packages minor` and the release commit): main commits 8 files and leaves `app-state` modified; d23b266 committed 10 (its own sync plus `app-state`); the tip commits 9 (the 8 release-set manifests plus biosignal-analytics' moved peer) and leaves `app-state` modified. With the changesets path instead (`./run.sh release rppg-web` after a hand-edited rppg-web version, no sync run), the tip commits only rppg-web's manifest and does not stage a peer change the working tree does not have.
- **Real `pnpm version`** (pnpm 10.33.2) through `bump_publish_packages minor` on a copy of the repo, then `npm pack` of eeg-web and eeg-web-ble at 0.13.0 and `npm install` of both tarballs: with c5b34da's `run-lib.sh` the audit lists the 9 stale ranges and npm fails with `ERESOLVE ... peer @elata-biosciences/eeg-web@"^0.12.0" from @elata-biosciences/eeg-web-ble@0.13.0`; with this branch the audit passes, npm exits 0 and `npm ls --all` is clean. biosignal-analytics' manifest changes by exactly one line.
- **The new ranges on the published siblings** (npm 10.9.7, Node 22, re-run for this revision): `npm pack` of this branch's eeg-web-ble, then `npm install @elata-biosciences/eeg-web@0.12.0 <tarball>` exits 0, and the tarball alone exits 0 with npm installing eeg-web 0.12.0 itself. Packed ppg-web with eeg-web 0.12.0, rppg-web 0.14.0 and the packed eeg-web-ble exits 0, and with the packed eeg-web-ble alone it exits 0 with npm adding eeg-web 0.12.0 and rppg-web 0.14.0; `npm ls --all` is clean each time. Packed ppg-web on its own still fails today (ERESOLVE), because npm then takes the published eeg-web-ble 0.12.0, whose own peer is the broken `^0.2.1`; it installs once the fixed eeg-web-ble is on npm, and at release both paths move ppg-web's eeg-web-ble peer to that fixed patch (`^0.12.1`, checked with `changeset version` below). Our own earlier run (not repeated for this revision, the manifests are the same) found pnpm, pnpm strict mode and yarn 1 and 4 quiet with the new ranges.
- **Audit:** main's manifests give 4 errors; this branch passes; a prerelease sibling (eeg-web `0.13.0-next.0`) now reports `whose version 0.13.0-next.0 is not x.y.z (a prerelease?)` instead of asking for a caret range.

Suites and linters, run on this branch and compared with main:

- `node --test index.test.mjs` in create-elata-demo: 18 tests, 16 pass, 2 fail here; 17 tests, 15 pass, 2 fail on main. The same two fail on main and are fixed by companion PRs: "scaffolds correctly from packaged contents" (missing `appMetrics` version, branch `fix/create-elata-demo-starts`) and "smoke" (corepack's pnpm stops at `ERR_PNPM_IGNORED_BUILDS`, branch `fix/starters-build-and-install`).
- eeg-web-ble Jest 53/53, ppg-web Jest 8/8; `tsc --noEmit` clean for both (after building eeg-web from its WASM, and eeg-web-ble).
- `./run.sh test run-sh` ok; `./run.sh release-check eeg-web-ble` passes; `pnpm run audit:repo` passes.
- biome 1.9.4: `biome format .` reports 123 errors and `biome lint .` 74 on both main and this branch (source tree only: biome does not read `.gitignore`, so a generated `eeg-demo/pkg` adds findings to both). `scripts/audit-repo.mjs` and the two manifests have the same format findings as on main and no lint findings. `packages/create-elata-demo/index.test.mjs` is not biome-formatted on main (two-space indent and single quotes throughout); the new test follows the file's own style, so the file was failing before and the counts do not move. Already failing on main and unchanged here: `docs:mintlify:check` (`elata-docs/docs.json must exist`), eeg-web's lint (2 errors) and eeg-web-ble's lint (1 error in `src/browserCheck.ts`).

### Releasing this (for maintainers)

- **`./run.sh bump` would make ppg-web 1.0.0.** With this branch and the changesets now pending on main, `changeset version` (2.30.0) gives eeg-web-ble 0.12.1 but ppg-web 1.0.0, and biosignal-session's peer on it becomes `^1.0.0`. Changesets bumps a package to a major when a package it peers on takes a minor, and four rppg-web minor changesets are pending. On main ppg-web stays 0.12.0 only because Changesets skips its invalid peer links (it prints `must depend on the current version of "@elata-biosciences/eeg-web": "0.12.0" vs "^0.2.1"`). biosignal-session and biosignal-analytics already come out at 1.0.0 on main for the same reason. Two ways to avoid it: release the two peer fixes first (with only their two changesets, `./run.sh bump` gives eeg-web-ble 0.12.1 and ppg-web 0.12.1, with ppg-web's eeg-web-ble peer at `^0.12.1`), or set ppg-web to 0.13.0 in the step 2 review of the bump diff. Either way eeg-web-ble has to reach npm no later than ppg-web, which the fixed release order (`eeg-web-ble` before `ppg-web`) already does.
- **Bad versions.** docs/releasing.md's "If a Bad Version Is Published" applies: deprecate eeg-web-ble and ppg-web `>=0.3.0 <=0.12.0` pointing at the fixed patch, publish it, and move `latest`.
- **Existing apps** keep the broken version: generated starters pin exact versions (`"@elata-biosciences/eeg-web-ble": "0.12.0"`), so they need a hand edit to the fixed version. New scaffolds also need a create-elata-demo release, and the published create-elata-demo 0.12.1 crashes before scaffolding (companion PR, branch `fix/create-elata-demo-starts`).
- **The starters' smoke test stays on pnpm for now.** With the published packages, `npm install` of a fresh `ppg-demo`, `eeg-demo` or `eeg-ble` starter fails with ERESOLVE (eeg-web-ble 0.12.0 names eeg-web `^0.2.1`; measured 2026-10-10), so the companion PR for the starters (branch `fix/starters-build-and-install`) keeps its smoke test on pnpm. Adding npm to that smoke test is the follow-up once fixed eeg-web-ble and ppg-web are on npm.

### Not in this PR (separate issues)

- Changesets bumping 0.x peer dependents to 1.0.0, which already affects biosignal-session and biosignal-analytics on main.
- rppg-models-web lists `"@elata-biosciences/rppg-web": "workspace:*"` as a runtime dependency. `pnpm publish` rewrites it, but the no-`NPM_TOKEN` path in `publish_packages` and the "Safe Publish Flow" in docs/releasing.md use `npm publish`, which would ship it unrewritten. (The same reason the audit keeps refusing `workspace:^` peers.)
- The consumer smoke test installs with plain pnpm, which only warns on a bad peer range, and neither it nor `validate-tarballs` covers ppg-web.

### Commits

The branch has eight commits. The first two subjects are not Conventional Commits, and their bodies describe a create-elata-demo test that the third commit removed; the fourth corrects the third's claim that a release would fail the audit (the release never ran it). The next three came from a further review: the release commit leaves uncommitted packages out, the changesets name every install that was refused, and the sync's comment says it matches Changesets for caret ranges only. The eighth makes the release commit take only the moved peer ranges from manifests outside the release set, after a maintainer-style audit found the seventh's version swept unrelated local edits into it under `ALLOW_DIRTY=1`. The fork's history only moves forward, so nothing was rewritten. Please squash-merge; suggested subject: `fix(eeg-web-ble,ppg-web): peer ranges take the published siblings, and a semver release moves them`.

### Merging with the other fixes

All ten proposed fixes were merged together locally and tested as one tree. Recommended order: this PR after the starter maker fix (`fix/create-elata-demo-starts`) and the starters fix (`fix/starters-build-and-install`).

Update after `fix/create-elata-demo-starts` has merged: merge main into this branch (one commit on top, no force push) and resolve one hunk. In `packages/create-elata-demo/index.test.mjs`, the `node:fs` import list: both add `readdirSync` after `readFileSync`, and main also adds `statSync`. Keep `readdirSync,` once, followed by `statSync,`. `docs/releasing.md` and `scripts/run-lib.sh` merge on their own; the release order there becomes main's (create-elata-demo last), and this PR's peer sync runs over the same `all` set.

On the merged tree:

- The audit passes, and fails again when either package's peers go back (ppg-web: 3 findings, eeg-web-ble: 1). The release test goes red without the range sync and without the commit change. `node --test index.test.mjs`: 25 of 25, smoke included (re-run 2026-10-12 with this tip and the current tips of the two companion PRs).
- The release, run for real with npm and `git push` stubbed (`bump_publish_packages minor`, `publish_packages all latest`, the release commit): every workspace peer range takes its sibling's new version (eeg-web-ble, ppg-web and biosignal-session), create-elata-demo is published last with `elataSdkVersions` equal to the versions just published, the audit passes and nothing is left uncommitted.
- `./run.sh bump` with all ten fixes in: `changeset version` gives rppg-web 0.15.0, eeg-web-ble 0.12.1, create-elata-demo 0.12.2 and ppg-web 1.0.0 (biosignal-session and biosignal-analytics 1.0.0 too, as on main). So the ppg-web major warned about above happens with the full set, and either of the two ways out above still applies.
