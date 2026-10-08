---
"@elata-biosciences/rppg-web": patch
---

The pulse check's spectrum reads its sines and cosines from tables made once per window length, instead of computing a sine and a cosine for every bin of every sample. Same values (a test pins them to the textbook transform at seven window lengths), half the check's time: 3.36 ms to 1.56 ms per evaluation second on 90 recorded captures (7,881 evaluation seconds), with every shown second identical (567 of 567), and the same 366 right and 17 wrong seconds on 35 recordings of a second person.
