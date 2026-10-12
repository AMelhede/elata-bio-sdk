# generator-build: @amelhede/create-elata-demo 0.12.2-test.1 audit (release/test-1 @ 81b2825)

Workspace: scratch/generator-build (deleted at the end). Source exported read-only with
`git archive 81b2825 packages/create-elata-demo LICENSE scripts/verify-package-build.mjs`.
rppg-web tarball: amelhede-rppg-web-0.15.0-test.16.tgz
sha256 aec6d042ba8b147ae94064b943b1e70bb4a406f14095212bf5bbc1dd9c6bae5c.
Tools: node 22.22.2, npm 10.9.7 (and npm 11.21.0 via npx), pnpm 9.15.9 / 10.33.0 / 12.10.1, publint 0.3.25,
playwright 1.56.1 + /opt/pw-browsers chromium-1194.

## Own release check

```
$ node scripts/check-test-release.mjs
[create-elata-demo test release] @amelhede/create-elata-demo@0.12.2-test.1: ready (5 templates).
$ npm_config_tag=test node scripts/check-test-release.mjs --publish
[create-elata-demo test release] NOT ready:
  @amelhede/rppg-web@0.15.0-test.16 (elataSdkVersions.rppgWeb) is not on npm: a starter could not install it; publish it first
```
(expected: rppg-web test.16 is not on npm yet; PUBLISHING.md says publish it first.)
`npx npm@11 exec --tag test` exports `npm_config_tag=test` to scripts, so the `--publish` tag check sees PUBLISHING.md's flag.
npm 11.21.0 `stage publish` = `Publish` subclass; runs `prepublishOnly` for directory publishes (lib/commands/publish.js:99-106).

Red by construction (scratch copy): no LICENSE -> "missing LICENSE"; edited LICENSE -> "LICENSE is not Elata's MIT notice";
version 0.12.2 -> "is not a -test.N version"; rppg-demo/_gitignore removed -> "templates/rppg-demo/_gitignore is missing".
GAP: `rm -rf templates/pulse-game` -> `ready (4 templates).` exit 0, and then
`node index.mjs y --template pulse-game` -> `Error: ENOENT: no such file or directory, scandir '.../templates/pulse-game'`, exit 1, empty dir `y` left behind.

## Pack, publint, repo validators

```
$ npm pack  -> amelhede-create-elata-demo-0.12.2-test.1.tgz  size 38989  unpacked 199354  entries 72
  integrity sha512-MHR5L9IwHu5k2TLVpXikNw9iz7fd5daktU9Fyt0Lf0PYmr7eHKzuQFKxDVouNHun2u+q1nfafT5ZLat2yt+8gQ==
$ npx npm@11 pack --dry-run --json  -> same 72 files, same integrity
$ npx publint@0.3.25 <tgz> --strict  -> All good!
$ npx publint@0.3.25 <src dir> --strict -> All good!
$ node scripts/validate-tarballs.mjs create-elata-demo (repo's CI validator, pnpm 10.31.0) -> OK: 72 files, all checks passed
$ verify:publish -> Build verification passed
```
`npm pack --json` stdout begins with the prepack line `[create-elata-demo test release] ...: ready`, before the JSON.
Tarball: LICENSE byte-identical to repo root LICENSE (MIT, Copyright (c) 2024 Elata); index.mjs mode 755 with shebang;
every file byte-identical to git HEAD; 67 template files == `git ls-tree` of templates.
grep for local paths (/home, /root, /tmp, /dev/shm, C:\, file:) -> none. grep for dataset names / person names / emails -> none
(only the AMelhede GitHub/npm scope, intended).

## Generate, install, build: 40/40 pass

Method A = `npx --package=<tgz> create-elata-demo app --template T`, then rppg-web dep -> `file:<test.16 tgz>` (as index.test.mjs does).
Method B = literal user commands `npx @amelhede/create-elata-demo@test app --template T`, `npm install` / `pnpm install`,
no edits, against a GET-only static stub serving only the @amelhede scope from the two tarballs (`@amelhede:registry=http://127.0.0.1:4874/`);
everything else from registry.npmjs.org. Nothing was published anywhere.

