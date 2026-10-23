---
"@elata-biosciences/rppg-web": patch
---

Framing: a head too tall for the frame top to bottom (padded head box over 0.8 of the frame height, new `maxHeight` in `DEFAULT_FRAMING_THRESHOLDS`) now gets "move back" as advice; the rate is never withheld for it (`FramingGuidance.advisory`). Measured on real webcam recordings zoomed in: readings fade from that height while the face is still far under the 0.78 width limit, so before this the person got no instruction. No size gave a wrong reading. `PUBLISHED_FRAMING_THRESHOLDS` keeps no height limit.
