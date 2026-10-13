# The pulse check (opt-in; no Elata branch yet)

- **Problem.** With no pulse in view, 0.14.0 still shows a heart rate, and none of its own fields says so.
- **Fix.** Show no number until a pulse is proven: the three face regions agree on one rate above the noise over
  consecutive windows, and light and head rules do not explain it. Method: [../../methods.md](../../methods.md).
- **Verdict.** Strong on known answers; not ready to send.
- **Strongest evidence** [synthetic]. A face with no pulse through the SDK's own session path: a number in 44 of 60 s
  on 0.14.0, 0 with the check. A true 50, 72 or 120 at 30 fps and 50 or 72 at 15 fps: right, from 18 to 22 s.
- **Cost.** First number after 18 to 22 s [synthetic, Node], 23.6 to 28.5 s [synthetic, browser], median 48.6 s
  [owner], instead of 1 to 3 s. Needs a face mesh (Elata's quick start turns it
  off). HRV and breathing withheld while on. About 22 KB gzipped. [owner] wrong on 16.3% of the seconds it showed
  (0.14.0: 85.6%), against a bar of 10% set in advance: **that bar failed**.
- **Limit** [synthetic, 2026-10-12]. With no wall in view, a lamp whose colour change looks like blood (or is
  green, red or opposite to blood) is shown in about 42 of 60 s. Three pre-registered rules were tried and none
  qualified; the one lead (timing spread across face regions) was chosen after looking and fails once the camera
  reads the cheeks a few ms after the forehead (rolling shutter). See [../../open-gaps.md](../../open-gaps.md).
- **Still open.** A branch cut fresh onto Elata main; real-people evidence Elata can check (chest strap or testers);
  real filmed lamp and nod footage; about 2,000 lines, with a split plan written but not cut
  ([split-plan.md](split-plan.md)). The face flicker constant is 7 since test.20 (set on the synthetic lamp sweep;
  the owner recordings only checked that it costs nothing).
- **Why slow or silent** [owner, in-sample, described, nothing tuned]. The 10 of 50 recordings with no number are
  mostly dim captures whose windows pointed at the right rate only 9 times in 100, so withholding was right. Of the
  48.6 s median wait, 18.6 s is the method itself; the rest is windows the rules refused, which were mostly wrong.
  A faster first number needs a better dim-light signal, not a shorter wait. Details: [split-plan.md](split-plan.md).
- **Dim light.** Four candidate rules are in test.21, all off, settings fixed in advance; only the strap study can
  switch one on ([../../open-gaps.md](../../open-gaps.md)).
- **Where.** Method on `release/test-1` 6084d8d (test.21). The older `feat/pulse-check-on-main` is withdrawn.

Files: [case.md](case.md) (proposal outline), [split-plan.md](split-plan.md) (how it splits into PRs), audit [../../audits/pulse-check.md](../../audits/pulse-check.md),
[no-pulse-session.mjs](no-pulse-session.mjs).

```
node no-pulse-session.mjs <0.14.0 dir>                 # a number in 44 of 60 s
node no-pulse-session.mjs packages/rppg-web 0 check    # 0 of 60
node no-pulse-session.mjs packages/rppg-web 72 check   # right from about 20 s
```
