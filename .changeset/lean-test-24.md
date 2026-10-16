---
"@elata-biosciences/rppg-web": patch
---

0.15.0-test.24: everything with no measured benefit is removed, not just switched off. Gone: the switches
`realFrameRate`, `steadyAnalysis`, `rgbPulse`, `analysisWorker` and `faceFinderTrial` with their code (the analysis
worker, the frame grid, the face-finder trial, the processor's POS colour path), and the pulse check's four dim-light
candidate rules (`followerMedian`, `reproveOnDrift`, `tooDark`, `anchorDrift`). Each of those parts now behaves as
published 0.14.0. `analysisWidth` is now ON by default: on a heavily slowed CPU, on real recordings, it took the frames
analysed from 3.1 to 3.7 a second to 5.9 to 7.6, and on real recordings with a reference pulse it showed more right
seconds than the default in both of two paired runs, with no wrong second. `RppgProcessorLike` is gone again: the runner and session
take `RppgProcessor`, as in 0.14.0. The four proven fixes, the pulse check and its seven rules are unchanged.
