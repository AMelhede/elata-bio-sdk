## Issue: with `backend: "auto"`, a WASM backend that fails to load leaves no record of which URLs were tried or why

### What happens

When `createRppgSession({ backend: "auto" })` cannot load the WASM glue file (`rppg_wasm.js`), it falls
back as designed and says so: `backendMode` is `"unavailable"`, `state` reads `degraded` / `startup` /
`backend_unavailable`, `diagnostics.issues` contains `backend_unavailable`, and `normalizeRppgError()`
returns `backend_unavailable` with setup guidance. The app adapter shows `degraded` and keeps
`canPublish` false.

What an app cannot find out is why. The loader builds most of that information: an
`RppgWasmLoadError` whose message is "Unable to load rPPG WASM backend. Tried: /pkg/rppg_wasm.js,
/rppg_wasm.js. Set up the bundle so one of these URLs resolves.", with the last import error attached
(`wasmBackend.ts`, `RppgWasmLoadError`). But `resolveBackend` calls the loader with
`strict: backendPreference === "wasm"` (`rppgSession.ts:535` on main), and in non-strict mode the
loader returns `null` and the error is discarded. So the app sees "Packaged WASM assets were
unavailable" and generic guidance, never the URLs or the import error. The browser's network log
shows the failed request, but app code and error reporting cannot read it.

Even the error the loader builds keeps only the last URL's error (`lastError`). With the default
candidates that is nearly always the `/rppg_wasm.js` not-found, a URL most apps never serve. When the
glue at `/pkg/rppg_wasm.js` loads but its `.wasm` does not (only the `.js` copied, or an SPA answering
the `.wasm` request with `index.html`), init fails there, the loader moves on, and the error that
explains the failure is dropped. `backend: "wasm"` users get the same partial error today.

The URLs matter because the defaults are absolute from the site root. Our own observation (headless
Chromium 141, published 0.14.0, a plain Vite 8 app following the README usage with `faceMesh: "off"`):
the README's `public/pkg/` default loader fails under `vite dev` (Vite refuses imports from
`/public`, as the README warns) and when the app is built with a sub-path `--base` and served under
that sub-path (the README does not warn about this). README Options A and B, and the `rppg-demo`
starter, loaded at the root and under a sub-path. A `.wasm` served with the wrong MIME type still
loaded. In each failing case the reason an app could show was the same generic sentence.

### Who is affected

- Apps that call `createRppgSession()` or `createManagedRppgSession()` with `backend: "auto"` (the
  default, and every README example) and whose WASM glue does not load.
- Not affected: apps whose WASM loads. `backend: "wasm"` already throws the `RppgWasmLoadError`
  itself, but with only the last URL's error, as above.

### Reproduce on the published package (Node 20 or 22, no browser)

```sh
mkdir repro && cd repro && npm init -y && npm install @elata-biosciences/rppg-web@0.14.0
```

`repro.mjs` (a stub canvas is all `createRppgSession` needs with `autoStart: false`; in Node the
default loader's `import("/pkg/rppg_wasm.js")` fails, which stands in for a URL the bundler does not
serve):

```js
globalThis.document = { createElement: () => ({ getContext: () => ({}) }) };
const pkg = process.argv[2] ?? "@elata-biosciences/rppg-web";
const { createRppgSession, normalizeRppgError } = await import(pkg);

const onErrorCalls = [];
const session = await createRppgSession({
  video: {},
  backend: "auto",
  faceMesh: "off",
  autoStart: false,
  onError: (error) => onErrorCalls.push(error.code),
});
const diagnostics = session.getDiagnostics();
console.log("backendMode:", session.backendMode);
console.log("onError calls:", onErrorCalls, "lastError:", session.lastError);
console.log("state:", JSON.stringify(session.getState()));
console.log("backendLoadError.message:", diagnostics.backendLoadError?.message);
console.log("backendLoadError.cause:", String(diagnostics.backendLoadError?.cause));
const normalized = normalizeRppgError(session.lastError, diagnostics);
console.log("normalized:", normalized.code, "|", normalized.detail);
await session.dispose();
```

