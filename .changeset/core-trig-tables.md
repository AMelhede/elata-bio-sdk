---
"@elata-biosciences/rppg-web": patch
---

The WASM core keeps the periodogram's cos/sin and Hann tables and the cepstrum's cos table between reads (recomputed only when the window length, rate or band changes), and computes the cepstrum once per ranking instead of once per candidate. Each table entry is computed exactly as before, so every reported number is unchanged; a core read takes about a tenth of the time.
