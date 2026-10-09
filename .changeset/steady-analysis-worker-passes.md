---
"@elata-biosciences/rppg-web": patch
---

steadyAnalysis runs two passes over the window per 250 ms step, the first kept, exactly as the analysis worker's answer did, so with the worker on no number changes, and every read pattern (a managed session on the main thread included) gets the worker's answers instead of an analysis per read.
