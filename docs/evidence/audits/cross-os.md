# Cross-OS evidence: fixes 6, 7, 8 (starter maker, starters, peer ranges)

Written 2026-10-12. GitHub Actions on the public fork, AMelhede/elata-bio-sdk. No PR, no publish, nothing sent to Elata.

## Bottom line

The three fixes behave the same on Windows, macOS and Linux, on Node 20 and 22. Nothing passes on main and
fails with the fixes, on any OS. No Windows or macOS defect found.

## What ran

Two branches, same workflow file (`.github/workflows/cross-os.yml`), 12 jobs each:

- `ci/cross-os`: Elata main 49fdb41 + merge of fix/create-elata-demo-starts (fef0a51),
  fix/starters-build-and-install (b94551e), fix/eeg-web-ble-peer-range (1c4d1fe) + the workflow. Tip 34329b6.
  Merging fix 8 hit the one known conflict (the `node:fs` import line in
  `packages/create-elata-demo/index.test.mjs`, documented in fix6.md). Resolved as the union (keep `statSync`).
  No other conflict. Treat that one resolution as mine, not as a clean merge.
- `ci/cross-os-main`: plain 49fdb41 + the same workflow. Tip 557e8a5. This is the "before".
- Runs: fixes 38266663606, main 38266666781 (an earlier pair, 38266516102 and 38266511415, was cancelled
  after I added result annotations; the built-in `gh` cannot download job logs, so results are reported as
  annotations and read through the check-runs API).

Matrix: windows-latest, macos-latest (arm64), ubuntu-latest; Node 20 and 22. Steps per job:

1. `pnpm install --frozen-lockfile` at the root (pnpm 10.33.2 from `packageManager`).
2. The create-elata-demo suite (`node --test index.test.mjs`, the package's own test script). Its smoke test
   installs and builds every template with corepack's pnpm (12.11.2 that day).
3. `pnpm pack` of create-elata-demo, then each of the five starters scaffolded from that tarball with
   `npx --package=./<tgz> create-elata-demo`, then installed and built with npm (10.9.x) and with pnpm 10.33.2.
   If the packed CLI crashed, the step fell back to the in-repo CLI so install and build still have a before
   (marked "in-repo" below).

## Results (identical on all six OS and Node cells for each branch)

The create-elata-demo suite:

| | main | fixes |
|---|---|---|
| Windows, Node 20 and 22 | 15 of 17 pass | 25 of 25 pass, 0 skipped |
| macOS, Node 20 and 22 | 15 of 17 pass | 25 of 25 pass, 0 skipped |
| Linux, Node 20 and 22 | 15 of 17 pass | 25 of 25 pass, 0 skipped |

Main's two failures, on every cell: "scaffolds correctly from packaged contents without monorepo siblings"
(the CLI crash, "Missing packaged SDK version metadata for @elata-biosciences/app-metrics", issue 6) and the
smoke test (`corepack pnpm install` fails, `ERR_PNPM_IGNORED_BUILDS`, issue 7).

0 skipped on Windows matters: the bash tests (three release tests and the unlink test) ran there too, through
Git for Windows' bash, and passed. That closes part of the audit's gap 10. Which awk the macOS image put first on
PATH was not checked, so this does not settle the BWK awk question by itself.

Starters from the packed CLI (scaffold / install / build):

| starter | main, npm | main, pnpm 10.33.2 | fixes, npm | fixes, pnpm 10.33.2 |
|---|---|---|---|---|
| rppg-demo | crash, in-repo: ok / fail | crash, in-repo: ok / fail | ok / ok / ok | ok / ok / ok |
| pulse-game | crash, in-repo: ok / fail | crash, in-repo: ok / fail | ok / ok / ok | ok / ok / ok |
| eeg-demo | crash, in-repo: fail / fail | crash, in-repo: ok / ok | ok / fail / fail | ok / ok / ok |
| eeg-ble | crash, in-repo: fail / fail | crash, in-repo: ok / ok | ok / fail / fail | ok / ok / ok |
| ppg-demo | crash, in-repo: fail / fail | crash, in-repo: ok / ok | ok / fail / fail | ok / ok / ok |

Same table on every OS and Node version. Causes, read from the Windows Node 22 logs of both runs:

- main "crash": the packed CLI throws "Missing packaged SDK version metadata for @elata-biosciences/app-metrics"
  (issue 6). Fixed by fix 6 on all three OSes.
- main rppg-demo and pulse-game build: `[vite-plugin-top-level-await] missing field 'type'` with
  `@swc/core` 1.16.18 (issue 7). Fixed by fix 7 on all three OSes.
- npm install of eeg-demo, eeg-ble, ppg-demo, on both branches: `ERESOLVE`, "peer @elata-biosciences/eeg-web@^0.2.1
  from @elata-biosciences/eeg-web-ble@0.12.0". This is the published 0.12.0 package from npm, so fix 8 cannot
  change it until fixed packages are published. Same on main and fixes; expected, as fix7.md already says. pnpm
  installs the same starters with an "unmet peer" warning (including ppg-web's `rppg-web@^0.3.0` peer) and builds.

Noise, not a finding: on Ubuntu only, three annotations "Option 'moduleResolution=node10' has been removed" appear on
both branches. They come from the build attempted after each failed npm install (no local TypeScript, so the
runner's global tsc runs). Same on main.

## Per OS per Node, job verdict and failing step

| OS / Node | main | fixes |
|---|---|---|
| windows / 20 | fail: suite, npm starters, pnpm starters | fail: npm starters only (the ERESOLVE above) |
| windows / 22 | same | same |
| macos / 20 | same | same |
| macos / 22 | same | same |
| ubuntu / 20 | same | same |
| ubuntu / 22 | same | same |

The fixes' jobs are red only because of the npm ERESOLVE on the published eeg-web-ble 0.12.0, which every cell
on main shares.

## Defects found on Windows or macOS

None. No cell passes on main and fails with the fixes.

## Limits

- Windows ran the steps from bash (Git for Windows). npm, pnpm, node and the CLI are the native Windows
  programs, and the suite's own smoke test goes through `cmd.exe` on Windows, but nothing here ran from
  PowerShell.
- macos-latest is Apple silicon only; Intel macOS was not run.
- The npm path for the EEG and PPG starters can only go green after fixed packages are published; this run cannot
  show fix 8 working through npm.
- pnpm 9 and 11 were not in this matrix (only 10.33.2 and corepack's 12.11.2).

## Where

Branches on origin: `ci/cross-os` (34329b6), `ci/cross-os-main` (557e8a5). Workflow:
`.github/workflows/cross-os.yml`. Runs: https://github.com/AMelhede/elata-bio-sdk/actions/runs/38266663606 (fixes),
https://github.com/AMelhede/elata-bio-sdk/actions/runs/38266666781 (main).
