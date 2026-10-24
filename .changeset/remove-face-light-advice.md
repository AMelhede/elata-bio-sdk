---
"@elata-biosciences/rppg-web": patch
---

The "Add light on your face" advice from 0.15.0-test.38 is removed (`gating.minFaceLuma`, `faceLuma` on the adapter input and on `LastFaceBox`). Its 0.3 brightness line came from 4 recordings darkened by a script. On 95 real webcam recordings in real rooms with a finger reference (pre-registered, scored once), faces under 0.3 read about as often as brighter ones (median share of seconds with a number 0.03 against 0.04), down to a brightness of 0.09. From first principles it cannot work as a light test: the camera's auto exposure brightens a dim scene, and darker skin reflects less light, so a face in good light can sit under the line and be told to add light it does not need. The earlier light advice (low signal quality) is unchanged.
