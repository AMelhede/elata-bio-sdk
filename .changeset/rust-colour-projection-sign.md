---
"@elata-biosciences/rppg-web": patch
---

The heart rate read from camera colour without the multi-region fuser (`video_frame` mode, the fallback when the face finder does not load, `multiRoiFusion: false`, the skin mask off, and direct `RppgProcessor.pushSampleRgb*` callers) now follows the pulse instead of a flickering light: the WASM core's CHROM colour step subtracts its two axes, as CHROM does, where it added them, which kept brightness changes and cancelled the pulse. The fused `face_mesh` path reads exactly as before.
