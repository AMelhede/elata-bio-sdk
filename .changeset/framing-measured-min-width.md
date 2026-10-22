---
"@elata-biosciences/rppg-web": minor
---

The framing minimum ("Move a little closer to the camera") is 0.12 of the frame width instead of 0.34. Through `createRppgAppAdapter` a face under the minimum gets no heart rate, and 0.34 held faces at normal laptop distance there: on real webcam recordings faces were 0.136 to 0.263 wide, read right against a reference pulse, and every one was told to move closer with no number shown. 0.12 is measured: the same videos shrunk in the frame lost the face below about 0.10, and from 0.10 to 0.12 some faces read far less often (never wrongly). `PUBLISHED_FRAMING_THRESHOLDS` (new export) restores 0.14.0's rule through `gating.framingThresholds`.
