---
"@elata-biosciences/rppg-web": patch
---

Rule `darkWall` judges the wall against the face. The wall's level as the camera reads it is divided by the face's (the three regions' mean R + G + B), sample by sample, and the swap to green minus the wall needs that ratio at `OWN_PULSE_SWAP_MIN_WALL_TO_FACE` (0.1) or more through the window's darkest tenth (`OWN_PULSE_SWAP_WALL_QUANTILE`). It closes two ways the brightness bar failed: a caller handing colours over on 0..255 was never under it, and a lit patch of wall seen for 5 to 8 s before a dark one lifted the window's mean over it for 1 to 2 s. The ratio does not depend on the colour scale or the camera's exposure. `OWN_PULSE_SWAP_MIN_WALL` is removed; `estimateOwnPulse` reports `wallToFace` and its fifth argument is the ratio bar; `PulseCheckState.windowWallToFace` shows it (`windowWallLevel` stays, as a diagnostic).
