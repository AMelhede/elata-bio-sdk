## Issue: `createRppgAppMonitor(...).start()` throws TypeError in browsers and Web Workers

### What happens

In a browser, `createRppgAppMonitor(source).start()` throws a `TypeError` on its first call
(Chromium's message is "Illegal invocation"), and the monitor never emits on its interval: a
subscriber gets only the one immediate snapshot that `subscribe()` sends (when `emitImmediately`
is on, the default), then nothing. This is the
documented path for "You want the SDK to own the update loop entirely": the README example
(`createManagedRppgSession`, then `createRppgAppMonitor(managed, { intervalMs: 500 })`,
`subscribe`, `start()`), the same example in `docs/guides/using-rppg-in-a-browser-app.md`, and
`llms.txt`, which lists `createRppgAppMonitor()` among the higher-level entry points.

### Who is affected

- Any browser app that calls `createRppgAppMonitor(...).start()`, on the main thread or in a Web
  Worker. Verified on `@elata-biosciences/rppg-web@0.14.0` (the current `latest`). The class and
  the call were added together in 2d69a19 (2026-03-19) and the call has not changed since, so
  earlier versions that ship the monitor should behave the same (not run).
- Not affected: apps that poll `createRppgAppAdapter()` themselves, apps that use only
  `createRppgSession()` or `createManagedRppgSession()`, and the `create-elata-demo` starters
  (no template calls `createRppgAppMonitor`). Node is not affected.

### Why

`RppgAppMonitor` stores the host timers on itself and calls them as methods:

```ts
this.setIntervalFn = internals.setIntervalFn ?? setInterval;   // constructor
this.timer = this.setIntervalFn(() => { this.emit(); }, this.intervalMs);   // start()
this.clearIntervalFn(this.timer);   // stop()
```

A method call passes the monitor as `this`. In browsers, `setInterval` and `clearInterval` are
WebIDL operations of the `WindowOrWorkerGlobalScope` mixin (HTML), and WebIDL's "create an
operation function" steps take the `this` value, or the global object if `this` is null or
undefined, and throw a `TypeError` if that object does not implement the interface. So the call
throws in every conforming browser and worker, not only in Chromium. Node and jsdom do not
enforce this rule, which is why the jest suite stays green.

`stop()` has the same defect. It is hidden today because `start()` throws first, and `stop()`
returns early when no timer was set.

### Reproduce on the published package

No bundler is needed: the package has no dependencies and its `dist/` has no bare imports.

```sh
mkdir repro && cd repro && npm init -y && npm install @elata-biosciences/rppg-web@0.14.0
```

`index.html`:

```html
<script type="module">
  import { createRppgAppMonitor } from "./node_modules/@elata-biosciences/rppg-web/dist/index.js";
  const monitor = createRppgAppMonitor({}, { emitImmediately: false });
  try { monitor.start(); console.log("started"); monitor.stop(); }
  catch (e) { console.log(`${e.name}: ${e.message}`); }
</script>
```

Serve the folder (`python3 -m http.server 8080`) and open `http://localhost:8080` in Chrome. The
console prints `TypeError: Illegal invocation` (we ran exactly these steps in headless Chromium 141). The rule on its own, in any browser console:
`({ f: setInterval }).f(() => {}, 1000)` throws, while `const f = setInterval; clearInterval(f(() => {}, 1000))` does not.

Our own observation: headless Chromium 141.0.7390.37, the 0.14.0 files from the npm tarball
imported unbundled (`dist/index.js` and `dist/rppgAppAdapter.js`), on a page and in a module Web
Worker. `start()` threw `TypeError: Illegal invocation` with 0 snapshots in all 4 cases, both with
the default timers and with `setInterval`/`clearInterval` passed to the `RppgAppMonitor`
constructor. In the README's shape (default `emitImmediately`, `subscribe()` then `start()`, 1600 ms
at 100 ms), the listener received exactly 1 snapshot, the immediate one from `subscribe()`, and
`start()` threw. Firefox and Safari were not run; they follow from the spec text above.

---

## PR: fix(rppg-web): call the app monitor's timers as plain functions

Closes #<issue>.

### What changes

- `RppgAppMonitor.start()` and `stop()` read the stored timer into a local and call it plainly
  (`const setIntervalFn = this.setIntervalFn; setIntervalFn(...)`), so `this` is undefined and the
  browser uses the global object. This is the pattern `ManagedRppgSession` already uses for its
  retry timer (`const setTimeoutFn = this.internals.setTimeoutFn ?? setTimeout; setTimeoutFn(...)`).
  It covers the default timers and timers passed as the constructor's third argument. Those
  passed timers are now called with `this` undefined instead of the monitor, as
  `ManagedRppgSession` already calls its own; only a timer that read `this` would notice.
- Two tests, described below.
- A patch changeset for `@elata-biosciences/rppg-web`.

### What does not change

- No type or API change: every built `.d.ts` is byte-identical to main. Of the built `.js` files,
  only `dist/rppgAppAdapter.js` differs, at those two call sites plus a comment
  (`dist/rppgAppAdapter.d.ts.map` only shifts its line mappings).
- Interval, `emitImmediately`, `subscribe`/unsubscribe and `dispose()` behave as before.
- Node: unchanged, since Node never enforced the rule. Our own observation, Node 20.20.2 and
  22.22.2, monitor at 100 ms: 6 snapshots in 650 ms and 0 after `stop()`, on main and on this
  branch.
