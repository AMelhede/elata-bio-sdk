/**
 * Face-framing guidance: turn a detected face's position/size in the frame into
 * a one-line "move closer / center / sit up" hint. A mis-framed face is *why*
 * SNR drops, so positioning is signal-domain logic that belongs alongside the
 * gating controller and is shared by every consumer (no per-app reimplementation).
 *
 * Pure by design — plain `{ x, y }` points, no MediaPipe import — so it can run
 * anywhere: the SDK derives the box from the FaceLandmarker it already runs for
 * its ROI crop (see {@link MediaPipeFaceFrameSource}), and the {@link RppgGatingController}
 * folds the result into its progressive guidance.
 */
// Thresholds are in *head-box* terms (see padFaceBoxToHead): the box we frame
// against is the padded head, not the bare mesh.
//
// minWidth is measured, not assumed. Below it the app adapter shows no heart rate and asks the person to move
// closer, so it must sit under every face that reads well and above the size at which the face finder loses the
// face. On real webcam recordings of people at rest, padded boxes were 0.136 to 0.263 of the frame width and read
// right against a reference pulse, and smaller faces did not read worse. The same videos shrunk in the frame: the
// face finder found the face in every frame down to 0.10 to 0.12 and lost it below that (0.087 to 0.10); at 0.10
// to 0.12 the readings stayed right but grew fewer for some faces (as many as at full size for one, a tenth for
// another). So minWidth is 0.12: under every face that read well, and where the face starts to be lost or read
// less, so the hint comes while moving closer still helps.
// The published 0.34 had no measurement behind it and asked a laptop user to sit about 38 cm from the camera.
// maxWidth and centerTol are unchanged and still unmeasured.
// longSide is measured: the face finder reads the whole frame scaled into a small square, so the face it can find
// is a fixed size against the frame's longer side. A portrait 360x640 frame found a face at 0.195 of its width and
// lost it at about 0.16 (59 px), the same pixel size as the landscape floor (56 to 64 px at 640 wide) (lane/portrait
// run13). Judged by width alone a phone held upright loses the face before "move closer" can show.
// maxHeight is measured too (lane/facesize run7, the same recordings zoomed in, 640x360): readings held while the
// padded head box was up to about 0.63 of the frame height and faded from about 0.8 (13, then 5 shown seconds of 73
// at 0.80 and 0.89), at widths of only 0.34 to 0.48, so maxWidth never fired where it mattered. No size gave a wrong
// reading, so this hint is advice: the rate is kept and the person is told to move back.
export const DEFAULT_FRAMING_THRESHOLDS = {
    minWidth: 0.12,
    maxWidth: 0.78,
    centerTol: 0.18,
    maxHeight: 0.8,
    longSide: true,
};
/**
 * The published 0.14.0 thresholds, kept as the off switch for the measured minWidth:
 * `createRppgAppAdapter({ gating: { framingThresholds: PUBLISHED_FRAMING_THRESHOLDS } })` brings back 0.14.0's
 * "move closer" (and no heart rate) for any face under 0.34 of the frame width.
 */
export const PUBLISHED_FRAMING_THRESHOLDS = {
    minWidth: 0.34,
    maxWidth: 0.78,
    centerTol: 0.18,
};
export const FRAMING_MESSAGES = {
    ok: "",
    no_face: "Bring your face into the frame",
    move_closer: "Move a little closer to the camera",
    move_back: "Move back a little — you’re too close",
    center_face: "Center your face in the frame",
    face_too_high: "You’re high in frame — lower your head or raise the camera",
    face_too_low: "You’re low in frame — sit up or lower the camera",
};
/**
 * Map a face box to a single framing hint. Distance is corrected before
 * position (no point centering a face that's about to be re-sized), and
 * horizontal before vertical. Returns `ok` when the face is well-framed.
 */
export function faceFramingFromBox(box, t = DEFAULT_FRAMING_THRESHOLDS) {
    if (box == null)
        return { code: "no_face", message: FRAMING_MESSAGES.no_face };
    if (box.width > t.maxWidth)
        return { code: "move_back", message: FRAMING_MESSAGES.move_back };
    const sizeShare = t.longSide && box.frameAspect != null && box.frameAspect < 1 ? box.width * box.frameAspect : box.width;
    if (sizeShare < t.minWidth)
        return { code: "move_closer", message: FRAMING_MESSAGES.move_closer };
    if (t.maxHeight != null && box.height > t.maxHeight)
        return { code: "move_back", message: FRAMING_MESSAGES.move_back, advisory: true };
    const cx = box.x + box.width / 2;
    if (Math.abs(cx - 0.5) > t.centerTol) {
        return { code: "center_face", message: FRAMING_MESSAGES.center_face };
    }
    const cy = box.y + box.height / 2;
    if (cy < 0.5 - t.centerTol)
        return { code: "face_too_high", message: FRAMING_MESSAGES.face_too_high };
    if (cy > 0.5 + t.centerTol)
        return { code: "face_too_low", message: FRAMING_MESSAGES.face_too_low };
    return { code: "ok", message: FRAMING_MESSAGES.ok };
}
/**
 * The FaceLandmarker mesh spans brow→chin, cheek→cheek — it omits the skull
 * above the brow and the head's full width (ears/hair). Users frame their whole
 * *head*, so steering off the bare mesh box reads low and small. We pad it
 * outward to approximate the head: a generous slab above (skull), a little to
 * each side, a touch below the jaw. Apply once at the source so the on-screen
 * box and the framing math operate on the same head box and can't drift apart.
 * Values may land outside 0..1 (head cropped by the frame) — the framing center
 * stays meaningful and any indicator clamps for drawing.
 */
export function padFaceBoxToHead(box) {
    // The mesh already reaches the upper forehead, so the skull slab above it is
    // small. Keep padding gentle — an aggressive top pad balloons the box and
    // clips it out of the frame.
    const topPad = box.height * 0.2; // skull above the hairline
    const sidePad = box.width * 0.07; // ears / hair
    const botPad = box.height * 0.02; // jaw slack
    return {
        x: box.x - sidePad,
        y: box.y - topPad,
        width: box.width + sidePad * 2,
        height: box.height + topPad + botPad,
        ...(box.frameAspect != null ? { frameAspect: box.frameAspect } : {}),
    };
}
/**
 * Bounding box of normalized face landmarks (e.g. MediaPipe's 478 points,
 * already in 0..1 frame coordinates). Returns null for an empty set.
 */
export function faceBoxFromLandmarks(landmarks) {
    if (!landmarks.length)
        return null;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of landmarks) {
        if (p.x < minX)
            minX = p.x;
        if (p.x > maxX)
            maxX = p.x;
        if (p.y < minY)
            minY = p.y;
        if (p.y > maxY)
            maxY = p.y;
    }
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}
