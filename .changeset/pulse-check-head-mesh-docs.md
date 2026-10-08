---
"@elata-biosciences/rppg-web": patch
---

Documentation only: the README's "Things to know" says the `headMotion` rule needs MediaPipe's face mesh (468 points, or 478 with the irises), not just "face landmarks". `headCentre` reads the head's bone landmarks by that mesh's numbering and gives no head for a mesh of 454 points or fewer, so with a 68-point face detector every second is judged `"blind"` and no heart rate is shown while the rule is on.
