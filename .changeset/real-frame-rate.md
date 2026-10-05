---
"@elata-biosciences/rppg-web": patch
---

DemoRunner feeds the multi-region fuser on the evenly spaced `sampleRate` grid it assumes (30 by default), interpolating between camera frames, so its band-pass filter, signal-strength weights and projection window no longer assume 30 frames a second when the camera delivers 15 to 25. Gaps over 250 ms are treated as stalls and not bridged, and timestamps reach the processor strictly in order.
