---
"@elata-biosciences/rppg-web": patch
---

0.15.0-test.23: the five speed changes without a measured benefit on recorded captures are off unless set to true
(`realFrameRate`, `steadyAnalysis`, `analysisWidth`, `analysisWorker`, `faceFinderTrial`), so those parts behave
as published. faceFinderTrial was measured as the cause of the slow-CPU regression: on a heavily slowed processor,
0.19 to 0.64 frames analysed a second with it on, 3.93 to 4.26 with it off. Each can be switched on to compare, and
comes back on by default only with its own measurement. The proven fixes and the pulse check are unchanged.
