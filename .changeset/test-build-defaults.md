---
"@elata-biosciences/rppg-web": minor
---

Test-build defaults and API an app sees when it swaps 0.14.0 for this build: the pulse check is on by default (`pulseCheck: false` turns it off); the heart-rate analysis runs in a Web Worker (`fixes.analysisWorker`, or the session option `analysisWorker`, falling back to the main thread when a worker or its WASM cannot start); each camera frame is read at most 640 pixels wide (`fixes.analysisWidth`); new exports `RPPG_WEB_BUILD_VERSION`, `PosPulseModel`, `createWorkerRppgProcessor`, `WorkerRppgProcessor` and `RppgProcessorLike`. Breaking for TypeScript: `RppgSession.processor` is typed `RppgProcessorLike` (the worker or the main-thread processor), not `RppgProcessor`, and `DemoRunnerDropReason` gains `no_face`, so code that switches over it exhaustively needs a case.
