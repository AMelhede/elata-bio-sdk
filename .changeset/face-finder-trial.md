---
"@elata-biosciences/rppg-web": patch
---

New switch `fixes.faceFinderTrial` (Speed 6, on by default in this build): with `faceMesh: "auto"`, the face finder is built on every delegate that exists (GPU first, then CPU), each is timed on the live video (3 warm-up and 10 timed calls), and the faster is kept unless an earlier one is within 25%; a finder whose GPU context is lost, or that finds no face for 2 s after the page returns from hidden, is rebuilt on the same delegate. `session.getFaceFinder()` reports the delegate and each trial's mean. Off: the CPU delegate only, as published. An app passing its own `faceMesh` is unaffected.
