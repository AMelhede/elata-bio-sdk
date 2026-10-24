---
"@elata-biosciences/rppg-web": patch
---

Guidance: a dark face with no number yet is told "Add light on your face" (`increase_lighting`, advice only; the rate is never withheld). The session reports the face regions' brightness with the face box (`faceLuma`), the adapter passes it to gating, and gating shows the hint under `minFaceLuma` (`DEFAULT_MIN_FACE_LUMA` 0.3, measured on real recordings with the light lowered: readings fell away below it while the capture score stayed high enough that the only light advice never fired, so a person in a dim room was never told to add light). `gating.minFaceLuma: 0` turns it off.
