# pkg-tools: package-quality audit of @amelhede/rppg-web 0.15.0-test.16 vs @elata-biosciences/rppg-web 0.14.0

Date 2026-10-10. Workspace scratch/pkg-tools (deleted at the end). Node v22.22.2, npm 10.9.7 (npm 11 via npx for the dry run).
Nothing was published, no login, nothing opened on GitHub. Fork checkout read only with git show/archive.

## Inputs

```
sha256 aec6d042ba8b147ae94064b943b1e70bb4a406f14095212bf5bbc1dd9c6bae5c  amelhede-rppg-web-0.15.0-test.16.tgz
npm pack @elata-biosciences/rppg-web@0.14.0  -> integrity sha512-6W5JmuFSji52m...rbctDWuT3Aa0g==, 110 files
npm view @amelhede/rppg-web -> E404 (name not yet on the registry)
```

## Provenance: the tarball is exactly the committed branch

```
git archive release/test-1 packages/rppg-web LICENSE | tar x -C srctree
cmp every tarball file with srctree/packages/rppg-web/<file>  -> 162 files compared, 0 differ
git diff --stat 4da6ea5 81b2825 -- packages/rppg-web   -> (empty: rppg-web unchanged since the test.16 commit)
node -e (source-stamp.cjs)  tarball dist hash recomputed b32e77dd... == stamp; branch src+README hash 01b9f6cf... == stamp
npm pack (in srctree copy)  -> sha256 aec6d042...  (byte-identical to the audited tarball)
npx npm@11 publish --dry-run --tag test --registry http://127.0.0.1:9/ --userconfig /dev/null
  > prepublishOnly ... ready (162 files checked).  > prepack ... ready.  integrity sha512-vm1tOT0NAL7uC[...]ZEis8xXZ/KVZg==
same without --tag -> "NOT ready: npm tag is 'latest': publish with --tag test" (fails safe)
gh api repos/AMelhede/elata-bio-sdk/branches/release/test-1 -> sha 81b2825b6d7d..., remote package.json blob faae5b8b == local hash-object
```

## publint 0.3.25 --strict

```
npx -y publint@0.3.25 --strict ours.tgz   -> All good!   exit=0
npx -y publint@0.3.25 --strict elata.tgz  -> Suggestion: pkg.repository.url ... could be "git+https://..."  exit=0
```

## Are The Types Wrong (@arethetypeswrong/cli latest)

```
attw ours.tgz  : node10 OK, node16-ESM OK, bundler OK, node16-from-CJS "ESM (dynamic import only)" (CJSResolvesToESM)  exit=1
attw elata.tgz : identical table, identical warning  exit=1
attw <tgz> --profile esm-only --include-entrypoints ./pkg/rppg_wasm.js  -> both exit=0, all green
```

## Clean install, audit, scripts

```
npm install <tgz> --foreground-scripts   ours: added 1 package, audited 2, found 0 vulnerabilities
                                         elata: added 1 package, audited 2, found 0 vulnerabilities
npm ls --all -> one package, no dependencies, both
grep -c hasInstallScript package-lock.json -> 0 both (no preinstall/install/postinstall)
pnpm@9.15.9 add "@elata-biosciences/rppg-web@file:ours.tgz" -> "+ @elata-biosciences/rppg-web <- @amelhede/rppg-web 0.15.0-test.16", import ok
yarn@1.22.22 add same alias -> Done
```
Runtime network loads (both identical): cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18 and the face_landmarker.task model from storage.googleapis.com, via dynamic import with no integrity check.

## package.json fields

ours: name @amelhede/rppg-web, version 0.15.0-test.16, license MIT, author Andreas Melhede, repository git+https://github.com/AMelhede/elata-bio-sdk.git (directory packages/rppg-web), homepage .../tree/release/test-1/packages/rppg-web#readme, bugs https://github.com/AMelhede/elata-bio-sdk/issues, engines node>=20, type module, sideEffects false, main+types, exports {".": {types, import}, "./pkg/*": "./pkg/*"}, files [dist,pkg,README.md,llms.txt,LICENSE], publishConfig {access public, tag test}. Exports map, types, engines, sideEffects identical in shape to 0.14.0.

```
devDependencies "@elata-biosciences/ppg-web": "workspace:*"   (0.14.0 on npm has "0.12.0": pnpm rewrote it, npm stage publish will not)
grep -rn "@elata-biosciences/ppg-web" src e2e scripts bench -> no hits (unused devDependency, also in upstream)
gh api repos/AMelhede/elata-bio-sdk -> {"private":false,"fork":true,"has_issues":false,"license":"MIT",...}
curl https://github.com/AMelhede/elata-bio-sdk/issues/new -> HTTP 404   (repos with issues on answer 403 through this proxy)
node -e 'require("@amelhede/rppg-web")' -> ERR_PACKAGE_PATH_NOT_EXPORTED: No "exports" main defined   (same for 0.14.0)
```

## LICENSE

```
cmp ours/LICENSE elata/LICENSE -> identical;  cmp ours/LICENSE <repo root LICENSE> -> identical
head: "MIT License / Copyright (c) 2024 Elata"
```

## Contents and size

