---
"@elata-biosciences/rppg-web": patch
---

The pulse check's colour projection (POS) reuses one buffer per signal across its sliding windows instead of building new arrays for every window, with every operation in the order first written: the output is the same to the bit (a test pins it). With the spectrum tables, the check takes 1.07 ms per evaluation second instead of 3.36 ms on 90 recorded captures, every shown second identical.
