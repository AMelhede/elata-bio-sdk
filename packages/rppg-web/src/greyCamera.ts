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
export const GREY_MAX_SPREAD = 3;

/** Mean over pixels of max(|r-g|, |g-b|, |r-b|), RGBA bytes. */
export function colourSpread(data: Uint8ClampedArray | Uint8Array): number {
	let s = 0,
		n = 0;
	for (let i = 0; i + 3 < data.length; i += 4) {
		const r = data[i],
			g = data[i + 1],
			b = data[i + 2];
		s += Math.max(Math.abs(r - g), Math.abs(g - b), Math.abs(r - b));
		n++;
	}
	return n ? s / n : 0;
}

export const isGreyFrame = (data: Uint8ClampedArray | Uint8Array) =>
	colourSpread(data) < GREY_MAX_SPREAD;

/** The camera to switch to: another video input, preferring one whose label does not say IR or infrared; null if none. */
export function otherCamera(
	devices: readonly { kind: string; deviceId: string; label: string }[],
	currentId: string | undefined,
): string | null {
	const others = devices.filter(
		(d) => d.kind === "videoinput" && d.deviceId && d.deviceId !== currentId,
	);
	const colour = others.find((d) => !/\b(ir|infrared)\b/i.test(d.label));
	return (colour ?? null)?.deviceId ?? null;
}
