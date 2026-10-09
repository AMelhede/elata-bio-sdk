---
"@elata-biosciences/eeg-web-ble": patch
---

The peer range for `@elata-biosciences/eeg-web` is `^0.12.0`. It was `^0.2.1`, which under npm's rules for versions below 1.0 takes 0.2.x only, so `npm install` refused every app installing eeg-web 0.12 beside eeg-web-ble (ERESOLVE), the BLE starter from create-elata-demo included.
