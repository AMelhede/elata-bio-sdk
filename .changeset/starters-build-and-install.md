---
"@elata-biosciences/create-elata-demo": patch
---

Fresh starters build and install with current tools: `vite build` failed in every template through `vite-plugin-top-level-await` (current `@swc/core`: "missing field `type`"), so the plugin is gone and the build targets es2022, where top-level await is native; pnpm 10 and later refuse to install until esbuild's build step is allowed by name, so each template lists it (`pnpm-workspace.yaml` `allowBuilds`, and `pnpm.onlyBuiltDependencies` for older pnpm).
