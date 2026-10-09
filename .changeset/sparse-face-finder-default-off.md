---
"@elata-biosciences/rppg-web": patch
---

sparseFaceFinder is off unless set to true: in a paired test on recorded captures it added frames but gave a first reading on fewer of them, which its pre-written rule required it not to do.
