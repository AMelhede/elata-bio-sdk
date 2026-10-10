---
"@elata-biosciences/rppg-web": patch
---

`createRppgAppMonitor(...).start()` no longer throws a TypeError ("Illegal invocation" in Chromium) in browsers and Web Workers, so the monitor now emits snapshots on its interval: `start()` and `stop()` call `setInterval`/`clearInterval` as plain functions.
