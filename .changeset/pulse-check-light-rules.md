---
"@elata-biosciences/rppg-web": patch
---

The pulse check's light rules each have their own switch (`pulseCheckRules`: `wallBandEdge`, `lightFamily`, `faceFlicker`, `lightTaint`, all on unless set to false), reported by `getBuildSwitches()`. New rule `lightTaint`: a one-second window whose rate the wall beside the face carries is not counted toward proving a pulse, so a light cannot build up a proof that shows the moment the wall's line dips.
