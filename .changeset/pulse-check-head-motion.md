---
"@elata-biosciences/rppg-web": patch
---

New pulse-check rule `headMotion` (on by default, `pulseCheckRules.headMotion: false` turns it off): a rate the head's own movement keeps time with (a nod, a rock) is not counted toward proving a pulse, and a proven rate it carries for 4 seconds is withheld. The runner passes the head's position (the centre of bone landmarks, `headCentre`) to `PulseCheck.push`. A generated face with no pulse nodding at 60 a minute showed 60 without it and nothing with it; a pulse at 70 under a nod at 90 still shows 70.
