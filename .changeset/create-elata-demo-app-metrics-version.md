---
"@elata-biosciences/create-elata-demo": patch
---

`npx @elata-biosciences/create-elata-demo` (and `npm create @elata-biosciences/elata-demo`) starts again: every release from 0.3.1 to 0.12.1 crashed before doing anything, for every command, unless `@elata-biosciences/app-metrics` was installed beside it, because the CLI reads an `appMetrics` version its package did not carry. The release script now syncs every version the CLI carries, so the next release cannot leave one behind.
