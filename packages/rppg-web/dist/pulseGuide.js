/** Rec.709 luma of an RGB pixel, 0..1 (channel inputs 0..255). */
export function lumaOf(r, g, b) {
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}
/** Face brightness a camera aims for (a face is darker than the frame mean); under it, more screen light helps. */
export const LUMA_TARGET = 0.38;
/** The lowest face brightness at which a pulse was seen to track in a graded light sweep; under it, light first. */
export const LUMA_FLOOR = 0.23;
/** How much brighter the room must read than the face before "turn to face the light" is the advice. */
export const BACKLIT_MIN_GAP = 0.05;
/** Centre weighting for metering a frame with no face box. */
export function centerWeight(u, v) {
    const dx = (u - 0.5) * 2;
    const dy = (v - 0.5) * 2;
    const r = Math.min(1, Math.hypot(dx, dy) / Math.SQRT2);
    return 0.05 + 0.95 * (1 - r) ** 3;
}
/** Where a centred face sits in the picture: the middle 30% of the width and 50% of the height. */
export const FACE_BOX = { x0: 0.35, x1: 0.65, y0: 0.25, y1: 0.75 };
/** Face, centre-weighted and whole-frame brightness of a small square frame (RGBA bytes), or null without pixels. */
export function meter(data, size) {
    let weighted = 0;
    let total = 0;
    let plain = 0;
    let count = 0;
    let box = 0;
    let boxCount = 0;
    for (let i = 0; i + 3 < data.length; i += 4) {
        const p = i / 4;
        const u = ((p % size) + 0.5) / size;
        const v = (Math.floor(p / size) + 0.5) / size;
        const w = centerWeight(u, v);
        const l = lumaOf(data[i], data[i + 1], data[i + 2]);
        weighted += w * l;
        total += w;
        plain += l;
        count++;
        if (u >= FACE_BOX.x0 &&
            u <= FACE_BOX.x1 &&
            v >= FACE_BOX.y0 &&
            v <= FACE_BOX.y1) {
            box += l;
            boxCount++;
        }
    }
    if (count === 0 || total <= 0 || boxCount === 0)
        return null;
    return {
        face: box / boxCount,
        centre: weighted / total,
        room: plain / count,
    };
}
/** The words for each instruction: what to do, in a few plain words. */
export const ADVICE_TEXT = {
    no_camera: "Starting camera",
    no_face: "Center your face",
    backlit: "Light is behind you. Turn to face it",
    night_light: "Turn off night light",
    brighter_screen: "Turn screen brightness all the way up",
    more_light: "Add some light in front of you",
    flicker: "A light is flickering. Use a steady lamp or daylight",
    moving: "Hold still",
    still: "Hold still",
    almost: "Hold still. Almost there",
    stalled: "Still measuring. Move closer to the light",
};
/** True when the instruction asks the person to do something; only these are shown (progress is carried by the display). */
export function needsYou(a) {
    return (a === "no_face" ||
        a === "backlit" ||
        a === "night_light" ||
        a === "brighter_screen" ||
        a === "more_light" ||
        a === "flicker" ||
        a === "stalled" ||
        a === "moving");
}
/** True when the advice asks the person to change something before a pulse can be read. */
export function isBlocking(a) {
    return (a === "no_camera" ||
        a === "no_face" ||
        a === "backlit" ||
        a === "night_light");
}
/** A camera starved of light: its exposure (Chrome exposureTime, 100 microsecond units) is a frame long at 30 fps or more. */
export const EXPOSURE_STARVED = 333;
export const cameraStarved = (exposureTime) => exposureTime != null &&
    Number.isFinite(exposureTime) &&
    exposureTime >= EXPOSURE_STARVED;
