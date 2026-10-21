---
"@elata-biosciences/rppg-web": patch
---

0.15.0-test.27: a lamp a dim wall shows only faintly is still the lamp's. Pulse-check rule `faintWall` (on by
default): the wall's brightness line withholds a rate from 6 dB above its noise instead of 12. On synthetic video, a
lamp at a heart-like rate with a colour part and no pulse in the face, on a dim wall, stood about 7 dB above the wall's
noise and showed as a heart rate in most seconds under the 12 dB bar; from 6 dB it is withheld. Off: 12 dB, as in
0.15.0-test.26. Not covered by any wall bar: a background the camera replaces with a still image, which carries no
light at all.

Browser, frame-exact replay, test.26 and test.27 interleaved with a planted null (a byte copy of test.26): a 70 bpm
pulse showed a number in 43 of 43 seconds on all three; the lamp on a dim wall with no pulse showed a made-up number in
43 of 43 seconds on test.26 and its copy, and in 0 of 43 on test.27.
