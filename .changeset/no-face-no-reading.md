---
"@elata-biosciences/rppg-web": minor
---

With face tracking on (`face_mesh` mode without an explicit `roi`), a frame with no face is dropped (drop reason `no_face`, `roiSource` null) instead of being read from a 100x100 square at the centre of the frame. After one second without a face, `getMetrics()` reports no heart rate, intermediate rates, HRV or breathing (confidence 0, reason `no_face`), and `onStats` does not fire while no face is in view. When the face returns after that second, the multi-region fuser and the processor's signal start afresh (new `RppgProcessor.resetSignal()`), so the next rate is measured only on frames from after the gap. Also new: the `requireFace` option (on by default in that mode, `false` restores the old behaviour), `DemoRunner.faceAbsentMs()`, and the `no_face` member of `DemoRunnerDropReason` (code that switches over it exhaustively needs a case). `video_frame` mode and an explicit `roi` are unchanged.
