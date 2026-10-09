---
"@elata-biosciences/rppg-web": patch
---

0.15.0-test.13: test.12 plus two exact speed changes: the window analysis is computed once per set of samples (steadyAnalysis' second pass and back-to-back reads reuse it), and the WASM core keeps its periodogram and cepstrum trig tables and computes the cepstrum once per ranking. Every reported number is unchanged.
