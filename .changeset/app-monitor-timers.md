---
"@elata-biosciences/rppg-web": patch
---

`createRppgAppMonitor(...).start()` no longer throws "Illegal invocation" in Chromium: the monitor called the browser's `setInterval` as a method of itself, which browsers refuse; it now calls it through a wrapper.
