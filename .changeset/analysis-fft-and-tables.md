---
"@elata-biosciences/rppg-web": patch
---

The analysis behind `getMetrics` runs about 4.5 times faster: its Hilbert transform (beat timing for HRV) goes through an FFT of any length (Bluestein) instead of a direct O(N^2) transform, which was two thirds of the analysis's time at a 45 s window; the spectral estimate and the breathing estimate compute their Hamming-windowed signal once per call instead of once per frequency; the multi-region fuser's spectral SNR reads its Hann window and per-frequency cosines and sines from tables made once per window length. On 16 recorded captures, every reported field is the same every second except the withheld HRV and breathing values, which move by at most 1e-10; analysis time 227 s to 51 s, fuser 10.6 s to 1.5 s.
