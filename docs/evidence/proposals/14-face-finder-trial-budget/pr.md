# Fix 14: the face finder trial spends tens of seconds timing a delegate that cannot win

Base: `release/test-1` e3e44c3 on github.com/AMelhede/elata-bio-sdk (test.21), not Elata main 49fdb41. `fix.patch`
is one commit on e3e44c3 and `git am` applies it cleanly there. It does not apply to 49fdb41, because the file it
changes (`packages/rppg-web/src/faceFinderTrial.ts`) is a fork feature (`fixes.faceFinderTrial`, fork commit
f11c8ee) that Elata main does not have.

## Dependency

Main builds its face finder on the CPU delegate and never times it, so the defect below cannot happen there and
there is no smaller upstream change that carries this fix. It goes to Elata only together with, or after, a
proposal for the trial itself; if the trial is proposed, this commit should be folded into it rather than sent as
a follow-up, so the trial never lands without its budget.

## Issue

**Title:** with `faceMesh: "auto"` and the face finder trial on, a throttled device spends tens of seconds timing a
software GPU before trying the CPU

**How it works today (e3e44c3).** `TrialFaceFinder` runs each candidate for `FINDER_TRIAL_WARMUP_CALLS` (3) plus
`FINDER_TRIAL_TIMED_CALLS` (10) calls on the live video, then keeps the faster. A candidate's trial ends only after
its 13th call. At 3.3 s a call (a software GPU under a CPU limit) that is about 43 s in which the face is analysed
at about 0.3 frames a second, before the CPU, at about 0.15 s a call, is even tried.

## Pull request

**Title:** fix(rppg-web): a face finder trial candidate stops once its calls pass a 2 s budget

**What changes**

- New exported constant `FINDER_TRIAL_BUDGET_MS = 2000`. A candidate's trial also ends once its calls after the
  first (the first pays shader compilation or WASM warm-up) total 2 s; the mean of those calls is its result.
- The full 13-call trial still runs for any candidate up to about 150 ms a call (12 calls fit in 2 s), which covers
  a laptop CPU at its slowest measured under the same limit. So only a candidate too slow to win is cut short.
- A patch changeset. No change to the switch's default, the margin, the rebuild path or `getFaceFinder()`.

**How it was tested**

- `faceFinderTrial.test.ts`, with fake candidates on an injected clock:
  - new: a 3.3 s GPU against a 0.15 s CPU stops after 2 GPU calls, the CPU wins, the GPU is closed, and its result
    is `{ delegate: "GPU", meanMs: 3300 }`;
  - new: a 20 ms GPU is timed for all 13 calls and wins (the budget never cuts a fast candidate);
  - changed: the existing 290 ms GPU against 60 ms CPU case keeps the same winner; the GPU now stops after 8 calls.
- Red without the fix (source reverted, constant kept so the test compiles): 2 of 19 fail. Green with it: 19 of 19,
  on e3e44c3 with `fix.patch` applied by `git am` (2026-10-14); the whole rppg-web jest suite there: 83 suites, 832
  tests pass.

**Browser measurement (contributor-side; not rerunnable from this repo).** Chromium, the session
with `faceMesh: "auto"`, under a cgroup CPU limit (2 cores at 40%), 6 captures: analysed face frames 0.19 to 0.92 a
second without the budget, 2.5 to 2.84 with it. Without the limit: 17.9 to 23.5 a second either way.

**A caveat we owe you.** At full speed, the seconds that showed a number, summed over the repeats, were 168 with the
budget against 185 without: 91%, against a bar of 90% set before the run. It passes by one point, and one capture
was lower with the budget on every repeat. We have not explained that capture; with no slow candidate in play the
budget should not fire, so it may be run-to-run spread, but we have not shown that.

**Costs and limits**

- A cut candidate's mean is from fewer calls (2 at 3.3 s). It only has to lose clearly, and the switch margin
  (`FINDER_SWITCH_MARGIN`, 25%) is unchanged.
- One more constant to keep. 2 s is set from the slowest CPU measured under the limit, not from a sweep of budgets.
