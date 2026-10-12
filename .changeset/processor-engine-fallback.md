---
"@elata-biosciences/rppg-web": minor
---

New `engineFallback` option on `RppgProcessor`, passed on by `createRppgSession`.
When the processor's own checks refuse a rate (its low-confidence gate: the
estimators disagree, the SNR is under -4.5 dB, the motion is high, or an alias
with a wide spread), `bpm` has fallen back to the WASM core's raw rate, with
`confidence` capped at 0.3, and with fewer than 24 samples it has been the
core's raw rate outright. The core withholds a rate only when its peak is under
1.3 times its noise floor, so with no pulse in view `bpm` was usually still a
number. With `engineFallback: false`, `bpm` (and `fused_bpm`) is null in those
reads; a fresh Muse rate still shows, and every read the gate passes is
unchanged. `true`, the default, is the previous behaviour, unchanged: on the
processor's colour path many of the core's rates in refused reads are right, so
turning the fallback off also removes right readings.
