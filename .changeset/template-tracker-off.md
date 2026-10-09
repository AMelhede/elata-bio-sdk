---
"@elata-biosciences/create-elata-demo": patch
---

The heart-rate template passes `enableTracker: false`. The session runs the engine's rate tracker unless told not to, and the rate the template shows is the pulse check's, which the tracker does not move.
