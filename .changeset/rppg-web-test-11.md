---
"@elata-biosciences/rppg-web": patch
---

0.15.0-test.11: the analysis 4.5 times faster and the per-frame work about 4 times lighter with the same outputs (Hilbert through an FFT, windows and tables computed once, one region mean per frame, landmarks sorted once per face, the pulse check's projections and wall lines once per evaluation); the face finder on the faster of GPU and CPU for the device, rebuilt when it dies (switch faceFinderTrial); experimental chestBreathing (off by default); the packed release check proves chest motion on a known answer.
