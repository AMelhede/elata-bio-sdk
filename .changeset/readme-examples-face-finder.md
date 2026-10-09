---
"@elata-biosciences/rppg-web": patch
---

README and browser guide: every session example now uses `faceMesh: "auto"`. They set `faceMesh: "off"` while the pulse check is on by default and needs face regions, so each example, copied as written, ran and never showed a heart rate. The text now says to set `pulseCheck: false` as well when the face finder is off, gives the real wait before the first number (20 to 40 s of a still, lit face, not 10 s), and says how a WASM load failure now shows (`onError` with `backend_init_failed`).
