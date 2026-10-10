# __APP_NAME__

This app was generated from the `__TEMPLATE_NAME__` template in
`@elata-biosciences/create-elata-demo`.

## What This Demo Shows

- camera-based rPPG processing in the browser
- `createRppgSession()` as the recommended `@elata-biosciences/rppg-web` app entrypoint
- a large heart-rate readout that shows only a checked rate (the SDK's pulse check: forehead and both cheeks
  agree on one rhythm), says when no face is in view, and session chips tuned for demos
- expandable technical diagnostics (`backendMode`, `issues`, `lastError`, and related fields)

## Requirements

- a modern browser with camera access
- permission to use the camera
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

## Adding the experimental readings

The readout shows only the checked heart rate. HRV and breathing rate are in the SDK too, handed over in their own
box marked experimental, because neither has passed a check against a medical reference yet: against an ECG, camera
HRV read several times too high, and the breathing rate (from chest and shoulder motion) has been checked only on
people sitting still, against a reference worked out from a finger sensor. To show them, label them as experimental:

```ts
const session = await createRppgSession({ video, experimentalVitals: true /* , ...the options in App.tsx */ });

// later, on each update:
const vitals = session.getExperimentalVitals();
// null while the option is off; otherwise { experimental: true, hrvRmssd, breathing }
// hrvRmssd: milliseconds, or null until a pulse is proven; breathing: { rate, share } or null
```

## Notes

- This template is a polished integration starting point and works well for demos and screen recordings.
- It intentionally starts from `createRppgSession()` instead of lower-level `DemoRunner` or `RppgProcessor` wiring.
- It uses Vite `?url` imports for the packaged WASM files, so it does not rely on importing `/public/pkg/*` from source code.
- If you need a deeper reference, compare this app with the monorepo `packages/rppg-web` demo tooling.
