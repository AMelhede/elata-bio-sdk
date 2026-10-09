---
"@elata-biosciences/rppg-web": patch
---

The window analysis (spectrum, autocorrelation, beat timing, breathing) is computed once per set of samples: a second analysis of the same samples, as steadyAnalysis' second pass or two reads with no new sample, reuses the first. It is a pure function of the samples, so every reported number is unchanged.
