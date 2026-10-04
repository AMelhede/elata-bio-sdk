---
"@elata-biosciences/rppg-web": patch
---

Rust core (`elata-rppg`): the colour projection in `pos_from_rgb_windowed_into` now subtracts (CHROM is X - alpha*Y); the added sign kept room-light flicker and cancelled the pulse. Pre-extracted samples (R = G = B, e.g. the fused pulse from push_sample) pass through per sample, so the fused path reads exactly as before. Needs the WASM in `pkg/` rebuilt before release.
