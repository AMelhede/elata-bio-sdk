---
"@elata-biosciences/rppg-web": patch
---

Removed the `fixes.sparseFaceFinder` switch and its code. In a paired test on recorded captures it added about one frame a second but gave a reading on fewer of them, so it failed the rule written for it before the test, and it was already off by default. The face finder runs on every frame, as published. `FIX_SWITCHES_OFF_BY_DEFAULT` is gone with it: every remaining switch is on by default.