/** Below this green over red on the face, the light on it is too orange to read a pulse (a warm screen filter or lamp). */
export const WARM_MAX = 0.33;
const WARMTH_WINDOW_MS = 2000;
/** Green over red of the check's own face regions over the last WARMTH_WINDOW_MS. */
export function warmthOf(events) {
    let r = 0, g = 0, last = -Infinity;
    for (let i = events.length - 1; i >= 0; i--) {
        const e = events[i];
        if (e[0] !== "f")
            continue;
        const t = e[1];
        if (last === -Infinity)
            last = t;
        if (t < last - WARMTH_WINDOW_MS)
            break;
        for (const reg of e[2]) {
            r += reg[0];
            g += reg[1];
        }
    }
    return r > 0 ? g / r : null;
}
/** Blue over red of the face regions: a warm filter cuts blue more than green, a dark picture does not. */
export function blueWarmthOf(events) {
    let r = 0, b = 0, last = -Infinity;
    for (let i = events.length - 1; i >= 0; i--) {
        const e = events[i];
        if (e[0] !== "f")
            continue;
        const t = e[1];
        if (last === -Infinity)
            last = t;
        if (t < last - WARMTH_WINDOW_MS)
            break;
        for (const reg of e[2]) {
            r += reg[0];
            b += reg[2];
        }
    }
    return r > 0 ? b / r : null;
}
/** Head movement is judged over the last 8 s, as the pulse check asks its newest 8 s to carry the rate. */
export const MOVE_WINDOW_MS = 8000;
/** Head movement (median frame-to-frame centre shift over face width) above which "hold still" is the fix. */
export const MOVE_MAX = 0.07;
const MOVE_MIN_ROWS = 60;
/**
 * Whether the head is still moving now: the last 2 s (movementOf with MOVE_NOW_WINDOW_MS). "Hold still" shows only while
 * this is over MOVE_STILL_MAX and clears the moment it is not: the 8 s spread keeps a stopped move for up to 8 s, and the
 * line stayed up while the person held still (a phone recording, 2026-11-01). 0.02 is where still heads end: over 2 s,
 * 99 in 100 seconds of heads still over 8 s (8 s spread under 0.02) read under 0.021 on laptops, phones and a Mac
 * alike (test-page recordings, 4,448 seconds).
 */
export const MOVE_NOW_WINDOW_MS = 2000;
export const MOVE_STILL_MAX = 0.02;
const MOVE_NOW_MIN_ROWS = 6;
const spread = (xs) => {
    const m = xs.reduce((a, b) => a + b, 0) / xs.length;
    return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length);
};
/** Head movement over `windowMs` (MOVE_WINDOW_MS unless given) from head rows, or null when there are too few to judge. */
export function movementOf(rows, endMs, windowMs = MOVE_WINDOW_MS) {
    const win = rows.filter((r) => r.t_ms > endMs - windowMs && r.t_ms <= endMs && r.w > 0);
    if (win.length < (windowMs >= MOVE_WINDOW_MS ? MOVE_MIN_ROWS : MOVE_NOW_MIN_ROWS))
        return null;
    const ws = win.map((r) => r.w).sort((a, b) => a - b);
    const w = ws[ws.length >> 1];
    return ((spread(win.map((r) => r.x)) +
        spread(win.map((r) => r.y)) +
        spread(win.map((r) => r.w))) /
        w);
}
/**
 * How long a face may be in view with no number before the stall line replaces silence: 30 s. On every received
 * test-page recording replayed on test.57, a first number came within 26 s on 9 in 10 phone readings, while 35% of
 * computer readings ran past 30 s, 16 of those 19 with a fixable cause (head movement, a dim room, a warm filter), so the
 * fix belongs at 30 s, not at the 42 s an earlier lab-webcam count gave (test.44). An app's "taking longer than usual"
 * line uses the same moment, so the line and its fix appear together.
 */
