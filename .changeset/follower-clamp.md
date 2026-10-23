---
"@elata-biosciences/rppg-web": patch
---

New pulse-check rule `followerClamp`, OFF by default: the shown 8 s follower line is kept between the proven rate and the current 16 s window (1 bpm margin, `FOLLOWER_CLAMP_BPM`, `clampFollower`). A real capture at rest showed 66 for 2 s while a reference read 57 to 58 because the follower overshot both slower lines. A pre-registered held-out test (8 people at rest and after exercise, scored once): wrong seconds 2 -> 2, mean error to the reference 2.74 -> 2.64 bpm, after exercise 2.40 -> 2.38, seconds with a number unchanged. A weak pass, so off until more data says otherwise.