```
            rppg-demo eeg-demo eeg-ble ppg-demo pulse-game   (install exit / build exit)
A npm10.9.7      0/0      0/0     0/0     0/0      0/0
A pnpm9.15.9     0/0      0/0     0/0     0/0      0/0
A pnpm10.33.0    0/0      0/0     0/0     0/0      0/0
A pnpm12.10.1    0/0      0/0     0/0     0/0      0/0
B npm10.9.7      0/0      0/0     0/0     0/0      0/0
B pnpm9.15.9     0/0      0/0     0/0     0/0      0/0
B pnpm10.33.0    0/0      0/0     0/0     0/0      0/0
B pnpm12.10.1    0/0      0/0     0/0     0/0      0/0
```
npm audit on all 10 npm installs: `found 0 vulnerabilities`. npm installs: no warnings.
B ppg-demo lock: one `node_modules/@elata-biosciences/rppg-web 0.15.0-test.16 ... @amelhede/rppg-web` (alias + `$` override resolve).
Also generated OK: `npm create @amelhede/elata-demo@test`, `pnpm@9.15.9 dlx`, `pnpm@12.10.1 dlx`, `pnpm@12.10.1 create`.
Harness notes: first run's 5 method-A generations failed with ENOENT/ENOTEMPTY in the shared npx cache because three lanes ran
npx on the same tarball at once (my harness, not the package); rerun sequentially, all pass. Bare `pnpm` outside a
packageManager-pinned folder is corepack's 10.33.0, so that lane is reported as pnpm 10.33.0 and pnpm 9 was run as `npx pnpm@9.15.9`.

Warnings:
```
pnpm 12.10.1: [WARN] The "pnpm" field in package.json is no longer read by pnpm. The following keys were ignored: "pnpm.onlyBuiltDependencies".
pnpm 9/10 (eeg-demo, eeg-ble, ppg-demo):  ✕ unmet peer @elata-biosciences/eeg-web@^0.2.1: found 0.12.0
                                          ✕ unmet peer @elata-biosciences/rppg-web@^0.3.0: found 0.15.0-test.16   (ppg-demo)
```
Without the package.json field (scratch variant): pnpm 10.0.0 "build scripts that were ignored: esbuild"; 10.31/10.33/11.28/12.10 fine.

## Heart-rate starter in headless Chromium (fake camera)

`npm run dev` (method B, npm) and `npm run preview` of its build, chromium-1194, `--use-fake-device-for-media-stream`.
```
dev, CDN as this sandbox has it (cdn.jsdelivr.net CONNECT 403):
  pageErrors: []   wasm: 200 application/wasm .../rppg_wasm_bg.wasm   backend wasm, tracking video_frame
  headline: "Failed to fetch dynamically imported module: https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18/vision_bundle.mjs"
  lastError: face_mesh_init_failed ...   BPM "(dash glyph)"  "Looking for a pulse"
dev, jsdelivr URL served from the identical npm package @mediapipe/tasks-vision@0.10.18:
  pageErrors: []   tracking face_mesh   headline "No face in view. Face the camera."   BPM "(dash glyph)"  Last error none
preview (production build): pageErrors: [] failed: [] bad: []   wasm 200 /assets/rppg_wasm_bg-C4umsOzn.wasm
  headline "No face in view. Face the camera."  BPM "(dash glyph)"  "Looking for a pulse"
console (every run): "using deprecated parameters for the initialization function; pass a single object instead"
  from rppg-web dist/wasmBackend.js:66 `await mod.default(options.binaryUrl)` (same line in published 0.14.0)
```
pulse-game dev: index.html pageErrors [] consoleErrors [] failed []; game.html alone shows "Host error: metrics host did not
respond within 5000ms" (expected outside the host shell) and "signal 0%".

## Other findings
- pulse-game still `enableTracker: { minBpm: 55, maxBpm: 150, numParticles: 200 }` and shows `signal {signal_quality}%`,
  stores signalQualityPct; rppg-demo removed both on the fork's own evidence. The template test covers rppg-demo only.
- Scope-sibling lookup: `npm install <cde tgz> <rppg-web test.15 tgz>` then `create-elata-demo app` ->
  `"@elata-biosciences/rppg-web": "npm:@amelhede/rppg-web@0.15.0-test.15"` (not the packaged test.16). Inherited from 0.12.1's `readVersion('../rppg-web/...')`.
- llms.txt lists 3 of 5 templates and the @elata-biosciences commands; README original section lists 3; generated README says
  "generated from ... `@elata-biosciences/create-elata-demo`".
- Not run: index.test.mjs (needs the monorepo siblings), Node 18 (engines >=18), a real face or pulse fixture.
