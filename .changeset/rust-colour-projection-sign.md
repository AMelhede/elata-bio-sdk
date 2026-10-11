---
"@elata-biosciences/rppg-web": patch
---

Fix the WASM core following a flickering light instead of the pulse when the multi-region fuser is not in use (`video_frame` mode, including the fallback when MediaPipe does not load, `multiRoiFusion: false`, the skin mask off, and direct `RppgProcessor.pushSampleRgb*` calls). Its CHROM colour step added its two axes where CHROM subtracts them, which kept brightness changes and cancelled the pulse. The core's rate and the `getMetrics()` fields that come from it (`snr`, `signal_quality`, `confidence`, and its share of `resolved_bpm` and `bpm`) now follow the pulse, and across the switch from camera colour to the fuser the core reads the pulse instead of the jump between the two. Readings made only from fused samples are unchanged.
