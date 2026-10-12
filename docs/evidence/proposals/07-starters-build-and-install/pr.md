# Fix 7: fresh starters do not build, and do not install on current pnpm

Branch: `fix/starters-build-and-install` on github.com/AMelhede/elata-bio-sdk, tip b94551e, eight commits on
Elata main 49fdb41. The first three commits carry non-Conventional subjects and broken intermediate states (pnpm 9
cannot install at 0164058), so the PR should go in as one commit. The one-commit version kept locally
(`pr/starters-build-and-install`, aeb6d5b, parent 49fdb41) has exactly the tip's tree.

## Issue

**Title:** Fresh create-elata-demo starters fail `vite build` (rppg-demo, pulse-game) and fail `pnpm install` on pnpm 11+

**Who hits it.** Anyone who generates a starter today and builds it. Two separate causes:

1. **Build.** `vite-plugin-top-level-await` 1.6.0 (its last release, 2025-07-17) re-prints, with SWC, every
   output chunk that contains a dynamic `import()` or a top-level await. `@swc/core` 1.16.0 (2026-08-14)
   rejects that AST: `[vite-plugin-top-level-await] missing field 'type'`. `@elata-biosciences/rppg-web`
   0.14.0 uses dynamic `import()` (dist/wasmBackend.js, dist/mediapipeLoader.js), so every starter that
   bundles it fails: rppg-demo and pulse-game. The three EEG/PPG starters have no dynamic import and still
   build. No template uses top-level await.
2. **Install.** pnpm 10 before 10.26 skips esbuild's build script with a warning. pnpm 11 and later refuse to
   install (`ERR_PNPM_IGNORED_BUILDS`) until the script is reviewed, and they read that review only from
   `pnpm-workspace.yaml` (`allowBuilds`). The starters have no such file.

The same plugin is recommended in `packages/rppg-web/README.md` ("Option A"). That configuration, built on
its own with rppg-web 0.14.0 and the README's own snippet, fails the same way today on Vite 6 and 7, and on
Vite 8 the plugin does not load at all.

**Reproduce** (published 0.12.1 crashes at start for an unrelated reason, issue 6, so from a clone of main):

```bash
node packages/create-elata-demo/index.mjs my-app --template rppg-demo
cd my-app && npm install && npm run build      # missing field `type`
npx pnpm@11 install                             # ERR_PNPM_IGNORED_BUILDS
```

## Pull request

**Title:** fix(create-elata-demo): build and install fresh starters with current tooling

**What changes**

- All five templates: the `vite-plugin-top-level-await` import, its `plugins` entry and its devDependency are
  removed. Nothing else in `vite.config.ts` changes. **The build output moves**, because of what the plugin did:
  it set Vite's `build.target` to `esnext`, then re-printed each JS chunk with SWC down to Vite's default target
  and, since `build.minify` is not set in the config it reads, left it unminified (plugin 1.6.0,
  `dist/index.js` lines 85 to 148). Without it the JS target is the same (Vite's default) but the JS is minified,
  and CSS is now built for Vite's default browsers instead of `esnext`. rppg-demo, Vite 6.4.4, built with npm
  (main built with `@swc/core` pinned to 1.15.47, the last release the plugin works with): main JS chunk 367,179
  bytes (9,874 lines, 83,598 gzip -9), this branch 231,872 bytes (54 lines, 73,071); CSS 8,632 against 8,748
  bytes, which now carries `-webkit-backdrop-filter`, `-webkit-user-select` and an expanded `inset`. The WASM
  glue chunk is byte-identical (7,386).
- Each template ships a `pnpm-workspace.yaml` with `packages: ['.']` (pnpm 9 refuses a workspace file without
  it) and `allowBuilds: { esbuild: true }`, the allowance Elata's own root already makes. Allowing rather than
  denying is deliberate and commented. pnpm 10.26 and later read it too; older pnpm 10 skips the script with a
  warning and the starters still build.
- That file makes each starter its own pnpm project, also inside another workspace. So the CLI's note and the
  docs now say `pnpm --dir <app> install`. The old advice, `--ignore-workspace`, skips the starter's own file
  and fails on pnpm 11+ (it fails on main too).
- Because a starter is now a workspace root, pnpm 9 asks for `-w` on `pnpm add` inside it
  (`ERR_PNPM_ADDING_TO_ROOT`); pnpm 10, 11 and 12 do not. pnpm 9 is past end of life; the docs and the
  changeset say so.
- `./run.sh unlink` removes the `link:` overrides that `pnpm link` records, wherever pnpm put them, and keeps
  everything else: in the app's `pnpm-workspace.yaml` (the file itself only if nothing else is left, blank
  lines and comments inside the `overrides:` block handled as YAML does), and in `package.json`
  `pnpm.overrides`, which pnpm 10 uses instead when the app's package.json has a `pnpm` field. If a link is
  left that it cannot edit (overrides written inline), it stops with an error before reinstalling. Before,
  it refused any workspace file with a `packages` field, ignored package.json, still printed "Unlinked", and
  left the app on the local build.
