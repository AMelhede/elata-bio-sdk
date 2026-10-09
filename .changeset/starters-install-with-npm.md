---
"@elata-biosciences/create-elata-demo": patch
---

The EEG, BLE and PPG starters install with `npm install`, the command the CLI prints. The `@elata-biosciences/eeg-web-ble` 0.12.0 on npm names `eeg-web` ^0.2.1 as its peer, so npm refused it beside `eeg-web` 0.12.0 (ERESOLVE); each of these starters now has an `overrides` entry telling npm that eeg-web-ble shares the app's own eeg-web (harmless once eeg-web-ble is republished). The smoke test installs and builds all five starters with npm as well as pnpm (pnpm only warns, which is how this went unseen). The heart-rate starter's README says what it shows and how to turn on the experimental readings.
