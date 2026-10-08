---
"@elata-biosciences/rppg-web": patch
---

The pulse check computes each region's POS projection once per window (the colour-damage measure and the region's pulse read the same one) and each wall line once per evaluation (the light taint, the wall check and the state read the same lines). Every field of the check's state is unchanged on 8,055 evaluation seconds of 90 recorded captures; 1.17 to 0.92 ms per evaluation second (3.36 ms at 0.15.0-test.9).
