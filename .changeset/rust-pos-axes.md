---
"@elata-biosciences/rppg-web": patch
---

Fix the WASM core following a flickering light instead of the pulse when the multi-region fuser is not in use (`video_frame` mode, including the fallback when MediaPipe does not load, `multiRoiFusion: false`, the skin mask off, and direct `RppgProcessor.pushSampleRgb*` calls). Its colour step added CHROM's two axes, which kept brightness changes and cancelled the pulse. It now uses the POS axes (Wang et al. 2017), which are both blind to brightness, so a lamp cancels whatever the noise in each colour channel. The core's rate and the `getMetrics()` fields that come from it now follow the pulse. Readings made only from fused samples are unchanged, bit for bit.