`node repro.mjs` prints (we ran it on Node 20.20.2 and 22.22.2):

```
backendMode: unavailable
onError calls: [] lastError: null
state: {"status":"degraded","phase":"startup","terminal":false,"reason":"backend_unavailable","errorCode":null,"errorStage":null}
backendLoadError.message: undefined
backendLoadError.cause: undefined
normalized: backend_unavailable | Packaged WASM assets were unavailable, so the session cannot provide full estimation.
```

### Also wrong in the docs

The README ("BPM will always be null", "metrics will always be null"), `llms.txt` ("`metrics.bpm`
stays null") and the `Metrics.bpm` doc comment every IDE shows ("Null during warmup (~10s) or when
backend is unavailable", `rppgProcessor.ts:75` on main) say a session without the WASM never returns a
BPM. It does: `RppgProcessor.getMetrics()` merges the JavaScript estimators (`bpm: fused.bpm ??
cameraCandidate ?? base.bpm ?? null`, `rppgProcessor.ts:1222` on main), and those run without the
WASM. On the published package, in Node:

```js
import { RppgProcessor, createUnavailableBackend } from "@elata-biosciences/rppg-web";
const processor = new RppgProcessor(createUnavailableBackend(), 30, 10);
processor.enableTracker(55, 150, 200); // what createRppgSession does by default
const polls = [];
for (let i = 0; i < 30 * 20; i++) {
  const t = (i * 1000) / 30;
  processor.pushSampleRgb(t, 90, 100 + 0.5 * Math.sin(2 * Math.PI * 1.2 * (t / 1000)), 80, 1);
  if (i % 30 === 29) polls.push(processor.getMetrics().bpm);
}
console.log(polls.map((b) => (b == null ? "null" : Math.round(b))).join(" "));
```

It prints `null` followed by nineteen `72`s (Node 20.20.2 and 22.22.2): for a clean 72 bpm input, 19
of the 20 once-a-second polls read 72. Our own browser observation agrees: on Chromium's fake camera,
with the WASM glue not served, `getMetrics().bpm` was non-null in 19 of 20 polls. So a number on screen
does not show that the WASM loaded, which is the opposite of what the docs tell people to look for.
The adapter's `canPublish` does stay false.

---

## PR: fix(rppg-web): keep why the WASM backend failed to load in backend auto

Closes #<issue>.

### What changes

- `resolveBackend` calls `loadWasmBackend` with `strict: true` in both modes. Strict mode tries the
  same URLs in the same order and makes no extra requests; it only changes what happens after every
  URL has failed (throw instead of resolving `null`). In `"auto"` the session catches that error and
  keeps it; in `"wasm"` it is rethrown as before.
- The loader records what each attempted URL failed with: `RppgWasmLoadError` gains `errors`, one entry
  per URL in `attemptedUrls`, in the order tried (the import or init error, or an error saying the
  module loaded but exports no pipeline constructor). `lastError` and the message are unchanged, so
  `backend: "wasm"` throws the same error with the same text, now with `errors` on it.
- New optional field `RppgSessionDiagnostics.backendLoadError?: RppgSessionError | null`, always
  present on `getDiagnostics()` and `onDiagnostics` payloads: `code: "backend_init_failed"`,
  `stage: "backend"`, `message` is the loader's message followed by each URL and its error, and
  `cause` is the loader's `RppgWasmLoadError` (with `attemptedUrls` and `errors`). `null` when the
  backend loaded. It is optional in the type, like `modelDiagnostics`, so code that builds diagnostics
  objects by hand (tests, `scripts/verify-consumer-node-smoke.mjs`) still type-checks.
- `normalizeRppgError()`: for `backend_unavailable`, `detail` now ends with that message, so
  `createRppgAppAdapter()` snapshots carry it in `normalizedError.detail`. `code`, `message`,
  `guidance`, `phase`, `retryable` and `terminal` are unchanged. The detail gets longer and now
  contains URLs: in our browser runs it grew from 85 characters to 434 to 446, with the page's
  host in each URL. Nothing in this repo (starters, demo, docs) renders `detail`, but an app that
  shows or logs it will show the longer text; an app that wants the old sentence can still read
  `message`, or `detail` up to its first full stop.
- Docs: the README (five places), `llms.txt`, `docs/guides/using-rppg-in-a-browser-app.md` and
  `docs/guides/troubleshooting.md` describe the field (and the loader's `errors`), and the "BPM is
  always null" claim above is corrected to what is true, in those docs and in the `Metrics.bpm` doc
  comment: `estimationAvailable` is false, `canPublish` stays false, and `getMetrics()` can still
  return a BPM from the JavaScript estimators.
- Seven tests in a new file, two in `wasmBackend.test.ts`, and a patch changeset.

The same Node script, pointed at this branch's `tsc` build (`node repro.mjs <branch>/packages/rppg-web/dist/index.js`):

```
backendMode: unavailable
onError calls: [] lastError: null
state: {"status":"degraded","phase":"startup","terminal":false,"reason":"backend_unavailable","errorCode":null,"errorStage":null}
backendLoadError.message: Unable to load rPPG WASM backend. Tried: /pkg/rppg_wasm.js, /rppg_wasm.js. Set up the bundle so one of these URLs resolves. Errors by URL: /pkg/rppg_wasm.js: Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/pkg/rppg_wasm.js' imported from .../dist/wasmBackend.js; /rppg_wasm.js: Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/rppg_wasm.js' imported from .../dist/wasmBackend.js
backendLoadError.cause: RppgWasmLoadError: Unable to load rPPG WASM backend. Tried: /pkg/rppg_wasm.js, /rppg_wasm.js. Set up the bundle so one of these URLs resolves.
normalized: backend_unavailable | Packaged WASM assets were unavailable, so the session cannot provide full estimation. Unable to load rPPG WASM backend. Tried: /pkg/rppg_wasm.js, /rppg_wasm.js. Set up the bundle so one of these URLs resolves. Errors by URL: /pkg/rppg_wasm.js: Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/pkg/rppg_wasm.js' imported from .../dist/wasmBackend.js; /rppg_wasm.js: Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/rppg_wasm.js' imported from .../dist/wasmBackend.js
```

And the case that needs every URL's error, with the real published glue: copy only
`pkg/rppg_wasm.js` (not its `.wasm`) into a folder and pass `wasmImporter: (url) => url ===
"/pkg/rppg_wasm.js" ? import(<that copy>) : import(url)`. The glue loads, its init cannot fetch the
`.wasm`, and the loader moves on to `/rppg_wasm.js`. The normalized detail, after the fixed first
sentence:

| Build | What the detail adds |
|---|---|
| published 0.14.0 | nothing |
| keeping only the last error (this branch's previous tip, e7d2ddf) | `... Tried: /pkg/rppg_wasm.js, /rppg_wasm.js. ... Cannot find module '/rppg_wasm.js'` |
| this branch | `... Errors by URL: /pkg/rppg_wasm.js: TypeError: fetch failed; /rppg_wasm.js: Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/rppg_wasm.js' ...` |

In Node the `.wasm` fetch fails with "fetch failed" (detail 387 characters). Either way only the
first URL's error says what went wrong.

In a real browser, our own observation: headless Chromium 141.0.7390.37, a static server, the
published 0.14.0, a main build and this branch's build, each imported unbundled into the same page
with `backend: "auto"`, `faceMesh: "off"`, `autoStart: false`, and `normalizeRppgError(null,
getDiagnostics()).detail` read back. Four failing server setups and one working one:

| Server setup | 0.14.0 and main | this branch, errors by URL (`/pkg/rppg_wasm.js`; `/rppg_wasm.js`) |
|---|---|---|
| nothing served (404) | the 85-character sentence | `TypeError: Failed to fetch dynamically imported module: http://<host>/pkg/rppg_wasm.js`; the same for `/rppg_wasm.js` (445 characters) |
| glue served, `.wasm` 404 | the 85-character sentence | `TypeError: Failed to execute 'compile' on 'WebAssembly': HTTP status code is not ok`; fetch failed for `/rppg_wasm.js` (434) |
| SPA answering `index.html`, glue present | the 85-character sentence | `CompileError: WebAssembly.instantiate(): expected magic word 00 61 73 6d, found 3c 21 64 6f @+0`; fetch failed for `/rppg_wasm.js` (446) |
| SPA answering `index.html`, nothing served | the 85-character sentence | fetch failed for both URLs (445) |
| glue and `.wasm` served | WASM loads, detail `null` | WASM loads, detail `null`, `backendLoadError` `null` |

In every setup, state, issues, adapter status, `guidance.code` and `canPublish` were the same on all
three builds, and the server saw the same requests per URL from all three (strict mode adds none).
Firefox and Safari were not run.

### What does not change

Everything an app reads today stays as it is. Each row is asserted by the new tests, against the real
loader with a failing importer:

| What the app reads | main and this branch |
|---|---|
| `onError` | not called |
| `session.lastError` | `null` |
| `getState()` | `degraded` / `startup` / reason `backend_unavailable`, `errorCode` and `errorStage` null |
| `diagnostics.issues` | contains `backend_unavailable` |
| `normalizeRppgError().code` | `backend_unavailable` |
| adapter `status` / `guidance.code` / `canPublish` | `degraded` / `backend_unavailable` / `false` |
| managed session `onStateChange` | `starting`, then `running`, `lastError` null |
| imports attempted | `/pkg/rppg_wasm.js`, then `/rppg_wasm.js`, nothing else |
| `backend: "wasm"` | throws `RppgWasmLoadError` with `attemptedUrls` and the same message |

Built output: of every file in `dist/`, only `rppgSession`, `rppgErrors` and `wasmBackend` (`.js`,
`.d.ts`, `.d.ts.map`) and `rppgProcessor` (`.d.ts`, `.d.ts.map`, the doc comment only) differ from
main. The type changes are all additive: the optional `backendLoadError` on `RppgSessionDiagnostics`
and on the internals object the exported `RppgSession` constructor accepts, and the new `errors`
field (plus an optional third constructor argument) on `RppgWasmLoadError`, which the package index
does not export but `backend: "wasm"` and `loadWasmBackend(..., { strict: true })` throw. And
`normalizeRppgError()`'s second parameter now also accepts `backendLoadError` (its internal
`DiagnosticsLike` type picks one more optional field of `RppgSessionDiagnostics`), so every call
that compiled before still compiles.

### Why not `onError` and `lastError`

The first commit on this branch did report the failure through `onError` and `lastError`, as the
FaceMesh fallback in `"auto"` already does with `face_mesh_init_failed`, and the session types already
declare `backend_init_failed`. We measured what that does (jest, real loader, failing importer, main
against that commit) and backed it out:

- `state.reason` / `errorCode` changed from `backend_unavailable` / `null` to `backend_init_failed`,
  and `normalizeRppgError().code` and the adapter's `guidance.code` changed from
  `backend_unavailable` to `wasm_init_failed`. Both codes are listed as stable categories in the README
  and the browser guide, so an app branching on `backend_unavailable` would stop matching.
- A managed session went `starting`, `starting` (with the error), `failed`, then `running`, and
  ended with `managed.lastError` null, so the error did not even reach managed users.
  `handleSessionError` treats every non-processor error as fatal; during the factory call there is
  no active session to dispose, and the later `running` update overwrites `failed`. An app that
  restarts on `failed` would loop.
- An `onError` handler that touched the session being created made `createRppgSession` reject with
  a `ReferenceError`, because pending startup errors are delivered before it resolves.

The last two already happen today when FaceMesh fails to load in `"auto"`. They belong in their own
fix to `ManagedRppgSession` (record, but do not fail on, startup errors the session survives). Once
that exists, routing the backend failure through `onError` too is a small follow-up if you want it.
This PR keeps to the part no app has to migrate for.

### How it was tested

New file `packages/rppg-web/src/__tests__/createRppgSession.wasmLoadFailure.test.ts`. It does not mock
`../wasmBackend`: it runs the real loader against a `wasmImporter` that rejects with
`TypeError("Failed to fetch dynamically imported module: <url>")`, which is how a browser fails on a
404, an SPA `index.html` or a wrong MIME type. Only the camera frame source, the runner and video
playback are stubbed, as in the existing lifecycle tests. The seven tests:

1. the reason is kept: `backendLoadError` names every URL with its own import error, its cause is the
   loader's `RppgWasmLoadError`, and exactly the two default URLs were tried;
2. when the glue at `/pkg/` loads but its init fails, the message and the normalized detail name that
   failure, not just the next URL's;
3. `normalizeRppgError()` and the adapter carry the reason in `detail`, under the unchanged
   `backend_unavailable` code, with `canPublish` false, and the loader's sentence appears once;
4. nothing the session already reported changes: no `onError`, `lastError` null, same `getState()`;
5. a managed session still goes `starting` then `running`, and its diagnostics keep the reason;
6. a load that fails on the first URL and succeeds on the second reports nothing (no false alarm);
7. `backend: "wasm"` still throws the loader's error.

And in `wasmBackend.test.ts`: L1, strict mode keeps each URL's error in order (`lastError` still the
last); L2, a module that loads but exports no pipeline is recorded as such.

Red and green, by swapping `rppgSession.ts`, `rppgErrors.ts` and `wasmBackend.ts` and running
`pnpm --dir packages/rppg-web test createRppgSession.wasmLoadFailure wasmBackend`:

| Source under test | The seven session tests | L1, L2 |
|---|---|---|
| main (49fdb41) | 5 fail, 2 pass (4 and 7, which pin behaviour main already has) | both fail |
| this branch's first commit (ded44ff) | 6 fail, 1 pass (7) | both fail |
| keeping only the last error (e7d2ddf) | 3 fail (1, 2, 3), 4 pass | both fail |
| this branch | 7 pass | both pass |

With the repo's jest config the main and ded44ff rows fail to compile instead (`TS2339: Property
'backendLoadError' does not exist`); the counts above are with ts-jest's type check switched off, so
the behaviour is what fails.

Each part of the fix was also broken on purpose, one at a time, on this branch:

| Broken on purpose | Tests that fail |
|---|---|
| loader does not pass `errors` to the error it throws | L1, L2, 1, 2, 3 |
| loader records only thrown errors, not a module with no pipeline | L2 |
| session message is the loader's message alone (no errors by URL) | 1, 2, 3 |
| session lists only the last URL's error | 1, 2, 3 |
| `normalizeRppgError` formats the detail from message and cause (repeats the loader's sentence) | 3 |
| `normalizeRppgError` without the new detail | 2, 3 |
| main's non-strict load in `"auto"` | 1, 2, 3, 5 |
| also recording the error as `lastError` / `onError` (the first commit's route) | 3, 4, 5 |
| swallowing the error in `"wasm"` mode too | 7 |
| reporting a failed first URL even though the second loaded | 6 |

Also run on this branch:

- Full rppg-web jest suite: 44 suites, 359 tests pass (main: 43 suites, 350 tests).
- `tsc -p packages/rppg-web --noEmit`: clean, and clean with the test files included.
- Biome 1.9.4: `biome lint` clean on the package's lint scope. `biome format` is clean on
  `rppgSession.ts`; `rppgErrors.ts` (2), `wasmBackend.ts` (3) and `rppgProcessor.ts` (14) have the same
  pre-existing findings as on main, on lines this PR does not touch. Test files are ignored by
  `biome.json`.
- `node scripts/audit-repo.mjs`: passes.
- Package build (`tsc`, `fix-dist-import-specifiers`, `verify-dist-esm`) and
  `scripts/verify-consumer-node-smoke.mjs` on Node 20.20.2 and 22.22.2: pass. The smoke's hand-built
  `backend_unavailable` diagnostics still describe exactly what a live session reports.
- Not run: the Rust jobs, the WASM build and the Playwright e2e. Nothing here touches Rust or the
  WASM build. Real browser: Chromium only, outside CI, in the table above.

### Releasing

- The changeset is `patch`: nothing existing changes, and the new fields are optional or additive. If
  you count them as a feature, make it `minor`. Either way the next rppg-web release is 0.15.0,
  because main already carries four pending `minor` changesets for rppg-web (`calm-pulses-profile`,
  `generic-physiology`, `quiet-waveform-host`, `steady-bayes-config`), so apps on `^0.14.0` will not
  pick it up automatically.
- `create-elata-demo` writes exact SDK versions into generated apps, so new scaffolds get this only
  after `create-elata-demo` is released after rppg-web. The `rppg-demo` starter already shows its own
  "WASM backend not active" message in this state and does not read the new field; that is
  unchanged.

### Not in this PR (each worth its own issue)

1. The load failure itself: the default candidate URLs (`/pkg/rppg_wasm.js`, `/rppg_wasm.js`) are
   absolute from the site root, so a sub-path deploy fails even with `public/pkg/` in place, and Vite's
   dev server refuses the `public/pkg/` import. Documenting the `?url` / `wasmImporter` options as the
   supported path, or deriving the defaults from the module's own URL, would fix that. This PR only
   makes the failure explainable.
2. `ManagedRppgSession` failing on startup errors the session survives (FaceMesh today), described
   above.
3. `recordError` calls `onError` without a `try`/`catch`, before `createRppgSession` resolves.
4. Whether `getMetrics()` should return a BPM from the JavaScript estimators while `backendMode` is
   `"unavailable"`. This PR only stops the docs from saying it never does.
5. The message `backend: "wasm"` throws still names only the URLs; the reasons are in its new `errors`
   field. Putting them in that message too would change thrown text that apps may display, so it is
   left for you to decide. Likewise exporting `RppgWasmLoadError` from the package index, so apps can
   type `backendLoadError.cause` without duck typing.

### Splitting

This PR carries two things: the diagnostics field, and the docs correction ("BPM is always null").
The docs correction stands on its own measurement (19 of 20 polls read 72 without the WASM) and
does not depend on the new field. If you would rather review them separately, say so and we will
split the docs correction into its own PR.

### Commits

The branch has four commits. The first (ded44ff, not in Conventional Commits form, and its message
repeats claims we later found false: "reads nothing", "no number") reported the failure through
`onError` / `lastError`; the second (e7d2ddf) replaces that with the diagnostics field and restores
the lifecycle test file to main; the third (2821356) keeps every URL's error instead of only the
last; the fourth (82ff7e0) corrects the `Metrics.bpm` doc comment. Our fork's history only moves
forward, so they were not rewritten.

Please squash-merge, with the title
`fix(rppg-web): keep why the WASM backend failed to load in backend auto` and the "What changes" list
above as the body, not GitHub's default body, which would include the first commit's message. Recent
PRs here (#21, #22) were merged with merge commits; that would put ded44ff's message into main's
history. If squash is not an option for you, say so and we will open this from a branch with a
single commit. Net diff against main: 11 files, 355 lines added, 25 removed (235 of the added lines
are tests).
