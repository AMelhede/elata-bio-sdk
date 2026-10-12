# Runtime robustness audit: fix 9 (app-monitor-timers), fix 10 (report-wasm-load-failure)

Written 2026-10-12 as a maintainer looking for reasons not to merge. No branch was changed.
Pre-registration: case/rt/prereg.md (11:30:10Z, before any run). Raw logs: case/rt/.
Worktrees: scratch/rt/{main 49fdb41, f9 93db1f3, f10 82ff7e0}. Fork tips match local refs
(git ls-remote). pr/ refs have the same tree as each tip, parent 49fdb41, author Andreas Melhede.
Browser: headless Chromium 141.0.7390.37 (Playwright 1.60), one at a time. Node 20.20.2 and 22.22.2.

## Fix 9: monitor timers

Without the change (reproduced, matches the PR)
- PR's index.html verbatim on published 0.14.0: `TypeError: Illegal invocation` (p1p2.txt).
- The one-line rule: method call throws, plain call does not (p1p2.txt).
- 0.14.0 dist and main source have the same start()/stop() code, so one repro covers both.
- 0.14.0 and main built, page and module worker, default and constructor-passed timers, 100 ms:
  start() throws, 0 interval snapshots, all 8 cases (p4p5.txt).
- README shape (default emitImmediately, subscribe then start): the subscriber gets 1 snapshot
  (the immediate one from subscribe), then start() throws. The PR says "never emits a snapshot".
  That is slightly wrong: it never emits on its interval. Text gap.

With the change (checked on the branch tip)
- Branch build: 6 snapshots in 650 ms, 0 after stop(), all 4 cases; README shape 4 snapshots in
  1600 ms. Minified build (f9min) same (p4min.txt).
- New tests: main 2 fail (Illegal invocation), branch 2 pass (p6-main.log, p6-f9.log). Both
  "swallow" variants fail them (6 snapshots, expected 3) and stop() left as a method fails them
  (p6-var-*.log). The PR's red/green table holds.
- Full rppg-web jest: main 43 suites 350, branch 43 suites 352, all pass. tsc clean.

Cost
- Built dist differs from main only in rppgAppAdapter.js and its .d.ts.map. No API, type or
  default change. Runtime cost: none measurable (one local read).
- Timers passed to the constructor are now called with `this` undefined; disclosed.

Objections
- Real bug or theory? Answered: reproduced in Chromium on 0.14.0, page and worker.
- Why CI is green: answered (jsdom/Node do not enforce WebIDL `this`; PR "Why").
- Test that only checks "no throw": answered (counts snapshots; swallow variants go red).
- Other instances of the same pattern: answered by our sweep, none on a default path (the other
  stored host functions are wrapped in arrows; ManagedRppgSession already calls plainly).
  Only a caller passing an unbound `performance.now` as biosignal-session's `options.now` could
  hit the same rule, outside this PR. Not mentioned in the PR; optional text note.
- Firefox, Safari not run: conceded, argued from the spec text; acceptable for a WebIDL rule.
- No real-browser test in CI: gap, offered as follow-up. Elata's e2e step is red on main in every
  CI-form run (server start race, ci-parity-2026-10-11.md), so a browser assertion there would not
  give a clean signal today.
- Commit history (4 commits, first not Conventional Commits): conceded, squash requested; a
  one-commit pr/app-monitor-timers ref exists locally if they refuse squash.
- Interactions: none in merge-plan.md; CI parity shows 0 new failures.
- Private data: none.

Verdict: strong-after-gaps (one sentence of PR text).

## Fix 10: WASM load failure

Without the change (reproduced, matches the PR)
- repro.mjs verbatim, Node 20 and 22, on 0.14.0 and main: all six printed lines match the PR
  (q1q2q3.txt). backendLoadError undefined, detail is the fixed 85-char sentence.
- BPM snippet on 0.14.0: `null` then nineteen `72`, both Node versions. The doc claim is wrong.
- Glue without .wasm, real published glue: 0.14.0 and main add nothing to detail (q4.txt).
- New, not in the PR, real browser (q8.txt), four failing server setups (404 nothing served, glue
  served but .wasm 404, SPA answering index.html for glue and .wasm, SPA with nothing): 0.14.0 and
  main give the same 85-char sentence in all four. Working setup: wasm loads on all three builds.

With the change (checked on the branch tip)
- repro.mjs on the branch: matches the PR's branch output, paths aside.
- Glue without .wasm: first URL "TypeError: fetch failed", then the /rppg_wasm.js not-found,
  detail 387 chars (Node).
- Browser: every failing setup names each URL with its own error. Glue with .wasm 404:
  "TypeError: Failed to execute 'compile' on 'WebAssembly': HTTP status code is not ok". SPA:
  "CompileError: WebAssembly.instantiate(): expected magic word 00 61 73 6d, found 3c 21 64 6f".
  The PR predicted these from the glue source without running a browser; now measured, and they
  agree. Detail grows from 85 to 434 to 446 chars. Working setup: detail null, backendLoadError
  absent, same as main.
- Requests per URL identical on 0.14.0, main and branch in every setup (strict mode adds none).
- New tests: with the repo's jest config main fails to compile (TS2339 backendLoadError); with
  type check off, main fails 5 of 7 session tests (4 and 7 pass) and both L1, L2
  (q5-main-nocheck-v.log). Branch: 13 of 13 pass (q5-f10.log). Matches the PR table.
