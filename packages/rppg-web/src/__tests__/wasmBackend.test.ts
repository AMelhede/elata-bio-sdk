import { loadWasmBackend } from '../wasmBackend';

test('loadWasmBackend finds and returns a backend when bundle is present', async () => {
  const backend = await loadWasmBackend(async (url) => {
    if (url === '/pkg/rppg_wasm.js') {
      return {
        WasmRppgPipeline: class {
          constructor(public sr: number, public ws: number) {}
          push_sample() {}
          get_metrics() { return { bpm: null, confidence: 0, signal_quality: 0 }; }
        }
      };
    }
    throw new Error('missing module');
  });

  expect(backend).not.toBeNull();
  const p = backend!.newPipeline(30, 5);
  expect(typeof p.push_sample === 'function' || typeof p.pushSample === 'function').toBeTruthy();
});

test('loadWasmBackend returns null when no bundle present', async () => {
  const backend = await loadWasmBackend(async () => {
    throw new Error('missing module');
  });

  expect(backend).toBeNull();
});

test('loadWasmBackend throws a structured error in strict mode', async () => {
  await expect(loadWasmBackend(async () => {
    throw new Error('missing module');
  }, { strict: true })).rejects.toMatchObject({
    name: 'RppgWasmLoadError',
    code: 'RPPG_WASM_LOAD_FAILED',
  });
});

test('loadWasmBackend in strict mode keeps why each URL failed, in the order tried', async () => {
  // The glue at /pkg/ imports but its .wasm does not instantiate; /rppg_wasm.js is not served.
  const initError = new Error('WebAssembly.instantiate(): expected magic word 00 61 73 6d');
  const importError = new TypeError('Failed to fetch dynamically imported module: /rppg_wasm.js');
  const error = await loadWasmBackend(async (url) => {
    if (url === '/pkg/rppg_wasm.js') {
      return { default: async () => { throw initError; } };
    }
    throw importError;
  }, { strict: true }).catch((e) => e);

  expect(error).toMatchObject({
    name: 'RppgWasmLoadError',
    attemptedUrls: ['/pkg/rppg_wasm.js', '/rppg_wasm.js'],
    lastError: importError,
  });
  expect(error.errors).toEqual([initError, importError]);
});

test('loadWasmBackend in strict mode records a module that loads but exposes no pipeline', async () => {
  const importError = new TypeError('Failed to fetch dynamically imported module: /rppg_wasm.js');
  const error = await loadWasmBackend(async (url) => {
    if (url === '/pkg/rppg_wasm.js') return {};
    throw importError;
  }, { strict: true }).catch((e) => e);

  expect(error.errors).toHaveLength(2);
  expect(String(error.errors[0])).toContain('/pkg/rppg_wasm.js loaded but exports no rPPG pipeline');
  expect(error.errors[1]).toBe(importError);
  // lastError keeps its meaning: the last error an attempt threw.
  expect(error.lastError).toBe(importError);
});

test('loadWasmBackend honors explicit jsUrl and binaryUrl options', async () => {
  const initSpy = jest.fn(async (_binaryUrl?: string) => undefined);
  const importer = jest.fn(async (url: string) => {
    if (url !== '/assets/custom-rppg.js') {
      throw new Error(`unexpected url ${url}`);
    }
    return {
      default: initSpy,
      WasmRppgPipeline: class {
        push_sample() {}
        get_metrics() {
          return { bpm: null, confidence: 0, signal_quality: 0 };
        }
      },
    };
  });

  const backend = await loadWasmBackend(importer, {
    jsUrl: '/assets/custom-rppg.js',
    binaryUrl: '/assets/custom-rppg.wasm',
  });

  expect(importer).toHaveBeenCalledTimes(1);
  expect(importer).toHaveBeenCalledWith('/assets/custom-rppg.js');
  expect(initSpy).toHaveBeenCalledWith('/assets/custom-rppg.wasm');
  expect(backend).not.toBeNull();
});
