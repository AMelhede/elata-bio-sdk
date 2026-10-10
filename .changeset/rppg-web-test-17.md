---
"@elata-biosciences/rppg-web": patch
---

0.15.0-test.17: test.16 plus fixes from a review against the published packages. The pulse check's path is unchanged, so results measured on test.16 hold for it.
- The signal really starts afresh when a face returns after a second away: new `RppgProcessor.resetSignal()` (and the worker's) drops the sample window and starts the engine's pipeline anew. The runner called a `reset()` neither processor had, so the engine's window spanned the gap and scaled its own rate down (a 66 bpm known answer read 51 for over half a minute after a 10 s gap; now 66). `experimentalVitals` no longer waits 45 s for the window to clear.
- An engine error inside the analysis worker now reaches the app as it does on the main thread: the next push throws it, so the runner stops and reports `processor_error` and a managed session can restart.
- `createRppgAppMonitor`'s timers are called as plain functions (no type change), which also covers timers handed to the `RppgAppMonitor` constructor.
- README: says what the build is built from (Elata main as of 2026-07-26: 0.14.0 plus Elata's unreleased changes), and that Vite's dev server needs `optimizeDeps.exclude` for the analysis worker.
