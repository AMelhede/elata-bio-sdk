---
"@elata-biosciences/rppg-web": patch
---

0.15.0-test.15: test.14 plus the setup fixes and removals found by building a demo app from scratch: a WASM core that fails to load is reported through `onError` (`backend_init_failed`) instead of a silent session; `createRppgAppMonitor().start()` works in Chromium; README and guide examples keep the face finder on under the pulse check; the `sparseFaceFinder` switch (failed its test, off) and the separate `chestBreathing` switch (the same reading as `experimentalVitals`' breathing) are removed; the demo page shows the checked heart rate only, with the rate tracker off.
