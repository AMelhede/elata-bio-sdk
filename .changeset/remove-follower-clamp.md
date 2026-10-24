---
"@elata-biosciences/rppg-web": patch
---

Pulse-check rule `followerClamp` removed (it was off by default, so no default behaviour changes). A second pre-registered held-out test (16 new recordings, 8 people at rest and after exercise, scored once) showed no effect: wrong seconds 3 -> 3, mean error 2.28 -> 2.28 bpm, the same seconds shown. With the first held-out test also unchanged (2 -> 2), the rule did not earn a place. `getPulseCheck().followerBpm` stays.
