# Fix 12. Hide the engine's unchecked rate: withdrawn as code, sent as an issue

- **Problem.** When the processor's own checks refuse a rate, `bpm` shows the engine's raw rate anyway.
- **Why withdrawn.** The existing field `fused_bpm` already gives the checked number: it matched the option's `bpm`
  in 5,440 of 5,440 reads. Apps can read it today. A smaller alternative (hide early reads) failed the bar set before
  it was tested [owner]: it hid 11 wrong numbers for every 2 right ones against a bar of 10 to 1.
- **What is sent.** The bug report, [issue.md](issue.md), naming `fused_bpm` and its wrong doc comment ("Same as bpm
  when no external source is active", false in every refused read). No PR is opened.
- **Strongest evidence** [synthetic]. An engine stub that always says 88 and no pulse at all: `bpm` 88 every second,
  `fused_bpm` null, confidence 0.20.
- **Where.** Branch `fix/no-engine-fallback` 6894d3a; `pr/no-engine-fallback` 13793e5 (local). Not in the test build.

Files: [issue.md](issue.md) (what is sent), [pr.md](pr.md) (the withdrawn PR, kept as the record), audit [../../audits/processor.md](../../audits/processor.md), [fallback.mjs](fallback.mjs).

```
node fallback.mjs <0.14.0 dir>      # bpm 88 every second; fused_bpm null
```
