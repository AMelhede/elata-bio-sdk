# Fix 7. New starter apps build and install

- **Problem.** A freshly made app fails `npm run build` ("[vite-plugin-top-level-await] missing field `type`") and
  fails `pnpm install` on current pnpm (ERR_PNPM_IGNORED_BUILDS).
- **Fix.** Drop a dead build plugin and allow the build step esbuild needs.
- **Verdict.** Strong.
- **Strongest evidence.** 5 starters times 5 package-manager versions is 25 pairs (50 cells counting main and the
  branch; table in [pr.md](pr.md)). On main 19 of the 25 fail to install or build; with the fix 3 fail, all three
  the npm install of the EEG and PPG starters, which is fix 8's problem and the same on main. No pair works on main
  and breaks with the fix. Fixed on Windows, macOS and Linux ([../../audits/cross-os.md](../../audits/cross-os.md)).
- **Cost.** pnpm 9 `pnpm add` needs `-w` (pnpm 9 support ended 2026-04-30). The built JS is now minified.
- **Still open.** BWK and BusyBox awk not run; Intel macOS and PowerShell not run. The npm path for the EEG and PPG
  starters waits on fix 8 being published.
- **Where.** Branch `fix/starters-build-and-install` b94551e; `pr/starters-build-and-install` aeb6d5b (local).

Files: [pr.md](pr.md), audit [../../audits/tooling.md](../../audits/tooling.md), [repro.sh](repro.sh).

```
bash docs/evidence/proposals/07-starters-build-and-install/repro.sh   # from the root of an SDK checkout
```
