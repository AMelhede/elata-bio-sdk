# The pulse check (opt-in; no Elata branch yet)

- **Problem.** With no pulse in view, 0.14.0 still shows a heart rate, and none of its own fields says so.
- **Fix.** Show no number until a pulse is proven: the three face regions agree on one rate above the noise over
  consecutive windows, and light and head rules do not explain it. Method: [../../methods.md](../../methods.md).
- **Verdict.** Strong on known answers; not ready to send.
- **Strongest evidence** [synthetic]. A face with no pulse through the SDK's own session path: a number in 44 of 60 s
  on 0.14.0, 0 with the check. A true 50, 72 or 120 at 30 fps and 50 or 72 at 15 fps: right, from 18 to 22 s.
- **Cost.** First number after about 20 to 50 s instead of 1 to 3. Needs a face mesh (Elata's quick start turns it
  off). HRV and breathing withheld while on. About 22 KB gzipped. [owner] wrong on 16.3% of the seconds it showed
  (0.14.0: 85.6%), against a bar of 10% set in advance: **that bar failed**.
- **Still open.** A branch cut fresh onto Elata main; real-people evidence Elata can check (chest strap or testers);
  real filmed lamp and nod footage; the face flicker constant from 10 to 7; about 2,000 lines with no split plan.
- **Where.** Method on `release/test-1` c85bc9b (test.19). The older `feat/pulse-check-on-main` is withdrawn.

Files: [case.md](case.md) (proposal outline), audit [../../audits/pulse-check.md](../../audits/pulse-check.md),
[no-pulse-session.mjs](no-pulse-session.mjs).

```
node no-pulse-session.mjs <0.14.0 dir>                 # a number in 44 of 60 s
node no-pulse-session.mjs packages/rppg-web 0 check    # 0 of 60
node no-pulse-session.mjs packages/rppg-web 72 check   # right from about 20 s
```
