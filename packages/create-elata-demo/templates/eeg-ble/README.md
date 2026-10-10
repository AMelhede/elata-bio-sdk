# __APP_NAME__

This app was generated from the `__TEMPLATE_NAME__` template in
`@elata-biosciences/create-elata-demo`.

## What This Demo Shows

- a BLE-first browser EEG starter that opens in **headband** mode by default
- an optional **synthetic** mode when you want to validate the WASM path without hardware
- `@elata-biosciences/eeg-web` WASM models: `band_powers`, `WasmCalmnessModel`, `WasmAlphaBumpDetector`, `WasmAlphaPeakModel`
- `@elata-biosciences/eeg-web-ble` for browser-side Muse BLE connection
- on-screen native reference cards for:
  - `ios-demo/README.md`
  - `ios-demo/EegDemoApp/Bluetooth/MuseBluetoothManager.swift`
  - `android-demo/README.md`
  - `android-demo/app/src/main/AndroidManifest.xml`
- a live canvas waveform, five color-coded band-power meters (delta/theta/alpha/beta/gamma), a calmness score hero number, alpha bump state chips, and a collapsible alpha peak analysis panel

## Requirements

- Chrome, or Bluefy on iOS (Web Bluetooth is required for headband mode; synthetic mode works in any modern browser)
- `https://` or `localhost` (required for Web Bluetooth)
- a supported Muse-compatible EEG device (headband mode only)
- `pnpm` or `npm` to install dependencies

## Run It

```text
pnpm:
pnpm install
pnpm run dev
```

This app ships its own `pnpm-workspace.yaml`, so inside another `pnpm` workspace
it still installs as its own project. From the parent directory:

```text
pnpm:
pnpm --dir __APP_NAME__ install
pnpm --dir __APP_NAME__ run dev

npm:
cd __APP_NAME__
npm install
npm run dev
```

## Notes

- `package.json` has an `overrides` entry so `npm install` works: the `@elata-biosciences/eeg-web-ble` 0.12.0 on npm
  still names `@elata-biosciences/eeg-web` ^0.2.1 as its peer, and the override tells npm it shares this app's own
  `eeg-web`. It can go once eeg-web-ble is republished with its peer range fixed.
- For BLE in this starter, use Chrome or Bluefy on iOS. Do not expect Safari itself to handle the headband flow.
- Synthetic mode generates a synthetic EEG signal locally — no device or Bluetooth is needed and it works in any Chromium or Firefox build.
- This template is a polished integration starting point and works well for demos and screen recordings.
- It uses Vite `?url` imports for the packaged WASM files, so it does not rely on importing `/public/pkg/*` from source code.

## Native BLE References

- iOS native BLE reference: `ios-demo/README.md`
- iOS CoreBluetooth manager: `ios-demo/EegDemoApp/Bluetooth/MuseBluetoothManager.swift`
- Android native demo shell: `android-demo/README.md`
- Android Bluetooth permission wiring: `android-demo/app/src/main/AndroidManifest.xml`
