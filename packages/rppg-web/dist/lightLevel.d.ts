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
export type LightLevel = 0 | 0.5 | 1;
export interface FaceLight {
    /**
     * Rec.709 luma, 0..1: of the face regions' skin-masked mean colour (the same means the pulse check reads), or with
     * no face found of the plain mean over CENTRE_BOX.
     */
    readonly luma: number;
    /** Share of the face regions' pixels, skin or not, with red at or above RED_CLIP_LEVEL. */
    readonly redClip: number;
    /** Where it was read: the face regions, or the centre of the picture while no face is found. */
    readonly source: "face" | "centre";
}
export interface LightState {
    /** The level the app is asked to render. */
    readonly level: LightLevel;
    /** When the current unbroken run of dim frames began, or null. */
    readonly darkSince: number | null;
    /** When the current unbroken run of frames at full light that burnt the face out began, or null. */
    readonly clipSince: number | null;
}
export declare const LIGHT_START: LightState;
/**
 * Where a centred face sits while none is found yet: the middle 30% of the width and 50% of the height. A face too dark
 * to be found is exactly the case the light is for, so the level cannot wait for a face. The bar there is the app
 * measure itself, 0.38, read on this same box.
 */
export declare const CENTRE_BOX: {
    readonly x0: 0.35;
    readonly x1: 0.65;
    readonly y0: 0.25;
    readonly y1: 0.75;
};
/**
 * How long a face must read dim, or burnt out, before the level steps: a camera starting, or
 * answering the screen's new light, settles its exposure in about 1.6 s; 2 s clears that.
 */
export declare const LIGHT_LATCH_MS = 2000;
/** A red level at or above this counts as clipped (255 is full scale). */
export declare const RED_CLIP_LEVEL = 250;
/**
 * Red clipped on this share of the face at full light means the light is burning it out. On 105 recorded sessions,
 * seconds after the check first saw a signal: a number on 20 to 29% of seconds below 0.3 clipped, 13.6% at 0.3 to 0.5
 * (381 seconds, 19 sessions), 2.0% at 0.5 or more (199 seconds, 10 sessions). A laptop webcam in a dim room at night:
 * full light, 0.56 to 0.72 clipped, no number in 38 s; the same room unlit, 0.25 to 0.44 and 18 seconds in 74.
 */
export declare const LIGHT_CLIP_MAX = 0.5;
/**
 * The next level: 1 from the first frame of the measurement (face or centre box), then 0.5 once if the rendered full
 * light burns the face out, never back. A light that changes inside a measurement costs a whole window: on a recorded
 * laptop session the light came on at 30 s for a faint pulse and the first number waited for a fresh 16 s window under
 * it, arriving at 57 s, then held for the rest of the session. Deciding it before the first window removes that step.
 * A lamp that lit the face then switched itself off killed the reading too (an app's dark capture, 2026-09-24), and the
 * pulse check withholds a pulse when the light keeps stepping (rule screenLight). Burnout is judged only on full light
 * the app says it rendered (`applied`), so an app that cannot light is never asked to light less.
 */
export declare function lightAfter(prev: LightState, face: FaceLight | null, applied: LightLevel, now: number): LightState;
/** Rec.709 luma of a 0..1 colour. */
export declare function lumaOfRgb(c: {
    r: number;
    g: number;
    b: number;
}): number;
/**
 * The face's light from one RGBA frame: luma from the regions' skin-masked means (already computed for the pulse check,
 * passed in), red clip from every pixel inside the region boxes, every second pixel each way (a burnt pixel is white and
 * fails the skin mask, so the mask must not decide which pixels count). Null with no region or no pixel.
 */
export declare function faceLightFromFrame(data: ArrayLike<number>, width: number, boxes: readonly {
    x: number;
    y: number;
    w: number;
    h: number;
}[], means: readonly {
    r: number;
    g: number;
    b: number;
}[]): FaceLight | null;
/** The light from CENTRE_BOX of one RGBA frame, every second pixel each way, for frames with no face found. */
export declare function centreLightFromFrame(data: ArrayLike<number>, width: number, height: number): FaceLight | null;
//# sourceMappingURL=lightLevel.d.ts.map