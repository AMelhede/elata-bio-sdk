---
"@elata-biosciences/create-elata-demo": patch
---

The PPG starter installs with `npm install`: the `@elata-biosciences/ppg-web` 0.12.0 on npm names `eeg-web` ^0.2.1, `eeg-web-ble` ^0.2.1 and `rppg-web` ^0.3.0 as peers, so npm refused it (ERESOLVE); the starter now tells npm that ppg-web shares the app's own copies. A new test resolves every starter with npm against the registry (lockfile only).
