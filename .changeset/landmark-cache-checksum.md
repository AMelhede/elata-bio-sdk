---
"@elata-biosciences/rppg-web": patch
---

The landmark sort cache checks a checksum of every coordinate, so a face source that rewrites one landmark array in place gets fresh region boxes instead of the last face's.
