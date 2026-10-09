---
"@elata-biosciences/create-elata-demo": patch
---

Every starter installs under pnpm 9 again. Each starter's `pnpm-workspace.yaml` (added so current pnpm allows esbuild's build step) had no `packages` field, and pnpm 9 stops on that ("packages field missing or empty"). The file now lists the app itself (`packages: ['.']`) beside `allowBuilds`. A test checks every template's file has both.