- Full rppg-web jest: branch 44 suites 359, all pass. tsc clean.
- Built dist differs from main only in the files the PR lists.

Cost
- State, codes, onError, lastError, adapter status, canPublish unchanged (tests 4, 5; browser).
- Type changes additive: optional backendLoadError, RppgWasmLoadError.errors and an optional
  constructor argument, and normalizeRppgError's diagnostics parameter now also accepts
  backendLoadError (widened, not listed in the PR's type paragraph). Text gap.
- normalizedError.detail is about 5 times longer and now carries URLs (host included in a
  browser). No starter, demo or doc in the repo renders detail, but an app that shows or logs it
  will show the longer text. The PR says detail "ends with that message", not how long. Text gap.

Objections
- Real problem? Answered: the reason is discarded on 0.14.0 and main in every failing setup.
- Root cause (root-relative default URLs) not fixed: answered, out of scope, listed as follow-up 1.
- Why not onError/lastError: answered with measurements in the PR ("Why not onError").
- Scope: one PR carries a behaviour addition, a loader field and a docs correction (BPM claim,
  five README places, two guides). Conceded as a fair split request; the docs correction stands
  on its own measurement (19 of 20 polls read 72) and could be its own PR if asked.
- Browser evidence missing: answered now by q8 (our run, not yet in the PR text). Text gap.
- Serialising diagnostics: cause is an Error object; JSON gives `{}` for it but `message` is a
  plain string, so logs keep the reason. No in-repo code serialises diagnostics. Answered.
- Commit history: first commit message repeats claims later found false. Conceded; squash
  requested with a given title and body; one-commit pr/report-wasm-load-failure ref exists locally.
- Changeset patch vs minor: answered, left to the maintainer; release is 0.15.0 either way.
- Interactions: none in merge-plan.md; CI parity 0 new failures.
- Private data: none.

Verdict: strong-after-gaps (text only).

## Gaps

| change | gap | plan | closable now |
|---|---|---|---|
| fix 9 | "never emits a snapshot" is wrong for the README shape (1 immediate snapshot from subscribe) | reword to "never emits on its interval; a subscriber gets only the immediate snapshot from subscribe()" | yes |
| fix 9 | no real-browser assertion in Elata's CI | keep as offered follow-up; Elata's e2e step is red on main from a server race, so fix that first | no |
| fix 9 | optional: same WebIDL rule could hit a caller passing unbound performance.now to biosignal-session options.now | one line under "not in this PR" | yes |
| fix 10 | browser behaviour stated as predicted, not run | add q8 results (four setups, exact errors, request counts, detail 434 to 446 chars) | yes |
| fix 10 | detail length and URL content not disclosed | state 85 to about 440 chars, includes URLs, no in-repo surface renders it | yes |
| fix 10 | type paragraph omits normalizeRppgError's widened parameter type | add it to the additive list | yes |
| fix 10 | docs correction bundled with the behaviour change | offer to split on request | no (owner and maintainer call) |
| both | first commits not Conventional Commits, squash needed | squash request in text; one-commit pr/ refs exist locally, pushing them is the owner's call | no |

## Closed

Pass of 2026-10-12 (prereg line appended to case/rt/prereg.md before the one new run). No branch,
pr/ ref or test changed: every closable gap was PR text, so no push and no merge re-check were needed.

- fix 9, "never emits a snapshot": closed (corrected). fix9.md now says the monitor never emits on
  its interval and a subscriber gets only the immediate snapshot from subscribe(); the README-shape
  numbers (1 snapshot on 0.14.0, 4 in 1600 ms on the branch, p4p5.txt) are in both the issue and the
  browser paragraph.
- fix 9, biosignal-session options.now note: closed, and the measurement corrected our own audit's
  wording. New run (case/rt/pnow.mjs, pnow.txt, Chromium 141): `({now: performance.now}).now()`
  throws Illegal invocation, but so does an unbound `const f = performance.now; f()`, and only the
  arrow works. performance.now belongs to Performance, not the global object, so this is a
  caller-side trap that no call style in the SDK could fix, not the same defect as fix 9. Written
  that way under a new "Not in this PR" section; no change proposed (default is already the arrow).
- fix 9, no browser assertion in CI: not closable; the follow-up line now states why it would not
  give a clean signal today (main's e2e step red from a server start race).
- fix 10, browser behaviour "predicted": closed. q8.txt results added as a table (four failing
  setups plus the working one, exact errors, 434 to 446 characters, identical state/adapter and
  request counts on 0.14.0, main, branch). The "Not run: real browsers" line is replaced.
- fix 10, detail growth and URL content: closed. "What changes" now states 85 to 434-446 characters,
  host in each URL, no in-repo surface renders detail, and how to get the old sentence.
- fix 10, widened normalizeRppgError parameter: closed. Added to the additive-types paragraph
  (verified in the branch diff: DiagnosticsLike picks backendLoadError too).
- fix 10, docs correction bundled: offered in a new "Splitting" section; the split itself is the
  maintainer's call.
- both, squash: unchanged; already requested in text, pr/ refs exist locally, pushing them is the
  owner's call.

Verdict after closing: both stay strong; no evidence went against either change.