export const STALL_MS = 30000;
/** The one instruction for this moment, in the order a person must fix things: a picture, a face, then light. */
export function adviceFor(s) {
    if (s.hasNumber)
        return "still";
    if (!s.light)
        return "no_camera";
    const { face, centre, room } = s.light;
    if (!s.faceFound &&
        centre < LUMA_TARGET &&
        room >= LUMA_TARGET &&
        room - centre >= BACKLIT_MIN_GAP)
        return "backlit";
    if (!s.faceFound)
        return "no_face";
    if (s.warmth != null &&
        s.warmth < WARM_MAX &&
        s.light.face >= LUMA_FLOOR &&
        !(s.blueWarmth != null && s.blueWarmth >= s.warmth))
        return "night_light";
    // Moving: the window's 8 s spread over MOVE_MAX, unless the last 2 s show the head already still.
    const moving = s.movement != null &&
        s.movement > MOVE_MAX &&
        !(s.movementNow != null && s.movementNow <= MOVE_STILL_MAX);
    if (s.cause) {
        const a = adviceForCause(s.cause, face, s.lampOn, moving, s.movementNow != null && s.movementNow <= MOVE_STILL_MAX, s.colourDamaged === true || s.starved === true);
        if (a === "still" &&
            s.exposureKnown === false &&
            (s.cause === "weakSignal" || s.cause === "noRate") &&
            (s.searchingMs ?? 0) >= STALL_MS)
            return "stalled";
        return a;
    }
    if (face < LUMA_FLOOR)
        return s.lampOn ? "more_light" : "brighter_screen";
    if (moving)
        return "moving";
    if (s.lampOn && face < LUMA_TARGET)
        return "brighter_screen";
    return (s.searchingMs ?? 0) >= STALL_MS ? "stalled" : "still";
}
function adviceForCause(cause, face, lampOn, moving, stillNow, colourDamaged) {
    switch (cause) {
        // The window fills after a start or a return; a head moving then spoils it, so "hold still" is the fix there too.
        case "collecting":
            return moving ? "moving" : "still";
        case "shown":
            return "almost";
        case "noFace":
            return "no_face";
        case "lightFlicker":
            return "flicker";
        case "headMotion":
            return stillNow ? "almost" : "moving";
        case "noRate":
        case "weakSignal":
            if (face < LUMA_FLOOR)
                return lampOn ? "more_light" : "brighter_screen";
            if (face < LUMA_TARGET)
                return "brighter_screen";
            if (colourDamaged)
                return "more_light";
            return moving ? "moving" : "still";
        case "agreeing":
        case "waitingForBlink":
            return moving ? "moving" : "almost";
    }
}
/** A new instruction shows once it has held this long, but "hold still", which follows the head at once; a number on screen clears it. */
export const ADVICE_HOLD_MS = 4000;
/** The instruction shown after the hold, given the raw one and whether a number is on screen. */
export function shownAfter(prev, raw, now, numberOnScreen) {
    if (numberOnScreen)
        return { advice: "still", pending: null, since: now };
    // "Hold still" follows the head with no hold either way: it needs the 8 s spread and the last 2 s both over their
    // bars, so it is already judged, and the line is about what the person is doing now. On the received recordings it
    // cut the seconds it showed to a still head to none (a phone 185, a laptop 231, a Mac 37), and the seconds a
    // moving head with no number went without it from 192 to 3 on the phone and 308 to 27 on the laptop;
    // clearing at once but keeping the hold to show left more moving seconds without it (238 on the phone), and a 2 s
    // hold to clear showed it to a still head again (92). evsave tools/holdstill.mjs.
    if (raw === "moving" && prev.advice !== "moving")
        return { advice: raw, pending: null, since: now };
    if (prev.advice === "moving" && raw !== "moving")
        return { advice: raw, pending: null, since: now };
    if (raw === prev.advice)
        return { advice: prev.advice, pending: null, since: now };
    if (raw !== prev.pending)
        return { advice: prev.advice, pending: raw, since: now };
    return now - prev.since >= ADVICE_HOLD_MS
        ? { advice: raw, pending: null, since: now }
        : prev;
}
/**
 * The instruction an app shows, one call per read: the advice for this moment, held by shownAfter, and its text only
 * when the person must do something and no number is on screen. As PulseDisplay decides the number, this decides the line.
 */
export class PulseGuide {
    constructor() {
        this.shown = { advice: "no_camera", pending: null, since: 0 };
    }
    next(nowMs, input, numberOnScreen) {
        const raw = adviceFor({ ...input, hasNumber: numberOnScreen });
        this.shown = shownAfter(this.shown, raw, nowMs, numberOnScreen);
        const advice = this.shown.advice;
        return {
            raw,
            advice,
            text: needsYou(advice) && !numberOnScreen ? ADVICE_TEXT[advice] : null,
        };
    }
    reset() {
        this.shown = { advice: "no_camera", pending: null, since: 0 };
    }
}
