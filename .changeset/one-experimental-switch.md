---
"@elata-biosciences/rppg-web": patch
---

One switch for the experimental readings: the `chestBreathing` option and `session.getChestBreathing()` are removed. The same chest breathing comes in `session.getExperimentalVitals().breathing` with `experimentalVitals: true`, beside HRV, in the box labelled experimental. Two switches for one reading was a way to set it wrong; `getBuildSwitches()` no longer lists `chestBreathing`.
