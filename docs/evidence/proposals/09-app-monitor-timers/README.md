# Fix 9. The app monitor crashes in browsers

- **Problem.** `createRppgAppMonitor().start()` throws "TypeError: Illegal invocation" in the browser: the timers are
  called as methods of an object, not of `window`.
- **Fix.** Call the timers without a `this`.
- **Verdict.** Strong.
- **Strongest evidence.** On 0.14.0 in Chromium 141 `start()` throws in 8 of 8 setups (page and worker, default and
  passed timers). With the fix: 6 snapshots in 650 ms, 0 after `stop()`. Two tests red on main, green on the branch.
- **Cost.** None measured. Timers passed to the constructor are called with `this` undefined (disclosed).
- **Still open.** Firefox and Safari not run (argued from the WebIDL spec). No alternatives section in the PR.
- **Where.** Branch `fix/app-monitor-timers` 93db1f3; `pr/app-monitor-timers` 9132e83 (local).

Files: [pr.md](pr.md), audit [../../audits/runtime.md](../../audits/runtime.md), [index.html](index.html) (open in
a browser after the install line at its top).
