---
"@elata-biosciences/rppg-web": patch
---

`createRppgSession` with `backend: "auto"` now reports a WASM core that fails to load. Before, the session fell back to a backend that reads nothing and said nothing: the camera ran, a face was found, and no heart rate ever came, with no error. Now `onError` fires with code `backend_init_failed`, `session.lastError.message` lists the URLs that were tried, and `getState()` reads `degraded` / `startup`. `backend: "wasm"` still throws, as before.
