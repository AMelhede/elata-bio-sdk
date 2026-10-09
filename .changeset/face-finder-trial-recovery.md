---
"@elata-biosciences/rppg-web": patch
---

Trial face finder recovery: when no delegate builds, the loader throws the build error (the session reports face_mesh_init_failed, as with the switch off); a candidate that throws is dropped from the trial, and after the trial a finder that throws three times running is rebuilt; a failed rebuild waits 2 s, doubling to 30 s, and every other try builds the other delegate; a rebuild that lands after the trial closed its finder is closed; a rebuild during the trial restarts that candidate's warm-up.
