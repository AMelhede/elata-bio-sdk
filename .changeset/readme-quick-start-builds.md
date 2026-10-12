---
"@elata-biosciences/rppg-web": patch
---

The README's quick start builds when pasted into a new Vite TypeScript app. It kept `const interval` only for a commented-out cleanup, and `npm create vite@latest -- --template vanilla-ts` builds with `tsc && vite build` under `noUnusedLocals`, so `npm run build` stopped at TS6133 before Vite ran (the published 0.14.0 README has the same block). The cleanup now runs when the page goes away (`pagehide`). A test compiles every README example that opens the camera itself under those flags.
