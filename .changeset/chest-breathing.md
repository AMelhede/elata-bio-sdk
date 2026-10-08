---
"@elata-biosciences/rppg-web": patch
---

New experimental option `chestBreathing` (off by default): the breathing rate from the up-and-down motion of the chest and shoulders in a box below the chin (1.6 face widths wide, from 0.15 to 1.15 face heights under the chin), each frame's shift found by a one-parameter Lucas-Kanade fit, added up, resampled at 4 Hz, detrended, band-passed 0.1 to 0.6 Hz and read as the strongest line over 32 s. `session.getChestBreathing()` returns `{ rate, share }`; `getChestMotionSamples()` the motion kept; `getBuildSwitches().chestBreathing` says whether it runs. It does not touch `respiration_rate`. Its rate step reproduces, window for window, a method measured on recorded captures against a finger-sensor breathing reference; its motion step is new and is being measured in the browser.
