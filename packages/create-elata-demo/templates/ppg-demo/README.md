# __APP_NAME__

This app was generated from the `__TEMPLATE_NAME__` template in
`@elata-biosciences/create-elata-demo`.

## What This Demo Shows

- Muse PPG acquisition over Web Bluetooth
- `createMusePpgSession()` as the recommended `@elata-biosciences/ppg-web` entrypoint
- a live BPM, RMSSD, SDNN, and signal-quality dashboard
- waveform rendering and transport diagnostics from the selected PPG channel

## Requirements

- a Chromium-based browser with Web Bluetooth support
- a Muse device with PPG data available
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

- `package.json` has `overrides` entries so `npm install` works: on npm, `@elata-biosciences/eeg-web-ble` 0.12.0
  still names `@elata-biosciences/eeg-web` ^0.2.1 as its peer, and `@elata-biosciences/ppg-web` 0.12.0 names
  `eeg-web` ^0.2.1, `eeg-web-ble` ^0.2.1 and `rppg-web` ^0.3.0. The overrides tell npm they share this app's own
  copies. They can go once those two packages are republished with their peer ranges fixed.
- This starter uses the high-level `createMusePpgSession()` API instead of wiring `BleTransport` manually.
- The underlying transport path is the same normalized `HeadbandFrameV1` stream used elsewhere in the SDK.
- Classic Muse `ppgRaw` timing still relies on local frame timing, so HRV should be treated as a developer preview until device timestamps are propagated end to end.
