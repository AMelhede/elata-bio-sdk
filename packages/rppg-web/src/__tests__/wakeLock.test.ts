import { keepScreenOn } from '../wakeLock';
const assert = {
	equal: (a: unknown, b: unknown, _m?: string) => expect(a).toBe(b),
	notEqual: (a: unknown, b: unknown, _m?: string) => expect(a).not.toBe(b),
	ok: (x: unknown, _m?: string) => expect(x).toBeTruthy(),
	deepEqual: (a: unknown, b: unknown, _m?: string) => expect(a).toEqual(b),
};


type Listener = () => void;
function fakeDoc(state: 'visible' | 'hidden' = 'visible') {
  const ls: Listener[] = [];
  return {
    visibilityState: state,
    addEventListener: (_: string, f: Listener) => ls.push(f),
    removeEventListener: (_: string, f: Listener) => { const i = ls.indexOf(f); if (i >= 0) ls.splice(i, 1); },
    fire() { ls.slice().forEach((f) => f()); },
    get listeners() { return ls.length; },
  };
}
function fakeLock() {
  const sentinels: { released: boolean; onrelease: (() => void) | null; release(): Promise<void> }[] = [];
  return {
    sentinels,
    wakeLock: {
      request: async (type: string) => {
        assert.equal(type, 'screen');
        const s = { released: false, onrelease: null as (() => void) | null, async release() { s.released = true; s.onrelease?.(); } };
        sentinels.push(s);
        return s;
      },
    },
  };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

test('asks for a screen wake lock and reports it granted', async () => {
  const lock = fakeLock(); const doc = fakeDoc(); const states: string[] = [];
  const stop = keepScreenOn(lock, doc, (s) => states.push(s));
  await tick();
  assert.equal(lock.sentinels.length, 1);
  assert.deepEqual(states, ['granted']);
  stop();
  await tick();
  assert.equal(lock.sentinels[0].released, true);
  assert.equal(doc.listeners, 0);
});

test('the browser drops the lock when the page is hidden; it is asked for again on return', async () => {
  const lock = fakeLock(); const doc = fakeDoc(); const states: string[] = [];
  const stop = keepScreenOn(lock, doc, (s) => states.push(s));
  await tick();
  await lock.sentinels[0].release(); // what the browser does on hide
  doc.visibilityState = 'visible';
  doc.fire();
  await tick();
  assert.equal(lock.sentinels.length, 2);
  assert.deepEqual(states, ['granted', 'released', 'granted']);
  stop();
});

test('a hidden page does not ask; a browser without the API says unsupported; a refusal is reported with its name', async () => {
  const lock = fakeLock(); const hidden = fakeDoc('hidden'); const s1: string[] = [];
  keepScreenOn(lock, hidden, (s) => s1.push(s))();
  await tick();
  assert.equal(lock.sentinels.length, 0);
  const s2: string[] = [];
  keepScreenOn({}, fakeDoc(), (s) => s2.push(s));
  assert.deepEqual(s2, ['unsupported']);
  const s3: string[] = [];
  const refusing = { wakeLock: { request: async () => { const e = new Error('no'); e.name = 'NotAllowedError'; throw e; } } };
  keepScreenOn(refusing, fakeDoc(), (s) => s3.push(s));
  await tick();
  assert.deepEqual(s3, ['denied:NotAllowedError']);
});

test('stopped before the lock arrives: the late lock is let go at once', async () => {
  const lock = fakeLock(); const doc = fakeDoc();
  const stop = keepScreenOn(lock, doc, () => {});
  stop();
  await tick();
  assert.equal(lock.sentinels[0].released, true);
});
