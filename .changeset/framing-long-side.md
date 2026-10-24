---
"@elata-biosciences/rppg-web": patch
---

Framing: the "move closer" floor (`minWidth`) is judged against the frame's longer side (`longSide` in `DEFAULT_FRAMING_THRESHOLDS`; `FaceBox.frameAspect`, filled in by the session from the frame's size). The face finder reads the whole frame scaled into a small square, so the smallest face it finds is a fixed size against the longer side: in portrait frames (a phone held upright) it lost faces at about the same pixel size as in landscape, a far larger share of the narrow width, so judged by width alone the face was lost before "move closer" could show. Landscape frames are unchanged. `PUBLISHED_FRAMING_THRESHOLDS` judges width alone.
