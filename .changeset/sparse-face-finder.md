---
"@elata-biosciences/rppg-web": patch
---

New switch `fixes.sparseFaceFinder` (Speed 5, on by default in this build): the face finder is asked at most every 100 ms (`FACE_FINDER_EVERY_MS`) and the frames in between are read with the last face it found, landmarks and expression scores alike. The finder is the costliest step per frame, so a busy machine reads more of the camera's frames. A lost face stays lost until the finder is next asked (never over 100 ms); a clock that steps back asks again at once. Off: the finder runs on every frame, as published.
