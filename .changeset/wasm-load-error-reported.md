---
"@elata-biosciences/rppg-web": patch
---

`createRppgSession` with `backend: "auto"` now reports a WASM core that fails to load. Before, the session fell back to a backend that reads nothing and raised no error: the camera ran, a face was found, and the engine's own rate never came (with `pulseCheck: false`, no heart rate at all), with only `getState()` reading `degraded` / `startup` to show it. Now `onError` fires with code `backend_init_failed` and `session.lastError.message` lists the URLs that were tried. `backend: "wasm"` still throws, as before.
