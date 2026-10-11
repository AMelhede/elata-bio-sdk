---
"@elata-biosciences/rppg-web": patch
---

`createRppgSession` with `backend: "auto"` now reports a WASM core that fails to load. Before, the session fell back to a backend that reads nothing and raised no error: the camera ran, a face was found, and the engine's own rate never came (with `pulseCheck: false`, no heart rate at all), with only `getState()` reading `degraded` / `startup` to show it. Now `onError` fires with code `backend_init_failed`; `session.lastError.message` lists each URL that was tried and the error it failed with, and its `cause` is the loader's `RppgWasmLoadError`, which now also has `errors`: what each attempted URL failed with, in order (`lastError` still holds only the last). The telling error is often not the last: when the glue at `/pkg/` loads but its `.wasm` does not, the last error is only the next URL's not-found. `backend: "wasm"` still throws the same error with the same message.
