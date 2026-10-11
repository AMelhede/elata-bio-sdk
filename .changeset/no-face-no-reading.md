---
"@elata-biosciences/rppg-web": minor
---

With face tracking on (`face_mesh` mode without an explicit `roi`), drop a frame with no face (drop reason `no_face`, `roiSource` null, no `onStats` call) instead of reading a 100x100 square at the centre of the frame; after one second without a face, report no reading from `RppgSession.getMetrics()` (every estimate and window figure cleared as for a failed backend, reason `no_face`, baseline and calibration state kept), and when the face returns, restart the fuser, the sample window and the engine pipeline, while the Bayesian tracker, the rate history, calibration and the baseline carry over. Add the `requireFace` option (on by default in that mode; `false` keeps the previous behaviour), `DemoRunner.faceAbsentMs()`, `RppgProcessor.resetSignal()` and the `no_face` member of `DemoRunnerDropReason` (an exhaustive switch over it needs a case). `video_frame` mode and an explicit `roi` are unchanged.
