# Fix 8. Two packages cannot be installed with npm

- **Problem.** eeg-web-ble and ppg-web ask for versions of their sister package (eeg-web ^0.2.1) that were never
  published: ERESOLVE or ETARGET.
- **Fix.** Correct the version ranges, and keep them correct at each release.
- **Verdict.** Strong.
- **Strongest evidence.** Install fails on today's npm packages; the packed fixed eeg-web-ble with eeg-web 0.12.0
  installs and `npm ls --all` is clean. The release test is red on main and green on the branch.
- **Cost.** The next release needs one manual check (the PR says how). Existing apps pin exact versions and need a
  hand edit.
- **Still open.** Shown fixed on npm only once fixed packages are published.
- **Where.** Branch `fix/eeg-web-ble-peer-range` 1c4d1fe; `pr/eeg-web-ble-peer-range` 2d3d672 (local).

Files: [pr.md](pr.md), audit [../../audits/tooling.md](../../audits/tooling.md), [repro.sh](repro.sh).

```
bash repro.sh          # three npm installs: ERESOLVE, ETARGET, ETARGET today
```
