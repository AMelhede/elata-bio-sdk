---
"@elata-biosciences/rppg-web": minor
---

New `rgbPulse` option on `RppgProcessor`, passed on by `createRppgSession`.
With `rgbPulse: "pos"` the processor builds the pulse its own estimators read
from colour samples (`pushSampleRgb`, `pushSampleRgbMeta`) with POS and the
0.7 to 4 Hz band-pass, designed for the rate the samples arrive at. The
default, `"chrom"`, is the previous behaviour, unchanged: channel gain, then
`ChromPulseModel`, with the raw green value kept for the first nine samples
and whenever CHROM gives about 0. Those raw values are about a hundred grey
levels beside a pulse of about 0.01 and stay in the 45 s window, and CHROM's
axes keep a constant part that puts the frame-to-frame change of its weight in
the heart-rate band, so on a clean synthetic pulse the processor's spectral
estimate reads 84 whatever the true rate and `bpm` is withheld or wrong. With
`"pos"` both read the true rate. `"chrom"` stays the default because with no
pulse at all `"pos"` reports `bpm` in more seconds at 30 frames a second. A
session feeds colour samples for every frame it does not fuse (no face mesh,
`multiRoiFusion` or `useSkinMask` off, or no face region with skin); fused
samples never take this path.
