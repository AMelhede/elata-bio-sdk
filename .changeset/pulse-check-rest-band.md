---
"@elata-biosciences/rppg-web": minor
---

Pulse check rule `restBand`, the one rule OFF unless set to true (`pulseCheckRules: { restBand: true }`): a line from 52 to 57 a minute counts when two of the three face regions carry it, as above 58, instead of needing every region. Under 52 nothing changes (every region and the 0 dB edge bar), and the faster strong-evidence path still starts at 58. Off, the check behaves exactly as in 0.15.0-test.28. It adds readings for people with a slow resting rate (a tester at rest, 58 bpm by a reference, the camera's line at 56 in two regions, was refused for most of 2 minutes) and is being measured on real people at rest and on no-pulse captures before any build turns it on.
