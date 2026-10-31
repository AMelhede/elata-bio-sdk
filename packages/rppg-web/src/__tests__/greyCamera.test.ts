import { colourSpread, isGreyFrame, otherCamera, GREY_MAX_SPREAD } from '../greyCamera';
const assert = {
	equal: (a: unknown, b: unknown, _m?: string) => expect(a).toBe(b),
	notEqual: (a: unknown, b: unknown, _m?: string) => expect(a).not.toBe(b),
	ok: (x: unknown, _m?: string) => expect(x).toBeTruthy(),
	deepEqual: (a: unknown, b: unknown, _m?: string) => expect(a).toEqual(b),
};


/** A 64x48 frame: skin-toned face blob on a blue-grey wall, scaled by `light`, optionally grey. */
function frame(light: number, grey = false, noise = 0): Uint8ClampedArray {
  const W = 64, H = 48, d = new Uint8ClampedArray(W * H * 4);
  let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * noise;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const face = (x - 32) ** 2 + (y - 22) ** 2 < 150;
    let [r, g, b] = face ? [200, 150, 120] : [90, 100, 120];
    if (grey) { const l = 0.299 * r + 0.587 * g + 0.114 * b; r = g = b = l; }
    const i = 4 * (y * W + x); const n = rnd();
    d[i] = r * light + n; d[i + 1] = g * light + n; d[i + 2] = b * light + n; d[i + 3] = 255;
  }
  return d;
}

test('a colour scene is not grey, even dim', () => {
  assert.equal(isGreyFrame(frame(1)), false);
  assert.equal(isGreyFrame(frame(0.2)), false);
  assert.ok(colourSpread(frame(0.2)) > 2 * GREY_MAX_SPREAD);
});

test('an IR camera picture (grey) is grey, with or without sensor noise in luminance', () => {
  assert.equal(isGreyFrame(frame(1, true)), true);
  assert.equal(isGreyFrame(frame(0.3, true, 20)), true);
});

test('switches to another camera, preferring one not labelled IR; none when only one camera', () => {
  const devs = [
    { kind: 'videoinput', deviceId: 'a', label: 'Integrated IR Camera' },
    { kind: 'audioinput', deviceId: 'm', label: 'Mic' },
    { kind: 'videoinput', deviceId: 'b', label: 'Integrated Camera' },
    { kind: 'videoinput', deviceId: 'c', label: 'Infrared camera' },
  ];
  assert.equal(otherCamera(devs, 'a'), 'b');
  assert.equal(otherCamera(devs, 'b'), null);
  assert.equal(otherCamera([devs[0]], 'a'), null);
});
