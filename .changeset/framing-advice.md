---
"@elata-biosciences/rppg-web": patch
---

New gating option `framingAdvice` (off by default): a mis-framed face (move closer, move back, center, too high or low) keeps its rate, with the framing message given as advice instead of `needs_position` withholding it. No face still withholds. Measured on real webcam recordings shifted and zoomed: no size or position that kept the face in the picture gave a wrong reading (centre up to 0.91 of the width, faces up to 0.68 wide), so the blocks withheld right readings.
