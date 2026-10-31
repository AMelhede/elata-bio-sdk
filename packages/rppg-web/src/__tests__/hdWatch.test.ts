import { hdFallback, HD_GRACE_MS, HD_MIN_FPS } from '../hdWatch';
const assert = {
	equal: (a: unknown, b: unknown, _m?: string) => expect(a).toBe(b),
	notEqual: (a: unknown, b: unknown, _m?: string) => expect(a).not.toBe(b),
	ok: (x: unknown, _m?: string) => expect(x).toBeTruthy(),
	deepEqual: (a: unknown, b: unknown, _m?: string) => expect(a).toEqual(b),
};


const base = { auto: true, on: true, elapsedMs: HD_GRACE_MS, framesSeen: 20 * 8 };

test('HD stays while the device keeps up, and is judged only after the grace period', () => {
  assert.equal(hdFallback(base), null);
  assert.equal(hdFallback({ ...base, elapsedMs: HD_GRACE_MS - 1, framesSeen: 0 }), null);
});

test('HD is given up when the library analyses under 8 frames a second, as the owner\'s phone did (11 in 6 s)', () => {
  assert.equal(HD_MIN_FPS, 8);
  assert.equal(hdFallback({ ...base, framesSeen: 15 }), 'slow');
});

test('HD is given up at once when the library reports its backend gone', () => {
  assert.equal(hdFallback({ ...base, elapsedMs: 1000, framesSeen: 30, errorMessage: 'rPPG backend has been disposed; refusing push_sample.' }), 'backend_error');
});

test('an address that sets hd decides alone, and nothing happens with HD off', () => {
  assert.equal(hdFallback({ ...base, auto: false, framesSeen: 0 }), null);
  assert.equal(hdFallback({ ...base, on: false, framesSeen: 0 }), null);
});
