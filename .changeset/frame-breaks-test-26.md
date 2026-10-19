---
"@elata-biosciences/rppg-web": patch
---

0.15.0-test.26: a break in the frames is not read across. Fix switch `noFramesNoReading` (on by default): while no
frame has arrived for over a second by the wall clock (a frozen camera driver, an ended track, a hidden tab, a locked
screen), `getMetrics()` reports no reading (reason code `no_frames`, `getDiagnostics().framesStopped`), where the
published build kept showing the last number for as long as the frames stayed away; and when the frames' own clock
jumps by more than a second or steps back, the engine's window starts afresh, as it does when a face returns. On a
known 66 bpm in a unit test the window read across the break showed 51 for 35 s after a 10 s freeze, and was wrong
for 75 s after the clock stepped back 30 s. In the browser (fake camera, 70 bpm, frames stopped about 10 s, two runs
per arm): the last number stayed through the whole freeze in test.25 and for under a second in test.26; with the
pulse check off, the number shown after the return read 53 to 54 in test.25 and was within 5 bpm in 95 of 119 and
119 of 120 reads in test.26, after the same few seconds of swing as any fresh start. With the check on, its own
number was right after the return in both builds. Pulse-check rule `clockBack` (on by default): a clock that steps
back starts the check over, as a jump forward already did (it had kept a vanished pulse's 66 to 70 on screen for
37 s); unit tests only, a step back was not produced in the browser. A session the app stopped is not counted.
Also: a frame out of order by under a second is dropped (drop reason `out_of_order`) rather than restarting anything,
and `getDiagnostics().lastSampleAgeMs` is measured on one clock (it subtracted the frames' clock from Date.now() and
read about 55 years).
