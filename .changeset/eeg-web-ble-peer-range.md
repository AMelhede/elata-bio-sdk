---
"@elata-biosciences/eeg-web-ble": patch
---

The peer range for `@elata-biosciences/eeg-web` is `^0.12.0`. It was `^0.2.1`, which under npm's rules for versions below 1.0 takes 0.2.x only, and no eeg-web 0.2.x was ever published. So `npm install` refused eeg-web-ble beside any published eeg-web (ERESOLVE), the eeg-ble, eeg-demo and ppg-demo starters from create-elata-demo included, and refused eeg-web-ble on its own (ETARGET).
