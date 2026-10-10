---
"@elata-biosciences/rppg-web": patch
---

DemoRunner now feeds the multi-region fuser on the even `sampleRate` grid its filters and spectral-SNR weights are designed for, interpolating each region between camera frames; a gap over 250 ms is a stall and is not bridged. Before, the fuser got one sample per frame, so at 15 fps its pass band moved to about 21 to 120 bpm and its warm-up doubled. At exactly `sampleRate` nothing changes. On the fused path the processor receives one sample per grid step, so its `totalSamplesReceived` and `windowSampleCount` count grid samples there; DemoRunner's own diagnostics still count frames.
