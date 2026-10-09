---
"@elata-biosciences/create-elata-demo": patch
---

The heart-rate starter says "No face in view" only once the face has been gone long enough that no rate is reported (`getDiagnostics().faceGone`), not on one missed frame beside a live rate, and its label follows the number shown ("Pulse found" whenever a checked rate is on screen, which can happen while the WASM engine is unavailable). The test build's npm links point at the fork, not Elata's repo. Starters install rppg-web 0.15.0-test.16.
