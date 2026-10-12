# Fix 6. The starter-app maker crashes on start

- **Problem.** `npx @elata-biosciences/create-elata-demo` exits 1 with "Missing packaged SDK version metadata for
  @elata-biosciences/app-metrics". All 11 published versions from 0.3.1 to 0.12.1 crash; 0.12.1 is still `latest`.
- **Fix.** Ship the missing data, plus release checks that stop it happening again.
- **Verdict.** Strong.
- **Strongest evidence.** One `npx` command on the published package shows it. With fixes 6, 7 and 8 merged, the
  maker's suite passes 25 of 25 on Windows, macOS and Linux, Node 20 and 22 (main 15 of 17); all 5 starters scaffold
  from the packed CLI on all 6 cells (main 0 of 5). See [../../audits/cross-os.md](../../audits/cross-os.md).
- **Cost.** About 1 s more to pack; release order changes (the maker last). 398 lines for a one-key bug, each part
  with a red test.
- **Still open.** CI `pnpm test` is green only together with fix 7.
- **Where.** Branch `fix/create-elata-demo-starts` fef0a51; `pr/create-elata-demo-starts` 8b8ecad (local).

Files: [pr.md](pr.md), audit [../../audits/tooling.md](../../audits/tooling.md), [repro.sh](repro.sh).

```
bash repro.sh          # exit code 1 and the missing-metadata error on 0.12.1
```
