---
"@elata-biosciences/rppg-web": patch
---

`createRppgSession({ backend: "auto" })` now keeps the reason when the WASM backend fails to load. The new `getDiagnostics().backendLoadError` (code `backend_init_failed`, stage `backend`) lists the URLs the loader tried, with the last import error as its `cause`, and `normalizeRppgError()` and the app adapter add it to the `backend_unavailable` error's `detail`. Nothing else changes: the session still falls back to `backendMode: "unavailable"`, `state` still reads `degraded` / `startup` / `backend_unavailable`, `onError` is not called and `lastError` stays `null`. `backend: "wasm"` still throws.
