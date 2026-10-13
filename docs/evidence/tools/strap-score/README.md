# strap-score: the demo page against a chest strap

**Which page.** The demo app `AMelhede/rppg-demo-sandbox`, branch `chore/demo-test-19` (on test.21 since
2026-10-13). Its **Save readings** button writes the rate the page shows (`session.getMetrics()`) and, since test.21,
what the library's pulse check was fed, as one JSON file (see "Replay" below); **Save as table (CSV)** writes the
per-second numbers alone, in the older CSV format, which this script still reads. Its `main` is still
on 0.14.0 with no such button, and the SDK's own `packages/rppg-web/demo` page has only "Download session", which
records the engine's unchecked rate (`processor.getMetrics()`), not the shown one. Score only Save readings files,
and check the `library_version` column says the test build.

A tester wears a chest strap while the demo page runs, then sends two kinds of file: the page's
**Save readings** file (one row per second: `epoch_ms`, `bpm_shown`, `confidence`, `library_version`, in the JSON file's
`readings`, or the CSV `epoch_ms,iso_time,bpm_shown,confidence,library_version`) and the strap app's export. This script lines them up by clock time and says, second by second, whether the page was
right. It needs Node 18 or newer and nothing else.

## Run it

```
node strap-score.mjs --strap <strap export> --tz <phone's time zone> calm.csv stairs.csv dim.csv
```

- Name each page file by its condition (`calm.csv`), or write `calm=demo-readings-...csv`. One strap file can
  cover every condition; several `--strap` files are joined.
- `--tz` is the phone's time zone (`Europe/Stockholm`, `+02:00`). Strap apps write local time with no zone; the page
  writes UTC. Without `--tz` the script stops and says so rather than guess.
- `--start 2026-10-12T14:03:05+02:00` is for strap files with no clock times (Kubios, a plain RR list).
- `--lag 0` skips the lag search (see "Refused" below). `--json out.json` also writes the numbers as JSON.
- Exit code: 0 scored, 2 refused or needs input, 1 error or a failed self-check.

Try it on the synthetic example (a known answer: laptop 2 s behind the phone, calm with 8 wrong seconds, stairs
with 12 seconds 9 bpm low):

```
node strap-score.mjs --strap examples/strap-hrv-logger.csv --tz Europe/Stockholm examples/calm.csv examples/stairs.csv
```

It should print what `examples/expected-report.txt` holds: lag 2 s, calm 95 of 120 s shown with 8 of every 100
wrong, stairs 114 of 150 shown with 89 of every 100 within 5 bpm and none wrong. Regenerate the examples with
`node strap-score.mjs --write-examples examples`.

## Strap formats it reads

Checked against each app's own documentation or a published parser on 2026-10-12. The self-check writes each
format from known beats and reads it back.

| App | What the file holds | Clock time |
| --- | --- | --- |
| Polar Flow CSV (also Polar Beat sessions, once synced to Flow) | line 1 `Name,Sport,Date,Start time,...`, then `Sample rate,Time,HR (bpm),...`, one HR per second | `Date` (dd-mm-yyyy) + `Start time`, local, no zone |
| Polar Sensor Logger | `Phone timestamp;RR-interval [ms]`, one row per beat (or `HR [bpm]` rows) | per beat, local, no zone |
| HRV Logger | `date,rr,since start` (newer: `timestamp`), one row per beat, RR in ms | per beat, local unless the stamp carries a zone |
| Elite HRV | `.txt`, one RR per line | only the file name: `2015-05-12 07-48-32.txt`, local |
| Kubios | report with an `RR Intervals` section, or a series export with `#` lines | none: pass `--start` |
| Polar Flow HRV export, Kubios time + RR | two columns: elapsed seconds, RR | none: pass `--start` |
| Any plain RR list | one RR per line, ms or seconds (a median above 10 means ms) | none: pass `--start` |

Phone-stamped formats stamp each beat when the phone **received** it, often in batches up to a second late. The
script keeps the spacing from the RR values and anchors them to the earliest-arriving beats, which puts beat times
back within 50 ms on the synthetic check. Elite HRV's file name is taken as the start of the reading; that is what
its help page says the name is, but it is not confirmed on a real file. If an Elite file is refused for no overlap,
pass `--start`.

## What it does, and why

1. **Reference heart rate per second.** From RR intervals: the mean of the strap's beats over the last 5 s
   (60000 / mean RR). Not the beat-to-beat rate: breathing alone swings that by several bpm in a calm person, and
   the page itself estimates over several seconds, so the beat-to-beat rate would mark a correct page wrong. The
   beat-to-beat result is printed as a second line anyway. From Polar Flow's per-second HR: used as written (Polar's
   own averaging, not documented). Beats outside 250 to 2000 ms, or more than 20 percent from their neighbours, are
   dropped as artefacts and counted.
2. **Lag.** The page's number at second s is compared with the strap at s + lag, for every lag from -15 to +15 s.
   The best lag is the one with the smallest mean difference (each second capped at 20 bpm). The lag is the clock
   difference **plus how late the page is**; with both clocks on automatic time, most of it is the page. So the
   result at lag 0 (clocks as recorded) is printed too.
3. **Refused, on purpose.** The script refuses to score when the files do not overlap in time (it then says if a
   whole-hour shift would fit, which means a wrong `--tz`), or when the best lag is not clearly better than every
   lag 3 s or more away. "Clearly" means a t statistic of at least 3 over 10 s blocks: neighbouring seconds are not
   independent, so they are averaged in blocks first. A steady heart rate gives no way to find the lag; the honest
   options then are `--lag 0`, said out loud, or a recording with some change in it (the stairs condition).
