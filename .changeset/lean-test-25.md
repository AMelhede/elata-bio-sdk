---
"@elata-biosciences/rppg-web": patch
---

0.15.0-test.25: the pulse check's agreement path is removed (`pulseCheckAgreement`, `PulseCheck.secondOpinion`, the
agreement constants). On real recordings with a reference pulse it added one wrong second, and its gain in right
seconds was inside the run-to-run spread of the default. Old saved recordings still load: their `agreement` flag and
SDK-rate events are ignored on replay. Kept after the same tests: the speed rewrites (about 14% more frames analysed on a
slowed CPU) and the one-second no-face wait (two seconds showed no difference).
