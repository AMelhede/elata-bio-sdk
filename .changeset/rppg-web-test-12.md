---
"@elata-biosciences/rppg-web": patch
---

0.15.0-test.12: the fixes from an adversarial review of test.11 (the trial face finder fails loudly when nothing builds and recovers from lost or throwing finders without rebuilding on every frame; chestBreathing refuses windows with holes and stale motion; exact landmark and region caches); switch steadyAnalysis (Fix 6): the analysis runs at most once per 250 ms of signal however often it is read, so the rate no longer depends on read frequency and a managed session no longer analyses on every frame.
