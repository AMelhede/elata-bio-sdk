---
"@elata-biosciences/rppg-web": patch
---

Switch steadyAnalysis (Fix 6): the heart-rate analysis runs at most once per 250 ms of sample time and reads in between get that answer, so the rate no longer depends on how often it is read (published, every read re-ran the analysis and fed the same window to the rate tracker again; a managed session's diagnostics read on every frame, and the analysis worker read twice per answer).
