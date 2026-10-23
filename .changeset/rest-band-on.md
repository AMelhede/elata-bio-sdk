---
"@elata-biosciences/rppg-web": patch
---

Rule `restBand` is now on unless set to false: a resting line from 52 to 57 a minute that two of the three regions carry counts when it reaches -2 dB, where before every region had to carry it. A pre-registered test on people and no-pulse video it was not tuned on added no invented and no wrong second; on one tester's resting captures it showed a rate for longer, every second within 5 bpm of a reference. `pulseCheckRules: { restBand: false }` restores the 58 edge.
