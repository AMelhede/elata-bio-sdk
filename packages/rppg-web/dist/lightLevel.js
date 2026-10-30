/**
 * How much light the screen should put on the face, decided from the face itself (session option `light`).
 *
 * A watch carries its own light; a camera reading has only the room and the screen. The screen is the one light an app
 * controls (the phone's display as a controllable light source doubled camera pulse-oximetry signal quality: Holz and
 * Ofek, EMBC 2018, doi 10.1109/EMBC.2018.8513286), and it fails two ways: too little leaves the face dim, too much burns
 * the face out because the camera meters the whole frame, a dark room behind the face (auto-exposure metered on skin
 * instead fixes exactly this: Yi, Yu, Zhu and Wang, EMBC 2024, doi 10.1109/EMBC53108.2024.10781984). A burnt-out face
 * cannot be recovered by any processing afterwards (PixExpo, arXiv 2609.36607).
 *
 * The SDK decides a level in linear light, 0, 1 or 0.5; the app renders what it can (a white page, a fill overlay, a
 * native shell's full brightness) and reports what it rendered. An app that cannot light the screen gets the same
 * reading with fewer numbers in a dim room. Pure, so each rule is testable without a camera.
 */
export const LIGHT_START = { level: 0, darkSince: null, clipSince: null };
/**
 * Where a centred face sits while none is found yet: the middle 30% of the width and 50% of the height. A face too dark
 * to be found is exactly the case the light is for, so the level cannot wait for a face. The bar there is the app
 * measure itself, 0.38, read on this same box.
 */
export const CENTRE_BOX = { x0: 0.35, x1: 0.65, y0: 0.25, y1: 0.75 };
/**
 * How long a face must read dim, or burnt out, before the level steps: a camera starting, or
 * answering the screen's new light, settles its exposure in about 1.6 s; 2 s clears that.
 */
export const LIGHT_LATCH_MS = 2000;
/** A red level at or above this counts as clipped (255 is full scale). */
export const RED_CLIP_LEVEL = 250;
/**
 * Red clipped on this share of the face at full light means the light is burning it out. On 105 recorded sessions,
 * seconds after the check first saw a signal: a number on 20 to 29% of seconds below 0.3 clipped, 13.6% at 0.3 to 0.5
 * (381 seconds, 19 sessions), 2.0% at 0.5 or more (199 seconds, 10 sessions). A laptop webcam in a dim room at night:
 * full light, 0.56 to 0.72 clipped, no number in 38 s; the same room unlit, 0.25 to 0.44 and 18 seconds in 74.
 */
export const LIGHT_CLIP_MAX = 0.5;
/**
 * The next level: 1 from the first frame of the measurement (face or centre box), then 0.5 once if the rendered full
 * light burns the face out, never back. A light that changes inside a measurement costs a whole window: on a recorded
 * laptop session the light came on at 30 s for a faint pulse and the first number waited for a fresh 16 s window under
 * it, arriving at 57 s, then held for the rest of the session. Deciding it before the first window removes that step.
 * A lamp that lit the face then switched itself off killed the reading too (an app's dark capture, 2026-09-24), and the
 * pulse check withholds a pulse when the light keeps stepping (rule screenLight). Burnout is judged only on full light
 * the app says it rendered (`applied`), so an app that cannot light is never asked to light less.
 */
export function lightAfter(prev, face, applied, now) {
    if (prev.level === 0.5 || face == null || !Number.isFinite(face.luma) || !Number.isFinite(face.redClip))
        return prev;
    // On from the first frame of the measurement: the light never steps inside a measurement except to stop burnout.
    if (prev.level === 0)
        return { level: 1, darkSince: now, clipSince: null };
    if (applied !== 1 || face.redClip < LIGHT_CLIP_MAX)
        return { ...prev, clipSince: null };
    const clipSince = prev.clipSince ?? now;
    return now - clipSince >= LIGHT_LATCH_MS ? { ...prev, level: 0.5, clipSince } : { ...prev, clipSince };
}
/** Rec.709 luma of a 0..1 colour. */
export function lumaOfRgb(c) {
    return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
}
/**
 * The face's light from one RGBA frame: luma from the regions' skin-masked means (already computed for the pulse check,
 * passed in), red clip from every pixel inside the region boxes, every second pixel each way (a burnt pixel is white and
 * fails the skin mask, so the mask must not decide which pixels count). Null with no region or no pixel.
 */
export function faceLightFromFrame(data, width, boxes, means) {
    if (!boxes.length || !means.length)
        return null;
    let n = 0;
    let clipped = 0;
    for (const b of boxes) {
        const x0 = Math.max(0, Math.floor(b.x));
        const y0 = Math.max(0, Math.floor(b.y));
        const x1 = Math.min(width, Math.floor(b.x + b.w));
        const y1 = Math.floor(b.y + b.h);
        for (let y = y0; y < y1; y += 2) {
            for (let x = x0; x < x1; x += 2) {
                const i = (y * width + x) * 4;
                if (i + 2 >= data.length)
                    continue;
                n++;
                if (data[i] >= RED_CLIP_LEVEL)
                    clipped++;
            }
        }
    }
    if (n === 0)
        return null;
    const luma = means.reduce((s, c) => s + lumaOfRgb(c), 0) / means.length;
    return { luma, redClip: clipped / n, source: "face" };
}
/** The light from CENTRE_BOX of one RGBA frame, every second pixel each way, for frames with no face found. */
export function centreLightFromFrame(data, width, height) {
    const x0 = Math.floor(width * CENTRE_BOX.x0);
    const x1 = Math.ceil(width * CENTRE_BOX.x1);
    const y0 = Math.floor(height * CENTRE_BOX.y0);
    const y1 = Math.ceil(height * CENTRE_BOX.y1);
    let n = 0;
    let clipped = 0;
    let luma = 0;
    for (let y = y0; y < y1; y += 2) {
        for (let x = x0; x < x1; x += 2) {
            const i = (y * width + x) * 4;
            if (i + 2 >= data.length)
                continue;
            n++;
            luma += (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255;
            if (data[i] >= RED_CLIP_LEVEL)
                clipped++;
        }
    }
    return n === 0 ? null : { luma: luma / n, redClip: clipped / n, source: "centre" };
}
