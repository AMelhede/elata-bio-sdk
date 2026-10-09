---
"@elata-biosciences/ppg-web": patch
---

The peer ranges take the current siblings: `@elata-biosciences/eeg-web` and `eeg-web-ble` `^0.12.0`, `rppg-web` `^0.14.0`. They were `^0.2.1`, `^0.2.1` and `^0.3.0`, which under npm's rules for versions below 1.0 take 0.2.x and 0.3.x only, so `npm install` refused every app installing the current packages beside ppg-web (ERESOLVE), the PPG starter from create-elata-demo included.
