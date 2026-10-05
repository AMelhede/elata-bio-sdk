---
"@elata-biosciences/rppg-web": minor
---

With face tracking on, a frame with no face is dropped (drop reason `no_face`) instead of reading a square in the middle of the frame, and the session reports no heart rate, intermediate rates, HRV or breathing (confidence 0, reason `no_face`) once no face has been in view for a second, and the analysis restarts when the face returns. New option `requireFace` and drop reason `no_face`. Whole-frame mode and an explicit `roi` are unchanged.
