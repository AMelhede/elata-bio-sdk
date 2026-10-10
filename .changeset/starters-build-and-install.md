---
"@elata-biosciences/create-elata-demo": patch
---

Fresh starters build and install with current tools again. `vite build` failed in the starters that bundle `@elata-biosciences/rppg-web` (rppg-demo, pulse-game) once `@swc/core` 1.16.0 was released: `vite-plugin-top-level-await` re-prints every chunk that contains a dynamic `import()` and that version rejects it ("missing field `type`"). No template uses top-level await, so the plugin is removed from all five. pnpm 10 skips esbuild's build step with a warning, and pnpm 11 and later refuse to install until it is allowed, which they read only from `pnpm-workspace.yaml`; each starter now ships one that allows esbuild and lists the app itself (`packages: ['.']`, which pnpm 9 requires). That file also makes a starter its own pnpm project inside another workspace, so the CLI now prints `pnpm --dir <app> install` instead of `--ignore-workspace`, which skips the starter's own file and so fails on pnpm 11 and later.
