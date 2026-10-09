---
"@elata-biosciences/rppg-web": minor
---

New option `experimentalVitals` (off by default): HRV and breathing in their own box, `session.getExperimentalVitals()`, labelled experimental, for research and testing. Breathing is chest breathing. HRV comes from the session's latest `getMetrics()` read, only while a face is in view, the pulse check (when on) still shows the rate it proved, and the analysis holds no samples from before the face last came back; with the pulse check off, the engine's own HRV. With the pulse check on, `getDebugSnapshot()` now withholds HRV and breathing too, as `getMetrics()` already did; `session.processor`, the raw engine, is not filtered. The runner now reports `msSinceAnalysisRestart()`, the time since the face came back after an absence long enough to restart the analysis.