```
ours : tgz 272,926 B, unpacked 965,094 B, 162 files, 51 .d.ts.map (102,142 B)
elata: tgz 180,994 B, unpacked 617,677 B, 110 files, 34 .d.ts.map (60,947 B)
only in elata: (none).  only in ours: 52 files (buildInfo, chestBreathing, faceFinderTrial, fixSwitches, physiologyFeatures,
  processorWorker*, pulseCheck*, roiPixelSampler, roiProfile, waveform*, workerRppgProcessor, source-stamp.json)
no tests, no src, no CHANGELOG, no .env or keys in either. d.ts.map "sources": ["../src/index.ts"] -> src not shipped (both)
```
Scan: fork's own release-scrub.cjs over every file (wasm via printable strings) plus extra greps (names, emails, token patterns, paths):
```
ours  pkg/rppg_wasm_bg.wasm: absolute path: /root/  (string: the Rust toolchain folder/registry/src/index.crates.io-.../js-sys-0.3.106/src/futures/jspi.rs)
elata pkg/rppg_wasm_bg.wasm: absolute path: /Users/<login>/.cargo/registry/src/.../wasm-bindgen-0.2.117/src/externref.rs
"commit hash" hit in both wasm = the public rustc toolchain hash /rustc/4a4ef493.../library/...
text files: no dataset word, no person, no email, no secret pattern, no local path. App-name hits are upstream's own
  (TradeLock identifiers, "Peak times") and the author/fork URL, all intended.
check-test-release.mjs skips *.wasm: `if (p.endsWith(".wasm")) continue;`
```
WASM producers section:
```
ours : rustc 1.94.0 (4a4ef493e 2026-03-02); walrus 0.27.2; wasm-bindgen 0.2.129
elata: rustc 1.94.0 (4a4ef493e 2026-03-02); walrus 0.26.1; wasm-bindgen 0.2.117
no Cargo.lock committed at rppg-web-v0.14.0 nor at release/test-1; crates use wasm-bindgen = "0.2", rustfft = "6.0" (floating)
```

## Base of the build

```
git merge-base --is-ancestor bf1d588 rppg-web-v0.14.0 -> roiProfile commit NOT in v0.14.0 tag
non-fork commits after v0.14.0 in rppg-web/src: 5, all 2026-07-26, upstream developer:
  123e93b harden waveform lifecycle and parity; 3560030 morphology and physiology features; b3650d6 waveform reconstruction host;
  328b33b harden Bayesian tracker extensions (bpmBayesTracker +171, rppgProcessor, rppgSession); bf1d588 versioned ROI profiles (faceRoiOverlay 173 lines rewritten, demoRunner)
README line 3-5: "It is Elata's rPPG web SDK (`@elata-biosciences/rppg-web` 0.14.0, MIT licence) with six fixes ..."
README line 14: "Everything below the 'Switches' section is the upstream documentation, unchanged in substance."
diff of that part vs the 0.14.0 README: 168 changed lines, incl. new sections "Versioned ROI profiles" and "Experimental Bayesian ambiguity penalty" absent from 0.14.0
```

## Importability

Node ESM (Node 22): both import; ours 125 exports, 0.14.0 77; exports removed in ours: none (48 added). WASM glue resolved from `pkg/rppg_wasm.js` and initialised in Node, both.
TypeScript consumer, skipLibCheck false, strict: main entry clean on TS 4.9.5 (node16), 5.0.4, 5.4.5, 5.9.3 (bundler and node16), both packages. Importing the glue types needs lib esnext (`Symbol.dispose`, TS2550), both packages.

Vite 7.1.12, `import { createRppgSession } ...; import wasmJsUrl from ".../pkg/rppg_wasm.js?url"; console.log(...)`:
```
vite build ours : processorWorker-*.js 55.44 kB, index-*.js 125.47 kB (gzip 40.45)   exit 0
vite build elata: index-*.js 73.29 kB (gzip 23.05)                                    exit 0
```
Headless Chromium (Playwright 1.60, chromium-1194), probe that starts the worker processor and the main-thread WASM:
```
vite preview ours : {"version":"0.15.0-test.16","worker":"j"(WorkerRppgProcessor),"mainThreadWasm":true}, worker processorWorker-DlAv7HBs.js loaded
vite preview elata: {"mainThreadWasm":true}
both warn: "using deprecated parameters for the initialization function; pass a single object instead" (ours twice: worker + main)
vite dev ours (default config): {"worker":null,...}
  [http 404] /node_modules/.vite/deps/processorWorker.js?worker_file&type=module
  vite: "The file does not exist at .../.vite/deps/processorWorker.js ... Try adding it to `optimizeDeps.exclude`."
vite dev ours with optimizeDeps.exclude ["@amelhede/rppg-web"]: {"worker":"WorkerRppgProcessor"}, worker loaded from dist/processorWorker.js
```
README/llms.txt never mention optimizeDeps. Existing configs: Peak, Vitality, the demo sandbox and Elata's rppg templates already exclude rppg-web; TradeLock's vite.config.ts does not.

## Versions agree

```
package.json 0.15.0-test.16; dist/buildInfo.js RPPG_WEB_BUILD_VERSION = "0.15.0-test.16"; buildInfo.d.ts same;
README lines 11 and 23 = 0.15.0-test.16; Node import RPPG_WEB_BUILD_VERSION = 0.15.0-test.16.
Other test.N strings: pulseCheck.d.ts history notes "as in 0.15.0-test.2", "as in 0.15.0-test.6" (intended).
gh api repos/AMelhede/elata-bio-sdk/tags -> no test-build tag; README "Source:" names the moving branch release/test-1.
npm view @elata-biosciences/rppg-web@0.14.0 dist -> signatures present, no attestations (no provenance), same as ours will be.
```