- `packages/rppg-web/README.md` Option A drops the plugin and sets `build.target: 'es2022'`, needed only on
  Vite 6, whose default target has no top-level await, because its own example awaits at the top level of a
  module.
- Docs updated per CONTRIBUTING step 5: README.md, AGENTS.md, CONTRIBUTING.md, docs/create-elata-demo.md
  (including how to repair a starter from 0.12.1 or earlier), docs/maintainers.md, docs/guides/*, the package
  README, llms.txt and the four template READMEs.

**Considered, and why each lost** (all measured 2026-10-12 on a starter generated by main's or this branch's
CLI, rppg-demo, Node 22.22.2):

- **Pin `@swc/core` below 1.16 in the templates** (npm `overrides: { "@swc/core": "1.15.47" }` on main's
  starter). It installs and builds, so it is the smallest diff. It loses because it keeps a plugin whose last
  release is 2025-07-17 and that breaks again with any SWC change, it keeps the unminified 367,179-byte chunk
  above, it still needs the pnpm 11 change below, and no template uses top-level await, so the plugin does
  nothing these apps need.
- **Use `pnpm unlink` instead of rewriting `./run.sh unlink`.** After `pnpm link ../rppg-local` in this
  branch's starter: pnpm 10.33.0 prints "Nothing to unlink", exits 0, and leaves both the `link:` override in
  `pnpm-workspace.yaml` and the app on the local build; pnpm 11.28.5 removes the override and the app is back
  on rppg-web 0.14.0 from the registry. Elata's own `packageManager` is pnpm 10.33.2, so `pnpm unlink` cannot
  replace the script for the pnpm the repo itself uses.
- **Deny esbuild's build script instead of allowing it** (`allowBuilds: { esbuild: false }`). With pnpm
  11.28.5 it also installs (exit 0) and builds (exit 0, 5.8 s), so the measurement does not choose between the
  two. With optional dependencies skipped (`--no-optional`) both fail the same way, on rollup's native
  package. The tie goes to allow: it is the allowance Elata's own root already makes
  (`pnpm.onlyBuiltDependencies: ["@biomejs/biome", "esbuild"]` in the root package.json), and esbuild's
  install script is the one its maintainers ship to check the platform binary. Changing it is one word in
  five files if a maintainer prefers deny.
- **Keep `--ignore-workspace` advice.** It skips the starter's own `pnpm-workspace.yaml`, so pnpm 11+ fails
  with `ERR_PNPM_IGNORED_BUILDS` (it fails on main too).

**What does not change.** No SDK package code. Already-generated apps (the CLI copies once); the docs say how
to repair one. `ble/` in this repo still uses the plugin but is shielded by its lockfile; out of scope.

**How it was tested**

| check | main | this branch |
|---|---|---|
| smoke test, now all five templates (scaffold, `pnpm install`, `pnpm run build`; corepack's current pnpm, 12.11.2 on 2026-10-12) | fail: `ERR_PNPM_IGNORED_BUILDS` on the first template | pass, 5 of 5 |
| whole create-elata-demo suite (re-run 2026-10-12) | 15 of 17 pass | 18 of 19 pass; the one failing on both is issue 6's packaged-contents test |
| unlink test in the create-elata-demo suite that CI's `pnpm test` runs: the real `./run.sh unlink` with pnpm stubbed on PATH, 9 cases (starter file, mixed overrides, override-only file, blank line and column-0 comment inside the block, comment after the key, package.json overrides with spaces and with tabs, inline overrides) | fail: the starter's `link:` override is left in place and "Unlinked" is printed | pass with mawk 1.3.4 (the only awk in our container on 2026-10-12); removing the blank-line hold, the package.json half, the inline-override stop or the comment-after-key match each turns it red. An earlier version of the same cases, run through a bash test on the same awk program, also passed with BWK awk 20231127 (the macOS awk lineage) and BusyBox 1.36.1 awk on 2026-10-11; we could not re-run those two here |
| real `pnpm link`, then `./run.sh unlink`, on a starter that has its own workspace file | prints "Unlinked", stays on the local build (main leaves any file with `packages` alone; main's own starters have no such file) | back on rppg-web 0.14.0 from the registry, `packages` and `allowBuilds` kept; pnpm 10.33.2, 11.28.5, 12.10.1 and 12.11.2 |
| same, app whose package.json has a `pnpm` field (pnpm 10.33.2 writes the link there) | prints "Unlinked", stays on the local build (also on the previous tip of this branch) | back on 0.14.0, the rest of the `pnpm` field kept |
| same, app whose own overrides are separated by a blank line (pnpm 10.33.2) | stays on the local build (file has `packages`); the previous tip of this branch moved the app's overrides under `allowBuilds`, where they stopped applying | back on 0.14.0, the app's overrides still applied |
| `pnpm --dir app install` from inside a parent workspace | (no workspace file) | own node_modules and lockfile on pnpm 9.15.9, 10.33.2, 11.28.5, 12.11.2 |
| rppg-web README Option A, built alone with rppg-web 0.14.0 | fails: missing field `type` (Vite 6.4.4, 7.3.7), "Cannot find module 'rollup'" (Vite 8.3.4) | builds on all three; without the target it fails on Vite 6 and is byte for byte the same on 7 and 8 |
| create-elata-demo unit tests, smoke test skipped | 15 of 16 pass | 17 of 18 pass |
| `scripts/audit-repo.mjs` | pass | pass |
| Biome 1.9.4 on touched files | 12 files unformatted, 1 lint finding (index.mjs:331), 123 unformatted repo-wide | the same; no new finding |

Our own wider matrix, re-run 2026-10-12 on this tip (runner and results kept with our notes, not in the PR): every
template generated by main's in-repo CLI and by this branch's, each installed and then built (the build attempted
even after a failed install), with npm 10.9.7 and pnpm 9.15.9, 10.33.2 (Elata's `packageManager`), 11.28.5 and
12.11.2. 50 cells.

| tool | main | this branch |
|---|---|---|
| npm 10.9.7 | rppg-demo, pulse-game: install ok, build fails (missing field `type`); ppg-demo, eeg-demo, eeg-ble: install fails (ERESOLVE) | rppg-demo, pulse-game: install and build ok; ppg-demo, eeg-demo, eeg-ble: install fails (ERESOLVE) |
| pnpm 9.15.9, 10.33.2 | rppg-demo, pulse-game: build fails (missing field `type`); the other three ok | all five install and build |
| pnpm 11.28.5, 12.11.2 | all five: install fails (`ERR_PNPM_IGNORED_BUILDS`); rppg-demo and pulse-game cannot build | all five install and build |

No cell passes on main and fails here. The npm failure for ppg-demo, eeg-demo and eeg-ble is a second, separate
problem, the same on both sides: eeg-web-ble 0.12.0 names eeg-web ^0.2.1 as its peer, which is issue 8. Until fixed
packages are published, this branch keeps the smoke test on pnpm; adding npm to it is the follow-up.

**Depends on.** Elata's consumer-smoke CI job also needs issue 6: the packed CLI crashes at load before any
template is copied. CI's `pnpm test` is green only with both PRs (this one alone: 18 of 19, issue 6's
packaged-contents test failing; with both, on the merged tree of all proposed fixes: 25 of 25, smoke included, 2026-10-12). Consumer-smoke
stays red even with both, on a cause already on main: `rppg-models-web` depends on `rppg-web` as `workspace:*`,
which packs as the exact 0.14.0, so the smoke app installs 0.14.0 from npm and fails to build with
`"PREFIX_WAVEFORM_CHANNELS" is not exported`; main's smoke script with its first step cut out fails the same way.

**Not done here, proposed.** Nothing in the release path builds a template (`verify:publish` checks files
exist, `validate-tarballs` checks names) and CI has no schedule, which is how 0.12.1 broke two months after
release without anyone noticing. A scheduled job that scaffolds every template from the PUBLISHED CLI and
installs and builds it with npm and current pnpm would catch the next drift. This PR does not claim to.

Elata's docs site (the `elata-docs` submodule, Elata-Biosciences/docs) still gives the old advice at its head
7f41c86 (2026-10-11, checked 2026-10-12): `--ignore-workspace` in 15 files, five English pages (sdk/create-elata-demo,
sdk/tutorials/first-app, sdk/operations/troubleshooting, sdk/operations/compatibility,
sdk/guides/choose-the-right-package) and their translations (the commit this repo pins, ec1901b, also has it in
overview), and `vite-plugin-top-level-await` for eeg-web in 6 files, two English pages
(sdk/tutorials/eeg-existing-app, sdk/operations/troubleshooting) and their translations. That is a separate
repository, so it needs its own PR once this one lands.

The unlink cases used to live in `scripts/run-sh-tests.sh`, which runs only through `./run.sh test run-sh` and
which CI does not run, and they called an internal self-test command main does not have. They now run in the
create-elata-demo suite CI runs, and that bash test and its self-test command are gone from this PR.