- One theoretical difference: an app that caught the TypeError and fell back to its own polling
  would, after upgrading, run both loops. Both read the same snapshot, so the only effect is
  extra listener calls. We know of no such app.

### How it was tested

The tests (`packages/rppg-web/src/__tests__/rppgAppAdapter.test.ts`, describe block
"RppgAppMonitor with browser-strict timers") make `setInterval` and `clearInterval` throw
`TypeError("Illegal invocation")` unless `this` is `undefined` or `globalThis`, on top of jest's
fake timers, so jsdom enforces the browser rule. Then, with `intervalMs: 200` and
`emitImmediately: false`: advance 650 ms and expect 3 snapshots, the last with status "ready";
call `stop()`, advance 650 ms and expect still 3. Once through `createRppgAppMonitor`, once with
timers passed to the constructor. They check what the monitor does, not how: a fix that swallows
the error fails them.

Red and green, reproducible by swapping `packages/rppg-web/src/rppgAppAdapter.ts` and running
`pnpm --dir packages/rppg-web test rppgAppAdapter`:

| `rppgAppAdapter.ts` | the two new tests |
|---|---|
| main (49fdb41) | both fail: `TypeError: Illegal invocation` at `start()` |
| main with both calls wrapped in `try {} catch {}` | both fail: 0 snapshots, expected 3 |
| `start()` fixed, `stop()` still `this.clearIntervalFn(...)` | both fail: `TypeError` at `stop()` |
| `start()` fixed, `stop()` swallowing that error | both fail: 6 snapshots, expected 3 |
| this branch | both pass |

The first draft of these tests only asserted "does not throw", and it passed on both swallowing
variants, which is why it was replaced.

Also run on this branch:

- Full rppg-web jest suite: 43 suites, 352 tests pass (main: 43 suites, 350 tests).
- `tsc -p packages/rppg-web`: clean, and also clean with the test files included.
- Biome 1.9.4: lint clean on `rppgAppAdapter.ts`. Its format findings are the same 23
  pre-existing lines on main and on this branch, and none is on a changed line. Test files are
  ignored by `biome.json`; the new tests are in Biome's format anyway, like the rest of that file.
- `node scripts/audit-repo.mjs`: passes.
- Not run here: the Rust jobs, the WASM build and the Playwright e2e. This PR touches no Rust and
  no e2e file.

Real browser, our own observation and not part of the PR: headless Chromium 141.0.7390.37, this
branch's `tsc` build imported unbundled, page and module Web Worker, monitor at 100 ms. `start()`
succeeded, 6 snapshots in 650 ms, 0 after `stop()`, in all 4 cases (default and
constructor-passed timers), against 0 snapshots and a TypeError on 0.14.0. In the README's shape the
listener received 4 snapshots in 1600 ms (1 immediate, then the interval), against 1 on 0.14.0. The same code bundled
with esbuild 0.25.10 (`--minify`), and bundled then minified with terser 5.51.2 (`passes: 3`,
`unsafe`), gave the same result on the page and in the worker. Terser leaves `start()`'s local in
place and rewrites `stop()`'s as `(0,this.clearIntervalFn)(this.timer)`, which is still an
unbound call, so minifiers do not undo the fix.

### Releasing

- Apps that use the monitor need the release that carries this fix. Pending rppg-web changesets
  are minor, so it ships in 0.15.0 unless you cut a 0.14.1; a `^0.14.0` range does not pick up
  0.15.0. Whether to cut 0.14.1 is your call.
- `create-elata-demo` writes exact SDK versions into generated apps. Existing generated apps keep
  the version they were made with, and new scaffolds pick up the fix only when
  `create-elata-demo` is released after rppg-web (`./run.sh release all` does this,
  `./run.sh release rppg-web` alone does not). No starter calls the monitor, so starters as
  generated are unaffected either way.

### Commits

The branch (tip 93db1f3) has four commits. The first (bac1c64, a superseded wrapper approach,
and not in Conventional Commits form) is replaced by the second; the third strengthens the
tests; the fourth puts one line of the new test helper into Biome's format. Our fork's history
only moves forward, so they were not rewritten. Please squash-merge, with the title
`fix(rppg-web): call the app monitor's timers as plain functions`. Net diff against main:
3 files, 78 lines added, 2 removed.

### Not in this PR

- We swept the other packages for host functions stored on an object and called as methods. None
  is on a default path: the other stored host functions are wrapped in arrows, and
  `ManagedRppgSession` already calls its timer plainly. One related caller-side trap, for your
  docs if you want it: `@elata-biosciences/biosignal-session` accepts `options.now`, and passing
  `performance.now` itself (rather than `() => performance.now()`) throws `TypeError: Illegal
  invocation` in a browser however it is called, because `now` belongs to `Performance`, not to the
  global object (headless Chromium 141: method call and unbound call both throw, the arrow does
  not). The default there is already the arrow, so nothing is broken by default and no change is
  proposed.
- A real-browser assertion in CI (adding the monitor to `demo/consumer-smoke.html` and
  `e2e/consumer.spec.ts`) is possible as a follow-up; it is left out to keep this PR to the fix.
  Today it would not
  give a clean signal: in our CI-form runs of main, the e2e step is already red from a server
  start race, unrelated to this change.
