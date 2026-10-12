---
"@elata-biosciences/rppg-web": minor
---

New `calibrationBlend` option on `RppgProcessor`, passed on by `createRppgSession`.
When the processor's own checks pass, `bpm` (and `fused_bpm` without a Muse) has
been the camera calibration's prediction from the spectral and autocorrelation
rates. That model is never trained against another sensor: until a read passes
with a resolved confidence of 0.55 it predicts their plain mean, and after that it
moves toward the processor's own resolved rate by a small step per read. So when
the two rates disagree, `bpm` is a rate neither of them measured: a clean 120 bpm
pulse whose autocorrelation reads 60 shows 95.7 on a single read, and 95.7, 100.3,
104.1 and on to 115.5 over 14 reads at one a second. With
`calibrationBlend: false`, `bpm` is the resolved rate (`resolved_bpm`), the one
the resolver and the rate tracker chose from the engine's, spectral,
autocorrelation and peak rates; `calibrated_bpm` still reports the prediction.
`true`, the default, is the previous behaviour, unchanged.
