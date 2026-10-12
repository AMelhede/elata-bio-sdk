# Tooling audit: fixes 6, 7, 8 (starter maker, starters, peer ranges)

Written 2026-10-12 from the chair of an Elata maintainer who did not write these and is looking for reasons not
to merge. No branch was changed. Everything below was run today in this container (Node 22.22.2 and 20.20.2,
npm 10.9.7, pnpm 9.15.9, 10.33.0, 11.28.5, 12.10.1 and 12.11.2 via corepack). Prereg: case/ta/prereg.md
(11:07 UTC, before any run). Scripts: case/ta/rg.sh (red/green), case/ta/sweep.sh. Logs: case/ta/results.

Branch tips checked: fix 6 7deb183, fix 7 cd73ec2, fix 8 d23b266, all on main 49fdb41; merged tree
wip/all-fixes 32ce8b1. Each pr/ one-commit ref has exactly its tip's tree and Andreas as author. No dashes,
attribution, dataset names or private numbers in any of the three diffs or PR texts.

## Fix 6: create-elata-demo crashes on start (fix/create-elata-demo-starts)

**Without the change.** Reproduced exactly. `npx --yes @elata-biosciences/create-elata-demo@0.12.1
--list-templates` in an empty folder with a fresh cache: exit 1, "Missing packaged SDK version metadata for
@elata-biosciences/app-metrics". Same for `--template pulse-game`. All 11 versions 0.3.1 to 0.12.1 read
appMetrics in index.mjs and none packages it; 0.1.20, 0.1.23, 0.1.24 do not read it. 0.12.1 is still `latest`,
none deprecated. Main's own `./run.sh release-check create-elata-demo` passes this crashing package (exit 0,
"66 files, all checks passed"). The package's own test is red at 670f038, e1180a1 (0.3.1 release) and 0d6464a
(0.12.1 release) and green at 670f038's parent (16 of 16), so the bug and the ignored red test are both real.
Main's release order (create-elata-demo before app-metrics) and the four-key sync are in run-lib.sh as stated.

