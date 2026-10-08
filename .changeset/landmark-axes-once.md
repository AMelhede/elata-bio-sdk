---
"@elata-biosciences/rppg-web": patch
---

The face's landmark x and y are clamped and sorted once per landmark array (landmarkStats.ts) and shared by the region geometry and the wall patch, which sorted 478 points two or three times a frame; with the sparse face finder the same array serves several frames. Same outputs; region geometry 0.22 to 0.04 ms and wall tracking 0.25 to 0.04 ms per frame.
