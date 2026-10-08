---
"@elata-biosciences/rppg-web": patch
---

Each analysed frame averages every face region once: the aggregate, the multi-region fuser and the pulse check read the same skin-masked mean of the same box (it was computed three times), and the five named regions are sampled only when an app's `onRoiSamples` or the experimental waveform model reads them. Same outputs (4,531 session fields identical); the runner's own per-frame work 1.38 to 0.22 ms.