**With the change.** Branch tarball (pnpm pack): rppg-web-demo prints "Created ... using rppg-demo!", pulse-game
pins app-metrics 0.5.0. All five starters from the packed CLI are byte-identical to main's in-repo CLI output
(62 files). The tarball differs from main's only in package.json (2 lines) and llms.txt; 67 files both.
Red/green (smoke skipped): branch 21 of 21; branch tests on main 5 red; branch with main's run-lib.sh 3 red
(sync, order, release-check); branch with appMetrics dropped 4 red. Release-check on the branch refuses a
dropped key (the crash) and a key naming no package. Full suite: main 17/15 pass, branch 22/21 (smoke only, which
is fix 7's bug), merged tree 24 of 24 on Node 22 and on Node 20 with corepack pnpm 12.11.2, as CI runs it.

**Cost, measured.** No CLI code change, no template change. The packed check takes 0.41 to 0.48 s; prepack runs
verify:publish twice, so `pnpm pack` goes from 2.6 s to 3.8 s. Release order changes (create-elata-demo last).
The shipped package.json names a script that is not shipped (harmless, consumers never run verify:publish).

**Objections.**
- Scope (398 lines for a one-key bug): answered. Without the sync change the key goes stale at the next release
  (sync test red on main's run-lib.sh), without the order change the pin runs ahead of npm (stubbed release in
  the PR), without the packed check nothing in the publish path runs the CLI. A maintainer may still ask for two
  PRs (data fix, then guards).
- PR text says dropping appMetrics turns 3 tests red; it is 4 (the verify:publish test also fails). Gap, text.
- The placeholder scan refuses any `__UPPER__` token: adding `console.log(__APP_VERSION__)` (a normal Vite define
  global) to a template makes the publish check fail. Not a problem today, not in the PR text. Gap.
- CI stays red after this PR alone: pnpm test needs fix 7 for the smoke, and consumer-smoke still fails after 6
  and 7 on main's own rppg-models-web issue (ci-parity-2026-10-11.md). Not said in fix6.md. Gap, text.
- Windows and macOS untested; the run-lib tests skip without bash. Gap, not closable here.
- "about half a second" omits that prepack runs it twice. Minor gap, text.
- Interactions: merges clean with 7, one import-line conflict with 8 (git merge-tree), merged tree green. Answered.
- Deprecating 11 versions is maintainer work; commands are in the issue. Answered.

**Verdict: strong-after-gaps** (all gaps are text, plus one optional code narrowing).

## Fix 7: starters do not build or install (fix/starters-build-and-install)

**Without the change.** Reproduced exactly, from main's CLI: rppg-demo with npm, install exit 0, `npm run build`
exit 1 "[vite-plugin-top-level-await] missing field `type`" (vite 6.4.4, plugin 1.6.0, @swc/core 1.16.18,
today's latest). `npx pnpm@11 install`: exit 1 ERR_PNPM_IGNORED_BUILDS (@swc/core, esbuild). Main's smoke test:
red on its first template (pnpm 12.10.1, ERR_PNPM_IGNORED_BUILDS). Plugin 1.6.0 is its last release
(2025-07-17); @swc/core 1.16.0 is 2026-08-14. README Option A on Vite 6.4.4 with rppg-web 0.14.0: same
"missing field `type`".

**With the change.** Branch rppg-demo: npm install and build exit 0; pnpm 11.28.5 install exit 0 (esbuild
built), build exit 0. Smoke 5 of 5 in 24 s. Guard and parent-workspace tests: red on main (3 red with the branch
test file: guard, warns, plus fix 6's), branch 16 of 17 offline, 17 of 18 with smoke. Unlink: real `pnpm link`
then `./run.sh unlink` on a fixed starter, pnpm 10.33.0 and 11.28.5: main prints "Unlinked" and stays on the local
build with the override left; the branch is back on registry 0.14.0, `packages` and `allowBuilds` kept. The
run-sh unlink test is red on main only because the self-test command does not exist there. README Option A,
Vite 6: branch config builds; without `target: "es2022"` it fails ("Top-level await is not available").

**Cost, measured.**
- pnpm 9.15.9 `pnpm add` in a new starter: exit 1 ERR_PNPM_ADDING_TO_ROOT, needs `-w` (main's starter: exit 0).
  pnpm 9 support ended 2026-04-30 (endoflife.date). Inside a parent workspace the starter gets its own lockfile.
- Build output is not only "the same target". The plugin set Vite's target to esnext and re-transformed JS
  itself, unminified. rppg-demo built with the last working SWC (1.15.47) against the branch: main JS 367,179
  bytes (9,874 lines, 83,598 gzip) against 231,872 (54 lines, 73,071 gzip); CSS 8,632 against 8,748 bytes
  (now gets -webkit-backdrop-filter, -webkit-user-select and inset expanded, for Vite's default browsers).
  Both changes are improvements, but the PR text does not say the output moves.
- Third-party build script allowed by default (esbuild), as Elata's root already does.

**Objections.**
- Alternatives are not in the text. Measured today: pinning @swc/core 1.15.47 keeps the plugin working but leaves
  an unmaintained plugin and unminified bundles; `pnpm unlink` is no substitute for the unlink rewrite (pnpm
  10.33.0 says "Nothing to unlink" and keeps the override; 11.28.5 removes it); denying esbuild
  (`esbuild: false`) also installs and builds on pnpm 11. Gap, text.
- Scope: 36 files, a 90-line awk and Node unlink rewrite. Answered: CONTRIBUTING step 5 asks for the docs; the
  unlink change is forced by the new workspace file (main's unlink measured broken on it).
- The unlink tests live in run-sh-tests.sh, which CI does not run (fix 8 moved its test into node:test for this
  reason). Gap, test move.
- "A colleague's wider matrix" cannot be checked by a maintainer (it is our own 2026-10-10 run). Gap, text.
- Stale sentence: fix7.md says pr/starters-build-and-install has the old 125cf5b tree; it now has the tip's tree.
  Gap, text.
- Docs site head is now 7f41c86, not d83bd47; it still has `--ignore-workspace` in 5 English pages (15 files with
  translations) and the plugin in 2 English pages. Gap, text refresh.
- Only mawk is installed here, so the BWK and BusyBox claims and Windows and macOS are not re-checked. Gap.
- Smoke depends on network and corepack's latest pnpm: true on main too. Conceded.
- Interactions: clean merges with 6 and 8; merged tree 24 of 24. Answered.

**Verdict: strong-after-gaps.**

## Fix 8: peer ranges (fix/eeg-web-ble-peer-range)

**Without the change.** Reproduced exactly with npm 10.9.7 in empty folders: eeg-web plus eeg-web-ble exit 1
ERESOLVE (peer ^0.2.1 from eeg-web-ble@0.12.0); eeg-web-ble alone and ppg-web alone exit 1 ETARGET. Registry: 11
eeg-web-ble and 11 ppg-web versions (0.3.0 to 0.12.0) carry ^0.2.1 / ^0.3.0; no eeg-web 0.2.x or rppg-web 0.3.x
exists; none deprecated. 57a08be consumed the changesets that wrote those ranges. On main's run-lib.sh one minor
release leaves 9 stale workspace ranges (the branch's test, red on main).

**With the change.** Packed branch eeg-web-ble with eeg-web 0.12.0: exit 0, `npm ls --all` clean. Packed
eeg-web-ble plus ppg-web: exit 0, npm installs eeg-web 0.12.0 and rppg-web 0.14.0 itself. Packed files differ
from main only in peerDependencies. Audit: branch script on main's manifests 4 errors, branch passes. Release test
red on main, green on branch. `changeset version` (2.30.0): only the two peer changesets give eeg-web-ble 0.12.1
and ppg-web 0.12.1 with peer ^0.12.1; a lone eeg-web patch moves eeg-web-ble's peer to ^0.12.1; all pending give
ppg-web 1.0.0, while main keeps ppg-web 0.12.0 only by skipping its invalid peers (biosignal-session and
-analytics 1.0.0 on both). Every claim in the PR's release section reproduced.

**Cost, measured.**
- The next `./run.sh bump` with main's pending changesets makes ppg-web 1.0.0. Conceded in the PR, two ways out.
- `pnpm lint` fails while any package is on a prerelease version. Conceded in the PR.
- New: with ALLOW_DIRTY=1, an unrelated uncommitted edit to any tracked manifest (tested: app-state) is now
  swept into the release commit (10 files, app-state included); main leaves it uncommitted (8 files). The PR says
  untracked packages stay out but not this. Narrow (needs the override), real.

**Objections.**
- Alternatives: `workspace:^` loses because `npm pack` ships it literally (measured: peer stays "workspace:^")
  and the interactive publish path is `npm publish`; wider ranges (`>=0.12.0 <1.0.0`) lose because Changesets
  still makes ppg-web 1.0.0 and rewrites them to `>=0.15.0` with no upper bound (measured), and the audit refuses
  them. Only "refuse in preflight" is argued in the text. Gap, text.
- Release commit sweep above. Gap: text now, or stage only the manifests the sync edited (code, under an hour).
- Test placement in create-elata-demo's suite: odd but reasoned (CI runs node:test there). Answered.
- Lockfile: no pnpm-lock change; every peer is also a `workspace:*` devDependency, and CI parity installed with
  `--frozen-lockfile` on this branch. Answered.
- Scope (ranges plus sync plus audit plus commit change): answered by the red release test on main's run-lib.sh.
- Existing apps pin exact versions and need a hand edit; deprecation commands given. Answered.

**Verdict: strong-after-gaps.**

## Gaps, in order of what a maintainer would hit first

1. Fix 6 text: 3 red should be 4 red when appMetrics is dropped. Closable now.
2. Fix 6 and 7 text: say `pnpm test` goes green only with both (6 alone 21/22, 7 alone 17/18, merged 24/24) and
   consumer-smoke stays red on main's rppg-models-web issue. Closable now.
3. Fix 7 text: output moves (minified JS, CSS for default browsers), numbers above. Closable now.
4. Fix 7 text: alternatives with today's numbers (swc pin, pnpm unlink, deny esbuild). Closable now.
5. Fix 7 text: replace "a colleague's matrix", drop the stale pr/ ref sentence, docs head 7f41c86. Closable now.
6. Fix 8: release commit sweeps unrelated tracked manifests under ALLOW_DIRTY=1. Text now; code with a test
   under an hour.
7. Fix 8 text: workspace:^ and wide-range alternatives with the measured reasons. Closable now.
8. Fix 6: placeholder scan false positive on `__UPPER__` globals. Text now, or limit the scan to the CLI's own
   keys (code with a test, under an hour).
9. Fix 7: move the unlink test into the node:test suite CI runs. Under an hour.
10. Windows and macOS, BWK and BusyBox awk: not closable in this container.

## Closed

Done 2026-10-12, 13:09 to about 14:40 UTC. Prereg: case/tc/prereg.md (written before each run). Worktrees under
scratch/tc. New tips pushed fast-forward to the fork: fix 6 7deb183..fef0a51, fix 7 cd73ec2..b94551e, fix 8
d23b266..1c4d1fe. pr/ refs regenerated (parent 49fdb41, author Andreas, tree equal to the tip, not pushed):
pr/create-elata-demo-starts 8b8ecad, pr/starters-build-and-install aeb6d5b, pr/eeg-web-ble-peer-range 2d3d672.
Merge check: the three new tips merged onto a scratch copy of wip/all-fixes 32ce8b1 (clean, detached 3ec6717,
wip/all-fixes itself not moved): create-elata-demo `node --test` 25 of 25 with the five-template smoke, audit-repo
passes, run-sh tests ok. Pairwise merge-tree: 6+7 clean, 7+8 clean, 6+8 the same one-line `statSync` import hunk.
Local branch note: fix/starters-build-and-install is checked out in the upstream-tracking checkout, so its local ref was left at
cd73ec2 (moving it would dirty that tree); origin and pr/ are current. The other two local branches were moved.

1. **Fix 6, 3 red should be 4 (text).** Re-measured on fef0a51 with appMetrics dropped: 4 red (versions-match,
   packaged-contents, publish-check, verify:publish). fix6.md corrected. Closed.
2. **Fix 6 and 7, CI not green alone (text).** Re-measured with smoke: fix 6 alone 21 of 22 (smoke,
   ERR_PNPM_IGNORED_BUILDS), fix 7 alone 18 of 19 (packaged-contents), merged 25 of 25. Consumer-smoke cause on
   main cited from ci-parity-2026-10-11.md. Both texts say so. Closed.
3. **Fix 7, output moves (text).** Re-measured: main rppg-demo with @swc/core pinned 1.15.47 (plugin 1.6.0, Vite
   6.4.4) JS 367,179 bytes / 9,874 lines / 83,598 gzip -9, branch 231,872 / 54 / 73,071; CSS 8,632 vs 8,748; WASM
   glue identical. Mechanism read from the plugin's dist/index.js (target forced to esnext, SWC re-print to the
   original target, minify false when build.minify is unset). fix7.md's "output target stays the same" replaced.
   Closed.
4. **Fix 7, alternatives (text, measured).** SWC 1.15.47 pin: installs and builds, keeps the plugin and the
   unminified chunk. `pnpm unlink`: 10.33.0 "Nothing to unlink", override and local build kept; 11.28.5 removes it
   (Elata's packageManager is 10.33.2). `esbuild: false`: pnpm 11.28.5 install 0, build 0 (5.8 s); with
   `--no-optional` allow and deny both fail on rollup's native package, so the evidence does not separate them;
   allow kept on the tie (Elata root allows esbuild). All under "Considered" in fix7.md. Closed.
5. **Fix 7, colleague's matrix, stale pr/ sentence, docs head (text).** Matrix re-run on b94551e vs main, 50 cells
   (npm 10.9.7, pnpm 9.15.9, 10.33.2, 11.28.5, 12.11.2; case/tc/matrix-results.tsv): no cell passes on main and
   fails on the branch; branch fails only npm install of the three EEG/PPG starters (ERESOLVE, fix 8's problem,
   same on main). Table in fix7.md. pr/ sentence replaced (aeb6d5b has the tip's tree). Docs head re-checked:
   7f41c86, 15 files with --ignore-workspace (5 English pages), 6 with the plugin (2 English pages). Closed.
6. **Fix 8, release commit sweeps unrelated manifests (code, test-first).** Test extended first: uncommitted edits
   to app-state and biosignal-analytics; red on d23b266 (both swept). Fix 1c4d1fe: new stage_synced_peer_ranges
   stages, per committed manifest outside the release set, HEAD's content with only the moved peers rewritten (one
   shared rewrite with the sync), and only if the working copy carries the rewrite. Green; red again with the
   staging call removed (analytics' committed peer ^0.14.0). By hand: main commits 8 files and leaves app-state,
   d23b266 10 (app-state swept), tip 9 (release set plus analytics' peer) and leaves app-state. Single-target
   release with a hand-bumped rppg-web and no sync: only rppg-web's manifest committed. fix 8 offline suite 16 of
   17 (fix 6's test), run-sh tests ok, audit passes. Closed.
7. **Fix 8, workspace:^ and wide-range alternatives (text, measured).** `npm pack --ignore-scripts` of eeg-web-ble
   with a `workspace:^` peer ships `workspace:^` (npm 10.9.7). Wide ranges with all pending changesets,
   `changeset version` 2.30.0: ppg-web 1.0.0, its peers rewritten to `>=0.12.1` and `>=0.15.0` (no upper bound),
   audit 4 findings. Under "Considered" in fix8.md. Closed.
8. **Fix 6, placeholder scan false positive (code, test-first).** Publish-check test gained a template whose
   pulse-game main.tsx logs `__APP_VERSION__`: red on 7deb183 ("pulse-game: __APP_VERSION__ left in
   src/game/main.tsx"). Fix fef0a51: module code (.js/.ts/.jsx/.tsx and .c/.m forms) is not scanned. Green 21 of 21
   offline; the unfilled-version and 0.12.1 cases still refused. Scanning only the CLI's own keys was rejected
   because copyDir replaces every known key in every file, so that scan can never fire (vacuous); said in fix6.md
   with the cost (an unknown placeholder in module code is not caught; none of today's placeholders is in code).
   Packed check 0.54 to 0.59 s per run under load; `pnpm pack` main 3.1 to 3.2 s, branch 3.9 to 4.4 s (pnpm
   10.33.2 via npx, 3 runs each); prepack's double run is main's own script, stated. Closed.
9. **Fix 7, unlink tests into node:test (code, test-first port).** The 9 cases now run the real `./run.sh unlink`
   with a stub pnpm on PATH, in create-elata-demo's suite. Red on main for the real reason (the starter's link
   override left, "Unlinked" printed); green on b94551e; red with each of the blank-line hold, the package.json
   half, the inline-override stop and the comment-after-key match removed. The bash copy and the
   `__selftest_unlink_overrides` command are removed. Closed.
10. **Windows and macOS; BWK and BusyBox awk.** Not closable here: only mawk is installed (nawk is mawk), the
    BusyBox download is refused by the proxy (403) and building BWK awk from source was refused by this session's
    permission check. CI runs `pnpm test` on ubuntu-latest only (ci.yml), so the bash-only tests skipping elsewhere
    does not affect CI. fix7.md now labels the BWK/BusyBox result as the 2026-10-11 run of the same awk program;
    fix6.md states that only Linux was run. Not closed.

Merge plan updated: tips fef0a51, b94551e, 1c4d1fe; create-elata-demo suite 25 of 25.
