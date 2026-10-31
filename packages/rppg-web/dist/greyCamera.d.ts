/**
 * An infrared camera picked instead of the colour one. Many laptops with face sign-in (Lenovo ThinkPads among them) list
 * an IR camera as a second video device; its picture is grey (red, green and blue equal), so no colour pulse exists and
 * a number never comes. The page looks at one frame after the camera starts; if it is grey and another camera exists,
 * it switches to that one, as a video-call app would pick the colour camera.
 *
 * Grey means the mean over all pixels of the largest gap between red, green and blue is under GREY_MAX_SPREAD levels.
 * Measured 2026-10-31 on a real indoor photo at 160x120: 36.9 levels in colour, 8.8 darkened and desaturated, 0.0 as
 * its grey copy; an IR camera's frame is grey by construction. 3 sits under the dim colour scene by a factor of about 3.
 */
export declare const GREY_MAX_SPREAD = 3;
/** Mean over pixels of max(|r-g|, |g-b|, |r-b|), RGBA bytes. */
export declare function colourSpread(data: Uint8ClampedArray | Uint8Array): number;
export declare const isGreyFrame: (data: Uint8ClampedArray | Uint8Array) => boolean;
/** The camera to switch to: another video input, preferring one whose label does not say IR or infrared; null if none. */
export declare function otherCamera(devices: readonly {
    kind: string;
    deviceId: string;
    label: string;
}[], currentId: string | undefined): string | null;
//# sourceMappingURL=greyCamera.d.ts.map