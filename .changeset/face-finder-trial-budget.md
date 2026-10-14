---
"@elata-biosciences/rppg-web": patch
---

Trial face finder time budget: a candidate's trial also ends once its calls after the first have taken 2 s in total, and its mean so far is its result. On a heavily throttled device the software GPU took about 3.3 s a call, so the 13-call trial spent about 43 s on it before trying the CPU and the face was analysed at about 0.3 frames a second for a whole reading, against about 4 with the trial switched off. A fast candidate is still timed for all of its calls.
