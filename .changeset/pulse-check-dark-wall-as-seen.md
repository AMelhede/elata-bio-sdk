---
"@elata-biosciences/rppg-web": patch
---

Rule `darkWall` now judges the wall's brightness as the camera reads it. The runner hands the check the wall through `WallTracker`, which rescales a new patch to carry on from the last one so the wall's rhythm does not step; after one switch from a brighter patch to a darker one, the rule saw the brighter patch's level and swapped to green minus the wall over a dark wall (the screen-light video read 88 to 91 again with its first second through a brighter patch). `WallTracker.track` (and `next`) now also return `raw`, the patch as read; `PulseCheck.push` takes it as a new last argument `wallRaw` (left out, `wall` is taken as read); `RawRoiSample` may carry that reading after the wall columns; `estimateOwnPulse`'s `wallLevel` and `PulseCheckState.windowWallLevel` are the level as read. The continuous wall still serves the wall's rhythm checks and green minus the wall.
