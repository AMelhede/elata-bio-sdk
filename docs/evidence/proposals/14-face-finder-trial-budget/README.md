# Fix 14. A face finder trial candidate stops once its calls pass a 2 s budget

- **Depends on.** The face finder trial (`fixes.faceFinderTrial`, `faceFinderTrial.ts`), a fork feature that is not on
  Elata main: the file does not exist at 49fdb41. So this cannot be one commit on 49fdb41. It is one commit on
  `release/test-1` e3e44c3 (test.21), the first tree that has the trial, and goes to Elata only after (or folded
  into) a proposal for the trial itself. Why not a minimal upstream equivalent: main builds the face finder on the
  CPU only and times nothing, so there is no trial to bound; the defect this fixes does not exist there.
- **Problem.** The trial times each delegate (GPU, then CPU) for 13 calls on the live video. A software GPU on a
  heavily throttled device can take seconds a call, so the trial spends tens of seconds on a candidate that can never
  win, and the face is analysed at well under one frame a second for the whole reading.
- **Fix.** A candidate's trial also ends once its calls after the first total 2 s; its mean so far is its result. A
  candidate up to about 150 ms a call is still timed for all its calls.
- **Verdict.** Strong on its own test; one browser caveat (below).
- **Strongest evidence** [synthetic, jest]. A 3.3 s GPU against a 0.15 s CPU: the GPU stops after 2 calls and the CPU
  wins; a 20 ms GPU is timed for all 13 calls and wins; the existing 290 ms GPU against 60 ms CPU case keeps its winner,
  the GPU now cut after 8 calls. Without the fix, 2 of 19 tests fail.
- **Browser** [contributor-side, not rerunnable from this repo]. Under a cgroup CPU limit (2 cores at 40%), 6 captures:
  analysed frames 0.19 to 0.92 a second without, 2.5 to 2.84 with. Unthrottled, unchanged (17.9 to 23.5 either way).
- **Caveat.** At full speed, seconds with a number shown over the repeats were 168 with against 185 without (91%,
  pre-registered bar 90%: passes by one point), and one capture was lower with the fix on every repeat. Not explained.
- **Cost.** A slow candidate's mean comes from fewer calls. One constant.
- **Where.** `fix.patch`: one commit on `release/test-1` e3e44c3; the fork's own commits are b3fe200 and 49e0ece on
  `night/trial-budget`.

Files: [pr.md](pr.md), [fix.patch](fix.patch).

```
git worktree add --detach /tmp/t14 e3e44c3 && cd /tmp/t14 && git am <evidence>/14-face-finder-trial-budget/fix.patch
pnpm install && cd packages/rppg-web && npx jest --config jest.config.cjs faceFinderTrial   # 19 passed
```
