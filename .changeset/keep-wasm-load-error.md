---
"@elata-biosciences/rppg-web": patch
---

`createRppgSession({ backend: "auto" })` now keeps the reason when the WASM backend fails to load. The new `getDiagnostics().backendLoadError` (code `backend_init_failed`, stage `backend`) lists each URL the loader tried and the error it failed with, and `normalizeRppgError()` and the app adapter add it to the `backend_unavailable` error's `detail`. Its `cause` is the loader's error, which now also has `errors`: what each attempted URL failed with, in order (`lastError` still holds only the last). Nothing else changes: the session still falls back to `backendMode: "unavailable"`, `state` still reads `degraded` / `startup` / `backend_unavailable`, `onError` is not called and `lastError` stays `null`. `backend: "wasm"` still throws the same error with the same message.