4. **Scores**, per condition and for all together:
   - **shown**: seconds with a number, out of seconds the strap also recorded (coverage).
   - **right**: within 5 bpm (this repository's convention). Also within 10 percent.
   - **wrong**: outside both 5 bpm and 10 percent, the heart-rate meter bar of ANSI/AAMI EC13 (now IEC 60601-2-27):
     within 10 percent or 5 bpm, whichever is greater. Good is close to 0.
   - **first number**: seconds from the page's first logged row to its first number (the median across files for
     "all").
   - **Bland-Altman**: bias (mean of page minus strap) and 95% limits (bias plus or minus 1.96 SD), over seconds.
     Seconds are not independent, so the limits describe the spread; they are not a confidence interval.
   - A plain **VERDICT** line.

## Replay: every rule arm on the same seconds

```
node strap-score.mjs --replay --library <demo checkout>/node_modules/@elata-biosciences/rppg-web \
  --strap <strap export> --tz <zone> p01/calm=calm.json p01/dim=dim.json p01/stairs=stairs.json p02/dim=...
```

The page's JSON holds, besides the per-second rows, the library's own recording of what its pulse check was fed
(`pulse_check_inputs`, made with `recordPulseCheckInputs`; format `rppg-web/pulse-check-inputs` version 1) and, per
row, which session read (`read_index`, counting `getMetrics()` calls from 0) gave that row its number. `--replay`
loads the library build the page ran (`--library`, its `dist/` folder; the version must match the recording's
`build`) and replays every capture through its `replayPulseCheck` once per arm: the default (the four candidates
off), `followerMedian`, `reproveOnDrift`, `tooDark`, `anchorDrift` each alone, and all four. Every arm is scored
against the strap on the same seconds, at the lag found for the shown numbers. Then it applies the decision rule in
[../../open-gaps.md](../../open-gaps.md) ("Strap study, fixed in advance") as written there, and prints which
candidates, if any, go on.

- **Name each file `person/condition=file`.** The rule counts and resamples people. Conditions judged: `calm`
  (normal light), `dim`, `stairs`, optionally with a number (`dim2`). Any other name (a lamp behind, head movement)
  is scored and reported, not judged. Without a person on every file the rule is not applied, and says so.
- **A capture is refused for replay, and listed, never dropped silently,** when: it is a CSV (only the number shown);
  it has no recording; it was recorded on another build; the recording let its start go (`dropped` above 0: the
  page keeps 10 minutes); the page ran other rules than the default arm; or the default arm does not give back
  every number the page showed, exactly. The last is the check that the replay is the page.
- How the rule is applied, where open-gaps.md leaves a detail open: the bootstrap draws people with replacement
  (seeded mulberry32, seed 1, 2,000 draws), pools their dim seconds, and takes the type 7 2.5 and 97.5 percent
  quantiles of default minus arm wrong per 100 shown; wrong per 100 shown is 0 when nothing was shown; rule 4 is not
  met when a condition has no seconds with a strap reference; "seconds shown by either arm" counts seconds with a
  strap reference; a tie for the lowest dim wrong share goes to the candidate listed first in open-gaps.md.

## Self-checks

They run every time the script loads, before anything is scored, on synthetic files built from a known heart-rate
curve (not from the script's own reference code):

| Check | Known answer | Breaks with |
| --- | --- | --- |
| tz | Stockholm noon is 10:00 UTC in October, 11:00 in January; +05:30 works | `SELFCHECK_BREAK=tz` |
| formats | 7 RR readers give back the generated beat times; Polar Flow seconds exact | `SELFCHECK_BREAK=formats` |
| known | laptop 4 s behind: lag 4, 150 of 180 shown, 135 right, 15 wrong, first number 20 s, bias 1.0 | `SELFCHECK_BREAK=known` |
| shift | laptop 11 s ahead, strap through the HRV Logger reader: lag -11, all 190 right | `SELFCHECK_BREAK=shift` |
| overlap | a page file an hour after the strap stopped is refused | `SELFCHECK_BREAK=overlap` |
| flat | a constant heart rate is refused (lag cannot be told apart) | `SELFCHECK_BREAK=flat` |
| replay-generator | with `--library`: the synthetic capture below carries 72 bpm, read by the independent DFT in `../selfcheck.mjs` | `SELFCHECK_BREAK=replay-generator` |
| replay-known | with `--library`: a synthetic capture (the library's own RecordingPulseCheck fed a chromatic pulse at 72, saved as the page saves it) replays to 72 plus or minus 2 from second 30 in every arm; with no pulse, no number in any arm | `SELFCHECK_BREAK=replay-known` |
| replay-exact | with `--library`: the default arm gives back every number the synthetic page showed, exactly; rows pointing one second late are refused | `SELFCHECK_BREAK=replay-exact` |
| decide | with `--library`: a made-up six-person study gives its known outcome (two candidates pass and go on together, one fails rule 3, one rule 2) | `SELFCHECK_BREAK=decide` (four people: rule 1 fails) |

Each was run once with its break set and threw; `node strap-score.mjs --selfcheck` runs them alone (add
`--library <dir>` for the replay ones).

## Limits

- Replay was run end to end once on the demo page's own saved files from a generated face (true 70, and no pulse),
  with a synthetic strap at 70 and `--lag 0`: the default arm gave back every shown number, and with one person the
  rule said "not decided". No real tester file has been replayed yet.
- Tested on synthetic files only. No real strap file has been through it yet; the first one is the real test of
  the readers, and a format surprise should fail loudly (unknown format, unreadable time) rather than score.
- The t rule's 3 and the 10 s block are choices, checked only on the synthetic cases above.
- With Polar Flow per-second HR the lag also absorbs Polar's own averaging delay, so its lag is not comparable
  with an RR file's.
